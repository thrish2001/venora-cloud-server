const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const pool = require('../db');
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
      // ── TRENDS FILE ────────────────────────────────────────────
      // Format: header row, then data rows newest-first (15-min intervals)
      // We only want the LATEST (first data row) kW and kVA values
      if (filename.toLowerCase().includes('trends')) {

        // Row 0 = header: Local Time, UTC, breaker:kvar, breaker:kVA, breaker:kW
        const headers    = lines[0].split('\t');
        const breakerRaw = (headers[2] || '').split(':')[0].trim() || '125_Breaker';
        const breakerName = breakerRaw;

        // Row 1 = most recent reading (file is newest-first)
        const latestRow = lines[1] ? lines[1].split('\t') : null;

        if (!latestRow || latestRow.length < 5) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'No data rows found in Trends file' });
        }

        const recorded_at = new Date(latestRow[0].trim());
        const kva  = parseFloat(latestRow[3]) || null;  // column 4 = kVA
        const kw   = parseFloat(latestRow[4]) || null;  // column 5 = kW

        if (isNaN(recorded_at.getTime())) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'Invalid timestamp in Trends file' });
        }

        // Delete existing record for same breaker + same date
        // so we always keep only the latest value
        await client.query(
          `DELETE FROM energy_readings
           WHERE site_id = $1
             AND breaker_name = $2
             AND DATE(recorded_at) = DATE($3)`,
          [parseInt(site_id), breakerName, recorded_at]
        );

        // Insert the latest reading
        await client.query(
          `INSERT INTO energy_readings
           (site_id, breaker_name, recorded_at, kwh, kva, voltage)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [parseInt(site_id), breakerName, recorded_at, kw, kva, null]
        );

        result = {
          success: true,
          type: 'Trends',
          breaker: breakerName,
          recorded_at: recorded_at,
          kw: kw,
          kva: kva,
          rows_inserted: 1
        };

      // ── INDEX FILE ─────────────────────────────────────────────
      // Format: Row 0 = measurement type + breaker name
      //         Row 1 = Total value
      } else {

        const row1 = lines[0].replace(/"/g, '').split(',');
        const measurementType = (row1[0] || '').trim();
        const breakerName     = (row1[1] || 'Unknown').trim();

        const row2 = lines[1].replace(/"/g, '').split(',');
        const label    = (row2[0] || '').trim().toLowerCase();
        const totalVal = parseFloat(row2[1] || 0);
        const unit     = (row2[2] || '').trim().toLowerCase();

        if (label !== 'total' || isNaN(totalVal)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'Could not find Total row in Index file' });
        }

        // Extract date from filename
        let recorded_at = new Date();
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) recorded_at = new Date(dateMatch[1]);

        const isKwh = unit.includes('kwh') || measurementType.toLowerCase().includes('ea');
        const isKva = unit.includes('kva') || measurementType.toLowerCase().includes('demand');

        if (isKwh) {
          // Delete existing kWh record for same date and breaker
          await client.query(
            `DELETE FROM energy_readings
             WHERE site_id=$1 AND breaker_name=$2
             AND DATE(recorded_at)=DATE($3)
             AND kva IS NULL`,
            [parseInt(site_id), breakerName, recorded_at]
          );
          await client.query(
            `INSERT INTO energy_readings
             (site_id, breaker_name, recorded_at, kwh, kva, voltage)
             VALUES ($1, $2, $3, $4, $5, $6)`,
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
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [parseInt(site_id), breakerName, recorded_at, null, totalVal, null]
            );
          }
        }

        result = {
          success: true,
          type: isKwh ? 'kWh' : 'kVA',
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