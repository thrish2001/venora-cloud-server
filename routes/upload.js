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
      // Add unique constraint if not exists (runs silently)
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_unique
        ON energy_readings (site_id, breaker_name, recorded_at)
      `).catch(() => {});

      // ── TRENDS FILE ────────────────────────────────────────────
      if (filename.toLowerCase().includes('trends')) {

        const headers     = lines[0].split('\t');
        const breakerRaw  = (headers[2] || '').split(':')[0].trim();
        const breakerName = breakerRaw || '125_Breaker';

        let inserted = 0;
        let skipped  = 0;

        // Store ALL rows — skip duplicates silently
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split('\t');
          if (cols.length < 5) continue;

          const recorded_at = new Date(cols[0].trim());
          if (isNaN(recorded_at.getTime())) continue;

          const kva = parseFloat(cols[3]) || null;  // kVA
          const kw  = parseFloat(cols[4]) || null;  // kW

          try {
            await client.query(
              `INSERT INTO energy_readings
               (site_id, breaker_name, recorded_at, kwh, kva, voltage)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (site_id, breaker_name, recorded_at)
               DO UPDATE SET
                 kwh = EXCLUDED.kwh,
                 kva = EXCLUDED.kva`,
              [parseInt(site_id), breakerName, recorded_at, kw, kva, null]
            );
            inserted++;
          } catch (e) {
            skipped++;
          }
        }

        result = {
          success: true,
          type: 'Trends',
          breaker: breakerName,
          rows_inserted: inserted,
          rows_skipped: skipped
        };

      // ── INDEX FILE ─────────────────────────────────────────────
      } else {

        const row1 = lines[0].replace(/"/g, '').split(',');
        const measurementType = (row1[0] || '').trim();
        const breakerName     = (row1[1] || 'Unknown').trim();

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
             AND DATE(recorded_at) = DATE($3)
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
