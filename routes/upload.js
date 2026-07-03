const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const pool = require('../db');
require('dotenv').config();

const upload = multer({ dest: 'uploads_temp/' });

// Middleware: check API key
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
    const records = parse(content, {
      columns: true, skip_empty_lines: true, trim: true
    });

    const client = await pool.connect();
    let inserted = 0;
    try {
      for (const row of records) {
        // Adjust these column names to match your Dirisdigiware CSV headers
        await client.query(
          `INSERT INTO energy_readings
           (site_id, breaker_name, recorded_at, kwh, kva, voltage)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT DO NOTHING`,
          [
            parseInt(site_id),
            row['Breaker'] || row['Circuit'] || row['Name'] || 'Unknown',
            row['Timestamp'] || row['DateTime'] || row['Date'] || new Date(),
            parseFloat(row['kWh'] || row['Energy'] || 0),
          ]
        );
        inserted++;
      }
    } finally {
      client.release();
    }

    fs.unlinkSync(req.file.path); // delete temp file
    res.json({ success: true, rows_inserted: inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;