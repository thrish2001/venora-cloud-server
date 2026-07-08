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
    const content = fs.readFileSync(req.file.path, 'utf8');
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const row1 = lines[0].replace(/"/g, '').split(',');
    const measurementType = (row1[0] || '').trim();
    const breakerName     = (row1[1] || 'Unknown').trim();

    const row2 = lines[1].replace(/"/g, '').split(',');
    const label    = (row2[0] || '').trim().toLowerCase();
    const totalVal = parseFloat(row2[1] || 0);
    const unit     = (row2[2] || '').trim().toLowerCase();

    if (label !== 'total' || isNaN(totalVal)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Could not find Total row in CSV' });
    }

    let recorded_at = new Date();
    const filename = req.file.originalname || '';
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      recorded_at = new Date(dateMatch[1]);
    }

    const isKwh = unit.includes('kwh') || measurementType.toLowerCase().includes('ea');
    const isKva = unit.includes('kva') || measurementType.toLowerCase().includes('demand');

    const client = await pool.connect();
    try {
      if (isKwh) {
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
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [parseInt(site_id), breakerName, recorded_at, null, totalVal, null]
          );
        }
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

    res.json({
      success: true,
      breaker: breakerName,
      type: isKwh ? 'kWh' : isKva ? 'kVA' : 'Unknown',
      total_value: totalVal,
      unit: unit,
      recorded_date: recorded_at
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;