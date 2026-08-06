const express = require('express');
const router  = express.Router();
const pool    = require('../db');
require('dotenv').config();

const DAY_RATE = 19.00;

function checkApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// ── ADD PRODUCTION ENTRY ──────────────────────────────────────────────────────
router.post('/add', checkApiKey, async (req, res) => {
  const { site_id, production_date, shift, units_produced, unit_type, notes } = req.body;
  if (!site_id || !production_date || !shift || units_produced === undefined) {
    return res.status(400).json({ error: 'site_id, production_date, shift and units_produced are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO production_data
       (site_id, production_date, shift, units_produced, unit_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (site_id, production_date, shift)
       DO UPDATE SET units_produced=$4, unit_type=$5, notes=$6
       RETURNING *`,
      [site_id, production_date, shift, units_produced, unit_type || 'units', notes || '']
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LIST PRODUCTION DATA ──────────────────────────────────────────────────────
router.get('/list', async (req, res) => {
  const { site_id, from, to } = req.query;
  try {
    const result = await pool.query(
      `SELECT * FROM production_data
       WHERE site_id=$1 AND production_date>=$2 AND production_date<=$3
       ORDER BY production_date DESC, shift ASC`,
      [site_id, from || '2020-01-01', to || new Date().toISOString().split('T')[0]]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REGRESSION ANALYSIS ───────────────────────────────────────────────────────
// Returns energy vs production AND cost vs production regression
router.get('/regression', async (req, res) => {
  const { site_id, from, to } = req.query;
  const fromDate = from || '2020-01-01';
  const toDate   = to   || new Date().toISOString().split('T')[0];

  try {
    // Get tariff for cost calculation
    const tariffResult = await pool.query(
      'SELECT * FROM tariff_config WHERE site_id=$1 LIMIT 1', [site_id]
    );
    const t = tariffResult.rows[0] || {
      peak_start:17, peak_end:22,
      unit_rate_peak:39.00, unit_rate_offpeak:16.50,
      demand_charge_per_kva:1650
    };

    // Energy + cost per shift
    const energyResult = await pool.query(`
      SELECT
        DATE(recorded_at) AS date,
        CASE
          WHEN EXTRACT(HOUR FROM recorded_at) >= 6  AND EXTRACT(HOUR FROM recorded_at) < 14 THEN 'morning'
          WHEN EXTRACT(HOUR FROM recorded_at) >= 14 AND EXTRACT(HOUR FROM recorded_at) < 22 THEN 'evening'
          ELSE 'night'
        END AS shift,

        SUM(CASE
          WHEN kva IS NOT NULL AND kwh IS NOT NULL THEN kwh * 0.25
          WHEN kva IS NULL     AND kwh IS NOT NULL THEN kwh
          ELSE 0
        END) AS energy_kwh,

        SUM(CASE
          WHEN kva IS NOT NULL AND kwh IS NOT NULL
           AND EXTRACT(HOUR FROM recorded_at) >= $4
           AND EXTRACT(HOUR FROM recorded_at) <  $5
          THEN kwh * 0.25 ELSE 0
        END) AS peak_kwh,

        SUM(CASE
          WHEN kva IS NOT NULL AND kwh IS NOT NULL
           AND EXTRACT(HOUR FROM recorded_at) >= 9
           AND EXTRACT(HOUR FROM recorded_at) <  $4
          THEN kwh * 0.25 ELSE 0
        END) AS day_kwh,

        SUM(CASE
          WHEN kva IS NOT NULL AND kwh IS NOT NULL
           AND (EXTRACT(HOUR FROM recorded_at) < 9
            OR  EXTRACT(HOUR FROM recorded_at) >= $5)
          THEN kwh * 0.25 ELSE 0
        END) AS offpeak_kwh,

        MAX(CASE WHEN kva IS NOT NULL AND kva > 0 THEN kva ELSE NULL END) AS max_kva

      FROM energy_readings
      WHERE site_id=$1
        AND recorded_at >= $2::timestamp
        AND recorded_at <= ($3::timestamp + INTERVAL '1 day')
      GROUP BY DATE(recorded_at), shift
      ORDER BY date ASC, shift ASC
    `, [site_id, fromDate, toDate, t.peak_start, t.peak_end]);

    // Production per shift
    const prodResult = await pool.query(`
      SELECT production_date, shift, units_produced, unit_type
      FROM production_data
      WHERE site_id=$1 AND production_date>=$2 AND production_date<=$3
      ORDER BY production_date ASC, shift ASC
    `, [site_id, fromDate, toDate]);

    // Build energy lookup
    const energyMap = {};
    for (const row of energyResult.rows) {
      const dateStr = row.date.toISOString().split('T')[0];
      const key     = `${dateStr}_${row.shift}`;
      const pkwh    = parseFloat(row.peak_kwh    || 0);
      const dkwh    = parseFloat(row.day_kwh     || 0);
      const okwh    = parseFloat(row.offpeak_kwh || 0);
      const ikwh    = parseFloat(row.energy_kwh  || 0) - pkwh - dkwh - okwh;
      const cost    = pkwh * t.unit_rate_peak + dkwh * DAY_RATE + okwh * t.unit_rate_offpeak + Math.max(ikwh,0) * DAY_RATE;
      energyMap[key] = {
        energy_kwh: parseFloat(row.energy_kwh || 0),
        cost_lkr:   +cost.toFixed(2),
        max_kva:    parseFloat(row.max_kva || 0)
      };
    }

    // Match production with energy
    const points = [];
    for (const prod of prodResult.rows) {
      const dateStr = prod.production_date.toISOString().split('T')[0];
      const key     = `${dateStr}_${prod.shift}`;
      const energy  = energyMap[key];
      if (energy && energy.energy_kwh > 0 && parseFloat(prod.units_produced) > 0) {
        points.push({
          date:          dateStr,
          shift:         prod.shift,
          units:         parseFloat(prod.units_produced),
          unit_type:     prod.unit_type,
          energy_kwh:    energy.energy_kwh,
          cost_lkr:      energy.cost_lkr,
          energy_per_unit: +(energy.energy_kwh / parseFloat(prod.units_produced)).toFixed(3),
          cost_per_unit:   +(energy.cost_lkr   / parseFloat(prod.units_produced)).toFixed(2)
        });
      }
    }

    if (points.length < 2) {
      return res.json({
        points,
        energy_regression: null,
        cost_regression:   null,
        message: points.length === 0
          ? 'No matched data. Enter production data for dates that have energy readings.'
          : 'Need at least 2 matched data points for regression.'
      });
    }

    // Linear regression helper
    function calcRegression(x, y, unitType, yLabel) {
      const n    = x.length;
      const sumX = x.reduce((a,b)=>a+b, 0);
      const sumY = y.reduce((a,b)=>a+b, 0);
      const sumXY= x.reduce((acc,xi,i)=>acc+xi*y[i], 0);
      const sumXX= x.reduce((acc,xi)=>acc+xi*xi, 0);
      const m    = (n*sumXY - sumX*sumY) / (n*sumXX - sumX*sumX);
      const b    = (sumY - m*sumX) / n;
      const yMean= sumY / n;
      const ssTot= y.reduce((acc,yi)=>acc+Math.pow(yi-yMean,2), 0);
      const ssRes= x.reduce((acc,xi,i)=>acc+Math.pow(y[i]-(m*xi+b),2), 0);
      const r2   = ssTot===0 ? 0 : 1 - ssRes/ssTot;
      const xMin = Math.min(...x), xMax = Math.max(...x);
      return {
        slope:           +m.toFixed(4),
        intercept:       +b.toFixed(4),
        r2:              +r2.toFixed(4),
        r2_percent:      +(r2*100).toFixed(1),
        regression_line: [{x:xMin,y:+(m*xMin+b).toFixed(2)},{x:xMax,y:+(m*xMax+b).toFixed(2)}],
        avg_per_unit:    +(sumY/sumX).toFixed(3),
        baseline:        +b.toFixed(2),
        variable_per_unit: +m.toFixed(4),
        unit_type:       unitType,
        y_label:         yLabel,
        interpretation:  r2>=0.8?'Strong correlation':r2>=0.5?'Moderate correlation':'Weak correlation'
      };
    }

    const x = points.map(p => p.units);
    res.json({
      points,
      energy_regression: calcRegression(x, points.map(p=>p.energy_kwh), points[0].unit_type, 'kWh'),
      cost_regression:   calcRegression(x, points.map(p=>p.cost_lkr),   points[0].unit_type, 'LKR'),
      summary: { total_points: points.length, date_range: `${fromDate} to ${toDate}` }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;