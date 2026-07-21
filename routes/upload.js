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

// Detect separator for a single line
function lineSep(line) {
  return line.includes('\t') ? '\t' : ',';
}

// Split a line using its own separator
function splitLine(line) {
  return line.split(lineSep(line)).map(c => c.trim().replace(/"/g, ''));
}

// Smart header parser — scans ALL lines, detects per-line separator
function parseHeader(lines) {
  let breakerName  = null;
  let dataStartIdx = -1;
  let totalRowIdx  = -1;
  let totalSep     = ',';
  let units        = [];

  for (let i = 0; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    const fc   = cols[0].toLowerCase().trim();

    // Load Name row — get first non-empty breaker name
    if (fc === 'load name') {
      for (let c = 1; c < cols.length; c++) {
        const v = cols[c].trim();
        if (v && v.length > 0 && v.toLowerCase() !== 'load name') {
          breakerName = v;
          break;
        }
      }
    }

    // Unit row
    if (fc === 'unit') {
      units = cols.slice(1).filter(u => u.length > 0);
    }

    // Date header row — data starts after this
    if (fc === 'date') {
      dataStartIdx = i + 1;
    }

    // Total row — used by Index files
    if (fc.includes('total') && !fc.includes('sub')) {
      totalRowIdx = i;
      totalSep    = lineSep(lines[i]);
    }
  }

  // Fallback breaker name
  if (!breakerName) breakerName = '125_Breaker';

  return { breakerName, dataStartIdx, totalRowIdx, totalSep, units };
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
      if (fn.includes('loadcurve')) {

        if (h.dataStartIdx < 0) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'No Date header found in LoadCurve file' });
        }

        let processed = 0;

        for (let i = h.dataStartIdx; i < allLines.length; i++) {
          const cols = splitLine(allLines[i]);
          if (cols.length < 4) continue;

          const recorded_at = new Date(cols[0].trim());
          if (isNaN(recorded_at.getTime())) continue;
          if (cols[0].trim().length < 10) continue;

          // Col B = W → kW, Col D = VA → kVA
          const kw  = (parseFloat(cols[1]) || 0) / 1000;
          const kva = (parseFloat(cols[3]) || 0) / 1000;

          try {
            await client.query(
              `INSERT INTO energy_readings
               (site_id, breaker_name, recorded_at, kwh, kva, voltage)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (site_id, breaker_name, recorded_at)
               DO UPDATE SET kwh = EXCLUDED.kwh, kva = EXCLUDED.kva`,
              [parseInt(site_id), h.breakerName, recorded_at, kw, kva, null]
            );
            processed++;
          } catch (e) { /* skip row */ }
        }

        result = {
          success: true,
          type: 'LoadCurve',
          breaker: h.breakerName,
          rows_processed: processed,
          message: `${processed} rows processed`
        };

      // ── INDEX FILE ──────────────────────────────────────────────
      } else if (fn.includes('index')) {

        if (h.totalRowIdx < 0) {
          // Try to find total by scanning for numeric rows
          fs.unlinkSync(req.file.path);
          return res.status(400).json({
            error: 'Total row not found. File may use different format.',
            breaker: h.breakerName,
            lines_scanned: allLines.length
          });
        }

        const totalCols = allLines[h.totalRowIdx].split(h.totalSep)
          .map(c => c.trim().replace(/"/g, ''));

        const totalVal = parseFloat(totalCols[1]) || 0;
        const unitStr  = (h.units[0] || '').toLowerCase();

        // Extract date from filename
        let recorded_at = new Date();
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) recorded_at = new Date(dateMatch[1]);

        const isKwh = unitStr.includes('wh');
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
          await client.query(
            `INSERT INTO energy_readings
             (site_id, breaker_name, recorded_at, kwh, kva, voltage)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (site_id, breaker_name, recorded_at)
             DO UPDATE SET kva = EXCLUDED.kva`,
            [parseInt(site_id), h.breakerName, recorded_at, null, totalVal, null]
          );
        }

        result = {
          success: true,
          type: isKwh ? 'kWh Index' : isKva ? 'kVA Index' : 'Index',
          breaker: h.breakerName,
          total_value: totalVal,
          unit: unitStr
        };

      // ── AVG FILE — skip gracefully ──────────────────────────────
      } else if (fn.includes('avg')) {

        result = { success: true, type: 'Avg', message: 'Skipped' };

      // ── TRENDS FILE ─────────────────────────────────────────────
      } else if (fn.includes('trends')) {

        const headers = allLines[0].split('\t');
        let breakerName = h.breakerName;
        for (let hh = 2; hh < headers.length; hh++) {
          const parts = (headers[hh] || '').split(':');
          if (parts[0] && parts[0].trim().length > 0) {
            breakerName = parts[0].trim();
            break;
          }
        }

        let processed = 0;
        for (let i = 1; i < allLines.length; i++) {
          const cols = allLines[i].split('\t');
          if (cols.length < 5) continue;
          const recorded_at = new Date(cols[0].trim());
          if (isNaN(recorded_at.getTime())) continue;
          const kva = parseFloat(cols[3]) || null;
          const kw  = parseFloat(cols[4]) || null;
          try {
            await client.query(
              `INSERT INTO energy_readings
               (site_id, breaker_name, recorded_at, kwh, kva, voltage)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (site_id, breaker_name, recorded_at)
               DO UPDATE SET kwh=EXCLUDED.kwh, kva=EXCLUDED.kva`,
              [parseInt(site_id), breakerName, recorded_at, kw, kva, null]
            );
            processed++;
          } catch (e) { /* skip */ }
        }

        result = { success: true, type: 'Trends', breaker: breakerName, rows_processed: processed };

      // ── UNKNOWN ─────────────────────────────────────────────────
      } else {
        result = { success: true, type: 'Unknown', filename, message: 'Skipped' };
      }

    } finally {
      client.release();
    }

    fs.unlinkSync(req.file.path);

    if (!['Avg', 'Unknown'].includes(result.type)) {
      try { await calculateCosts(parseInt(site_id)); } catch (e) { }
    }

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
