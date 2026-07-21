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

// Detect separator (tab or comma)
function getSeparator(line) {
  return line.includes('\t') ? '\t' : ',';
}

router.post('/csv', checkApiKey, upload.single('file'), async (req, res) => {
  const { site_id } = req.body;
  if (!site_id || !req.file) {
    return res.status(400).json({ error: 'site_id and file are required' });
  }

  try {
    const content  = fs.readFileSync(req.file.path, 'utf8');
    const lines    = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const filename = req.file.originalname || '';
    const client   = await pool.connect();
    let result = {};

    try {
      // Ensure unique index exists
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_unique
        ON energy_readings (site_id, breaker_name, recorded_at)
      `).catch(() => {});

      // ── LOADCURVE FILE ──────────────────────────────────────────
      // File: I_35@3_LoadCurve_2026-07-21_08-45-05.csv
      // Structure:
      //   Row 1:  Device name, IP, Modbus, Begin date, End date
      //   Row 4:  Load Name, 125_Breaker, 125_Breaker, 125_Breaker
      //   Row 7:  Measured value, P+(W), Q+(var), S(VA)
      //   Row 8:  Unit, W, var, VA
      //   Row 10: Date, Values, Values, Values, Flags
      //   Row 11+: timestamp, W_value, var_value, VA_value, flags
      if (filename.toLowerCase().includes('loadcurve')) {

        const sep = getSeparator(lines[0]);

        // Row 4 (index 3) = Load names
        const nameRow    = lines[3] ? lines[3].split(sep) : [];
        const breakerName = (nameRow[1] && nameRow[1].trim().length > 0)
          ? nameRow[1].trim() : '125_Breaker';

        // Data starts at row 11 (index 10)
        let inserted = 0;
        let updated  = 0;

        for (let i = 10; i < lines.length; i++) {
          const cols = lines[i].split(sep);
          if (cols.length < 4) continue;

          // Column A = timestamp
          const recorded_at = new Date(cols[0].trim());
          if (isNaN(recorded_at.getTime())) continue;

          // Skip flag/summary rows
          if (cols[0].trim().length < 10) continue;

          // Column B = W (Active Power) → convert to kW
          const w_val  = parseFloat(cols[1]) || 0;
          // Column D = VA (Apparent Power) → convert to kVA
          const va_val = parseFloat(cols[3]) || 0;

          // Store kW in kwh column (analytics multiplies by 0.25 for kWh)
          const kw  = w_val  / 1000;  // W → kW
          const kva = va_val / 1000;  // VA → kVA

          try {
            const r = await client.query(
              `INSERT INTO energy_readings
               (site_id, breaker_name, recorded_at, kwh, kva, voltage)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (site_id, breaker_name, recorded_at)
               DO UPDATE SET kwh = EXCLUDED.kwh, kva = EXCLUDED.kva
               RETURNING (xmax = 0) AS inserted`,
              [parseInt(site_id), breakerName, recorded_at, kw, kva, null]
            );
            if (r.rows[0] && r.rows[0].inserted) inserted++;
            else updated++;
          } catch (e) {
            // skip row errors silently
          }
        }

        result = {
          success: true,
          type: 'LoadCurve',
          breaker: breakerName,
          rows_inserted: inserted,
          rows_updated: updated,
          message: `${inserted} new + ${updated} updated rows`
        };

      // ── TRENDS FILE ─────────────────────────────────────────────
      // File: Trends_2026-07-07_16-49-25.csv
      // Structure:
      //   Row 1: Local Time, UTC, breaker:kvar, breaker:kVA, breaker:kW
      //   Row 2+: timestamp, UTC, kvar, kVA, kW
      } else if (filename.toLowerCase().includes('trends')) {

        const headers = lines[0].split('\t');

        // Extract breaker name from header columns
        let breakerName = 'Unknown';
        for (let h = 2; h < headers.length; h++) {
          const parts = (headers[h] || '').split(':');
          if (parts[0] && parts[0].trim().length > 0) {
            breakerName = parts[0].trim();
            break;
          }
        }

        let inserted = 0;
        let updated  = 0;

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split('\t');
          if (cols.length < 5) continue;

          const recorded_at = new Date(cols[0].trim());
          if (isNaN(recorded_at.getTime())) continue;

          const kva = parseFloat(cols[3]) || null;  // column 4 = kVA
          const kw  = parseFloat(cols[4]) || null;  // column 5 = kW

          try {
            const r = await client.query(
              `INSERT INTO energy_readings
               (site_id, breaker_name, recorded_at, kwh, kva, voltage)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (site_id, breaker_name, recorded_at)
               DO UPDATE SET kwh = EXCLUDED.kwh, kva = EXCLUDED.kva
               RETURNING (xmax = 0) AS inserted`,
              [parseInt(site_id), breakerName, recorded_at, kw, kva, null]
            );
            if (r.rows[0] && r.rows[0].inserted) inserted++;
            else updated++;
          } catch (e) {
            // skip row errors silently
          }
        }

        result = {
          success: true,
          type: 'Trends',
          breaker: breakerName,
          rows_inserted: inserted,
          rows_updated: updated
        };

      // ── INDEX FILE ──────────────────────────────────────────────
      // File: I-35-3_Index_2026-07-01_15-15-07.csv
      // Structure:
      //   Row 1: Electricity - Ea+, 125_Breaker
      //   Row 2: Total, 24915.823, kWh
      //   Row 3: Average, ...
      } else {

        const row1 = lines[0].replace(/"/g, '').split(',');
        const measurementType = (row1[0] || '').trim();
        const breakerName     = (row1[1] && row1[1].trim().length > 0)
          ? row1[1].trim() : '125_Breaker';

        const row2     = lines[1].replace(/"/g, '').split(',');
        const label    = (row2[0] || '').trim().toLowerCase();
        const totalVal = parseFloat(row2[1] || 0);
        const unit     = (row2[2] || '').trim().toLowerCase();

        if (label !== 'total' || isNaN(totalVal)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'Could not find Total row in Index file' });
        }

        let recorded_at = new Date();
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) recorded_at = new Date(dateMatch[1]);

        const isKwh = unit.includes('kwh') || measurementType.toLowerCase().includes('ea');
        const isKva = unit.includes('kva') || measurementType.toLowerCase().includes('demand');

        if (isKwh) {
          await client.query(
            `INSERT INTO energy_readings
             (site_id, breaker_name, recorded_at, kwh, kva, voltage)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (site_id, breaker_name, recorded_at)
             DO UPDATE SET kwh = EXCLUDED.kwh`,
            [parseInt(site_id), breakerName, recorded_at, totalVal, null, null]
          );
        } else if (isKva) {
          const existing = await client.query(
            `SELECT id FROM energy_readings
             WHERE site_id=$1 AND breaker_name=$2
             AND DATE(recorded_at)=DATE($3)
             ORDER BY uploaded_at DESC LIMIT 1`,
            [parseInt(site_id), breakerName, recorded_at]
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
              [parseInt(site_id), breakerName, recorded_at, null, totalVal, null]
            );
          }
        }

        result = {
          success: true,
          type: isKwh ? 'kWh Index' : 'kVA Index',
          breaker: breakerName,
          total_value: totalVal,
          unit: unit
        };
      }

    } finally {
      client.release();
    }

    fs.unlinkSync(req.file.path);

    try {
      await calculateCosts(parseInt(site_id));
    } catch (calcErr) {
      console.error('Cost calc error:', calcErr.message);
    }

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;