const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const fs      = require('fs');
const pool    = require('../db');
const { calculateCosts } = require('../costCalculator');
require('dotenv').config();

const upload = multer({ dest: 'uploads_temp/' });

function checkApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// Detect separator
function getSep(line) {
  return line.includes('\t') ? '\t' : ',';
}

// Smart parser — scans for known row labels instead of fixed line numbers
function parseHeader(lines) {
  const sep         = getSep(lines[0]);
  let breakerName   = '125_Breaker';
  let dataStartIdx  = -1;
  let totalRowIdx   = -1;
  let unitRowIdx    = -1;
  let units         = [];

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cols     = lines[i].split(sep).map(c => c.trim().replace(/"/g, ''));
    const firstCol = cols[0].toLowerCase().trim();

    // Find breaker name from "Load Name" row
    if (firstCol === 'load name') {
      for (let c = 1; c < cols.length; c++) {
        if (cols[c] && cols[c].length > 0 && cols[c] !== 'Load Name') {
          breakerName = cols[c];
          break;
        }
      }
    }

    // Find unit row (W, var, VA, kWh etc)
    if (firstCol === 'unit') {
      units = cols.slice(1).filter(u => u.length > 0);
      unitRowIdx = i;
    }

    // Find "Date" header row — data starts next line
    if (firstCol === 'date') {
      dataStartIdx = i + 1;
    }

    // Find "Total" row in Index files
    if (firstCol === 'total') {
      totalRowIdx = i;
    }
  }

  return { sep, breakerName, dataStartIdx, totalRowIdx, unitRowIdx, units };
}

router.post('/csv', checkApiKey, upload.single('file'), async (req, res) => {
  const { site_id } = req.body;
  if (!site_id || !req.file) {
    return res.status(400).json({ error: 'site_id and file are required' });
  }

  try {
    const content  = fs.readFileSync(req.file.path, 'utf8');
    const allLines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const filename = req.file.originalname || '';
    const fn       = filename.toLowerCase();
    const client   = await pool.connect();
    let result     = {};

    try {
      // Ensure unique index exists
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_unique
        ON energy_readings (site_id, breaker_name, recorded_at)
      `).catch(() => {});

      const h = parseHeader(allLines);

      // ── LOADCURVE FILE ──────────────────────────────────────────
      // Has 15-min interval data: W, var, VA columns
      // Convert: W/1000 = kW, VA/1000 = kVA
      if (fn.includes('loadcurve')) {

        if (h.dataStartIdx < 0) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'Could not find Date header in LoadCurve file' });
        }

        let inserted = 0;
        let updated  = 0;

        for (let i = h.dataStartIdx; i < allLines.length; i++) {
          const cols = allLines[i].split(h.sep);
          if (cols.length < 4) continue;

          const recorded_at = new Date(cols[0].trim());
          if (isNaN(recorded_at.getTime())) continue;

          // Col B = W (Active Power) → kW
          // Col D = VA (Apparent Power) → kVA
          const w_val  = parseFloat(cols[1]) || 0;
          const va_val = parseFloat(cols[3]) || 0;

          const kw  = w_val  / 1000;
          const kva = va_val / 1000;

          try {
            const r = await client.query(
              `INSERT INTO energy_readings
               (site_id, breaker_name, recorded_at, kwh, kva, voltage)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (site_id, breaker_name, recorded_at)
               DO UPDATE SET kwh = EXCLUDED.kwh, kva = EXCLUDED.kva
               RETURNING (xmax = 0) AS is_new`,
              [parseInt(site_id), h.breakerName, recorded_at, kw, kva, null]
            );
            if (r.rows[0] && r.rows[0].is_new) inserted++;
            else updated++;
          } catch (e) { /* skip row */ }
        }

        result = {
          success: true,
          type: 'LoadCurve',
          breaker: h.breakerName,
          rows_inserted: inserted,
          rows_updated: updated,
          message: `${inserted} new + ${updated} updated rows`
        };

      // ── INDEX FILE ──────────────────────────────────────────────
      // Has Total and Average rows with kWh or kVA summary values
      } else if (fn.includes('index')) {

        if (h.totalRowIdx < 0) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'Could not find Total row in Index file' });
        }

        const totalCols = allLines[h.totalRowIdx].split(h.sep)
          .map(c => c.trim().replace(/"/g, ''));

        // Get unit to determine if kWh or kVA
        const unitStr = (h.units[0] || '').toLowerCase();
        const totalVal = parseFloat(totalCols[1]) || 0;

        // Extract date from filename
        let recorded_at = new Date();
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) recorded_at = new Date(dateMatch[1]);

        const isKwh = unitStr.includes('wh') || unitStr.includes('kwh');
        const isKva = unitStr.includes('va') && !unitStr.includes('wh');

        if (isKwh) {
          await client.query(
            `INSERT INTO energy_readings
             (site_id, breaker_name, recorded_at, kwh, kva, voltage)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (site_id, breaker_name, recorded_at)
             DO UPDATE SET kwh = EXCLUDED.kwh`,
            [parseInt(site_id), h.breakerName, recorded_at, totalVal, null, null]
          );
        } else if (isKva) {
          const existing = await client.query(
            `SELECT id FROM energy_readings
             WHERE site_id=$1 AND breaker_name=$2
             AND DATE(recorded_at)=DATE($3)
             ORDER BY uploaded_at DESC LIMIT 1`,
            [parseInt(site_id), h.breakerName, recorded_at]
          );
          if (existing.rows.length > 0) {
            await client.query(
              `UPDATE energy_readings SET kva=$1 WHERE id=$2`,
              [totalVal, existing.rows[0].id]
            );
          } else {
            await client.query(
              `INSERT INTO energy_readings
               (site_id, breaker_name, recorded_at, kwh, kva, voltage)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (site_id, breaker_name, recorded_at)
               DO UPDATE SET kva = EXCLUDED.kva`,
              [parseInt(site_id), h.breakerName, recorded_at, null, totalVal, null]
            );
          }
        }

        result = {
          success: true,
          type: isKwh ? 'kWh Index' : isKva ? 'kVA Index' : 'Index',
          breaker: h.breakerName,
          total_value: totalVal,
          unit: unitStr
        };

      // ── AVG FILE ────────────────────────────────────────────────
      // Average values — store as reference, skip cost calculation
      } else if (fn.includes('avg')) {

        // Just acknowledge — we do not store average files
        result = {
          success: true,
          type: 'Avg',
          message: 'Average file received — skipped (not stored)'
        };

      // ── TRENDS FILE ─────────────────────────────────────────────
      // Legacy format: header row then tab-separated data
      } else if (fn.includes('trends')) {

        const headers = allLines[0].split('\t');
        let breakerName = 'Unknown';
        for (let hh = 2; hh < headers.length; hh++) {
          const parts = (headers[hh] || '').split(':');
          if (parts[0] && parts[0].trim().length > 0) {
            breakerName = parts[0].trim();
            break;
          }
        }

        let inserted = 0, updated = 0;
        for (let i = 1; i < allLines.length; i++) {
          const cols = allLines[i].split('\t');
          if (cols.length < 5) continue;
          const recorded_at = new Date(cols[0].trim());
          if (isNaN(recorded_at.getTime())) continue;
          const kva = parseFloat(cols[3]) || null;
          const kw  = parseFloat(cols[4]) || null;
          try {
            const r = await client.query(
              `INSERT INTO energy_readings
               (site_id, breaker_name, recorded_at, kwh, kva, voltage)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (site_id, breaker_name, recorded_at)
               DO UPDATE SET kwh=EXCLUDED.kwh, kva=EXCLUDED.kva
               RETURNING (xmax=0) AS is_new`,
              [parseInt(site_id), breakerName, recorded_at, kw, kva, null]
            );
            if (r.rows[0] && r.rows[0].is_new) inserted++;
            else updated++;
          } catch (e) { /* skip */ }
        }

        result = {
          success: true,
          type: 'Trends',
          breaker: breakerName,
          rows_inserted: inserted,
          rows_updated: updated
        };

      // ── UNKNOWN FILE ────────────────────────────────────────────
      } else {
        result = {
          success: true,
          type: 'Unknown',
          filename: filename,
          message: 'File type not recognised — skipped'
        };
      }

    } finally {
      client.release();
    }

    fs.unlinkSync(req.file.path);

    // Only calculate costs for files that store data
    if (result.type !== 'Avg' && result.type !== 'Unknown') {
      try {
        await calculateCosts(parseInt(site_id));
      } catch (calcErr) {
        console.error('Cost calc error:', calcErr.message);
      }
    }

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
