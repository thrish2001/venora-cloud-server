const express = require('express');
const router = express.Router();
const pool = require('../db');
require('dotenv').config();

function checkApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// Save tariff config for a site
router.post('/', checkApiKey, async (req, res) => {
  const {
    site_id, fixed_charge_lkr, demand_charge_per_kva,
    unit_rate_peak, unit_rate_day, unit_rate_offpeak,
    peak_start, peak_end, day_start, day_end
  } = req.body;

  const result = await pool.query(
    `INSERT INTO tariff_config
     (site_id, fixed_charge_lkr, demand_charge_per_kva,
      unit_rate_peak, unit_rate_offpeak, peak_start, peak_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (site_id) DO UPDATE SET
       fixed_charge_lkr = $2,
       demand_charge_per_kva = $3,
       unit_rate_peak = $4,
       unit_rate_offpeak = $5,
       peak_start = $6,
       peak_end = $7
     RETURNING *`,
    [site_id, fixed_charge_lkr, demand_charge_per_kva,
     unit_rate_peak, unit_rate_offpeak, peak_start, peak_end]
  );
  res.json(result.rows[0]);
});

module.exports = router;