const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const pool = require('../db');
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

    // Split into lines and clean them
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Extract breaker name from row 1 (e.g. "125_Breaker")
    const firstRowCols = lines[0].replace(/"/g, '').split(',');
    const breakerName = firstRowCols[1] ? firstRowCols[1].trim() : 'Unknown';

    // Data starts at row 4 (index 4) — skip rows 0,1,2,3
    const dataLines = lines.slice(4);

    const client = await pool.connect();
    let inserted = 0;

    try {
      for (const line of dataLines) {
        const cols = line.replace(/"/g, '').split(',');
        const dateStr = cols[0] ? cols[0].trim() : null;
        const valueStr = cols[2] ? cols[2].trim() : null;

        if (!dateStr || !valueStr) continue;

        const kwh = parseFloat(valueStr);
        if (isNaN(kwh)) continue;

        // Convert date format from 2026/06/01 to proper timestamp
        const recorded_at = new Date(dateStr.replace(/\//g, '-'));
        if (isNaN(recorded_at.getTime())) continue;

        await client.query(
          `INSERT INTO energy_readings
           (site_id, breaker_name, recorded_at, kwh, kva, voltage)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [parseInt(site_id), breakerName, recorded_at, kwh, null, null]
        );
        inserted++;
      }
    } finally {
      client.release();
    }

    fs.unlinkSync(req.file.path);
    res.json({ success: true, rows_inserted: inserted, breaker: breakerName });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;