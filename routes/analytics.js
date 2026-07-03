const express = require('express');
const router = express.Router();
const pool = require('../db');

// Monthly cost summary for a site
router.get('/monthly-cost', async (req, res) => {
  const { site_id, month } = req.query; // month = '2025-06'
  const result = await pool.query(
    `SELECT
       SUM(total_kwh) AS total_kwh,
       SUM(total_cost_lkr) AS total_cost_lkr,
       MAX(max_kva) AS peak_kva
     FROM daily_cost_summary
     WHERE site_id=$1 AND TO_CHAR(summary_date,'YYYY-MM')=$2`,
    [site_id, month]
  );
  res.json(result.rows[0]);
});

// Cost breakdown by breaker
router.get('/by-breaker', async (req, res) => {
  const { site_id, month } = req.query;
  const result = await pool.query(
    `SELECT breaker_name, SUM(kwh) AS total_kwh
     FROM energy_readings
     WHERE site_id=$1 AND TO_CHAR(recorded_at,'YYYY-MM')=$2
     GROUP BY breaker_name ORDER BY total_kwh DESC`,
    [site_id, month]
  );
  res.json(result.rows);
});

// Demand risk check
router.get('/demand-risk', async (req, res) => {
  const { site_id } = req.query;
  const result = await pool.query(
    `SELECT s.contract_demand_kva,
            MAX(e.kva) AS current_max_kva
     FROM sites s
     JOIN energy_readings e ON e.site_id=s.id
     WHERE s.id=$1
     GROUP BY s.contract_demand_kva`,
    [site_id]
  );
  const row = result.rows[0];
  const risk_pct = row ? ((row.current_max_kva / row.contract_demand_kva) * 100).toFixed(1) : 0;
  res.json({ ...row, risk_percent: risk_pct });
});

module.exports = router;