// routes/analytics.js — Full analytics with Peak/Day/Off-Peak and date filtering

const express = require('express');
const router = express.Router();
const pool = require('../db');

const DAY_RATE = 19.00; // LECO Day rate LKR/kWh (09:00-17:00)

// ── MAIN DASHBOARD ENDPOINT ──────────────────────────────────────────────────
// GET /api/analytics/dashboard?site_id=1&from=2026-06-01&to=2026-07-08&group_by=daily
router.get('/dashboard', async (req, res) => {
  const { site_id, from, to, group_by = 'daily' } = req.query;

  const fromDate = from || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
  const toDate   = to   || new Date().toISOString().split('T')[0];

  try {
    // Get tariff config for this site
    const tariffResult = await pool.query(
      'SELECT * FROM tariff_config WHERE site_id = $1 LIMIT 1', [site_id]
    );
    const t = tariffResult.rows[0] || {
      peak_start: 17, peak_end: 22,
      unit_rate_peak: 39.00, unit_rate_offpeak: 16.50,
      demand_charge_per_kva: 1650
    };

    // Group expression based on view type
    const groupMap = {
      hourly:  "DATE_TRUNC('hour',  recorded_at)",
      daily:   "DATE_TRUNC('day',   recorded_at)",
      weekly:  "DATE_TRUNC('week',  recorded_at)",
      monthly: "DATE_TRUNC('month', recorded_at)"
    };
    const groupExpr = groupMap[group_by] || groupMap.daily;

    // Energy conversion:
    // Trends files (kva IS NOT NULL AND kwh IS NOT NULL): kW × 0.25 = kWh per 15-min interval
    // Index files  (kva IS NULL    AND kwh IS NOT NULL): kwh is already total kWh
    const energyExpr = `CASE
      WHEN kva IS NOT NULL AND kwh IS NOT NULL THEN kwh * 0.25
      WHEN kva IS NULL     AND kwh IS NOT NULL THEN kwh
      ELSE 0
    END`;

    const result = await pool.query(`
      SELECT
        ${groupExpr} AS period,
        SUM(${energyExpr}) AS total_kwh,
        MAX(COALESCE(kva, 0)) AS max_kva,

        SUM(CASE
          WHEN EXTRACT(HOUR FROM recorded_at) >= $4
           AND EXTRACT(HOUR FROM recorded_at) <  $5
          THEN (${energyExpr}) ELSE 0
        END) AS peak_kwh,

        SUM(CASE
          WHEN EXTRACT(HOUR FROM recorded_at) >= 9
           AND EXTRACT(HOUR FROM recorded_at) <  $4
          THEN (${energyExpr}) ELSE 0
        END) AS day_kwh,

        SUM(CASE
          WHEN EXTRACT(HOUR FROM recorded_at) <  9
            OR EXTRACT(HOUR FROM recorded_at) >= $5
          THEN (${energyExpr}) ELSE 0
        END) AS offpeak_kwh,

        COUNT(*) AS reading_count

      FROM energy_readings
      WHERE site_id = $1
        AND recorded_at >= $2::timestamp
        AND recorded_at <= ($3::timestamp + INTERVAL '1 day')
      GROUP BY ${groupExpr}
      ORDER BY period ASC
    `, [site_id, fromDate, toDate, t.peak_start, t.peak_end]);

    // Calculate costs per period
    const timeSeries = result.rows.map(row => {
      const peak_kwh    = parseFloat(row.peak_kwh    || 0);
      const day_kwh     = parseFloat(row.day_kwh     || 0);
      const offpeak_kwh = parseFloat(row.offpeak_kwh || 0);
      const total_kwh   = parseFloat(row.total_kwh   || 0);
      const max_kva     = parseFloat(row.max_kva     || 0);

      const peak_cost    = peak_kwh    * t.unit_rate_peak;
      const day_cost     = day_kwh     * DAY_RATE;
      const offpeak_cost = offpeak_kwh * t.unit_rate_offpeak;
      const total_cost   = peak_cost + day_cost + offpeak_cost;

      return {
        period:       row.period,
        total_kwh:    +total_kwh.toFixed(3),
        max_kva:      +max_kva.toFixed(3),
        peak_kwh:     +peak_kwh.toFixed(3),
        day_kwh:      +day_kwh.toFixed(3),
        offpeak_kwh:  +offpeak_kwh.toFixed(3),
        peak_cost:    +peak_cost.toFixed(2),
        day_cost:     +day_cost.toFixed(2),
        offpeak_cost: +offpeak_cost.toFixed(2),
        total_cost:   +total_cost.toFixed(2),
        reading_count: parseInt(row.reading_count)
      };
    });

    // Aggregate KPIs
    const kpis = timeSeries.reduce((acc, r) => {
      acc.total_kwh    += r.total_kwh;
      acc.total_cost   += r.total_cost;
      acc.peak_kwh     += r.peak_kwh;
      acc.day_kwh      += r.day_kwh;
      acc.offpeak_kwh  += r.offpeak_kwh;
      acc.peak_cost    += r.peak_cost;
      acc.day_cost     += r.day_cost;
      acc.offpeak_cost += r.offpeak_cost;
      acc.max_kva       = Math.max(acc.max_kva, r.max_kva);
      return acc;
    }, { total_kwh:0, total_cost:0, peak_kwh:0, day_kwh:0, offpeak_kwh:0,
         peak_cost:0, day_cost:0, offpeak_cost:0, max_kva:0 });

    kpis.avg_tariff      = kpis.total_kwh > 0 ? +(kpis.total_cost / kpis.total_kwh).toFixed(2) : 0;
    kpis.offpeak_savings = +(kpis.peak_kwh * (t.unit_rate_peak - t.unit_rate_offpeak)).toFixed(2);
    kpis.demand_cost     = +(kpis.max_kva * t.demand_charge_per_kva).toFixed(2);

    res.json({
      kpis,
      time_series: timeSeries,
      tou_breakdown: [
        { period: 'Peak',     kwh: +kpis.peak_kwh.toFixed(2),    cost: +kpis.peak_cost.toFixed(2),    rate: t.unit_rate_peak,    hours: '17:00 – 22:00' },
        { period: 'Day',      kwh: +kpis.day_kwh.toFixed(2),     cost: +kpis.day_cost.toFixed(2),     rate: DAY_RATE,             hours: '09:00 – 17:00' },
        { period: 'Off-Peak', kwh: +kpis.offpeak_kwh.toFixed(2), cost: +kpis.offpeak_cost.toFixed(2), rate: t.unit_rate_offpeak, hours: '22:00 – 09:00' },
      ],
      tariff: { ...t, day_rate: DAY_RATE },
      meta: { from: fromDate, to: toDate, group_by, site_id }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── LEGACY ENDPOINTS (kept for Grafana compatibility) ────────────────────────

router.get('/total', async (req, res) => {
  const { site_id } = req.query;
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COALESCE(SUM(CASE WHEN kva IS NOT NULL AND kwh IS NOT NULL THEN kwh*0.25 ELSE COALESCE(kwh,0) END),0) FROM energy_readings WHERE site_id=$1) AS total_kwh,
        (SELECT COALESCE(SUM(total_cost_lkr),0) FROM daily_cost_summary WHERE site_id=$1) AS total_cost_lkr,
        (SELECT COALESCE(MAX(kva),0) FROM energy_readings WHERE site_id=$1) AS peak_kva,
        (SELECT COALESCE(SUM(CASE WHEN kva IS NOT NULL AND kwh IS NOT NULL THEN kwh*0.25 ELSE COALESCE(kwh,0) END),0) FROM energy_readings WHERE site_id=$1 AND DATE_TRUNC('month',recorded_at)=DATE_TRUNC('month',CURRENT_DATE)) AS month_kwh,
        (SELECT COALESCE(SUM(total_cost_lkr),0) FROM daily_cost_summary WHERE site_id=$1 AND DATE_TRUNC('month',summary_date)=DATE_TRUNC('month',CURRENT_DATE)) AS month_cost
    `, [site_id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trend', async (req, res) => {
  const { site_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT recorded_at, breaker_name, kwh, kva, voltage FROM energy_readings WHERE site_id=$1 ORDER BY recorded_at ASC`,
      [site_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/by-breaker', async (req, res) => {
  const { site_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT breaker_name, SUM(CASE WHEN kva IS NOT NULL AND kwh IS NOT NULL THEN kwh*0.25 ELSE COALESCE(kwh,0) END) AS total_kwh FROM energy_readings WHERE site_id=$1 GROUP BY breaker_name ORDER BY total_kwh DESC`,
      [site_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/cost-trend', async (req, res) => {
  const { site_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT summary_date, total_kwh, total_cost_lkr FROM daily_cost_summary WHERE site_id=$1 ORDER BY summary_date ASC`,
      [site_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/monthly-cost', async (req, res) => {
  const { site_id, month } = req.query;
  try {
    const result = await pool.query(
      `SELECT SUM(total_kwh) AS total_kwh, SUM(total_cost_lkr) AS total_cost_lkr, MAX(max_kva) AS peak_kva FROM daily_cost_summary WHERE site_id=$1 AND TO_CHAR(summary_date,'YYYY-MM')=$2`,
      [site_id, month]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;