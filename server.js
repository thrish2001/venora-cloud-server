const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// Load routes
app.use('/api/upload', require('./routes/upload'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/sites', require('./routes/sites'));
app.use('/api/tariff', require('./routes/tariff'));
// Health check — visit this URL to confirm the server is running
app.get('/', (req, res) => {
  res.json({ status: 'Venora Cloud Server is running', version: '1.0' });
});

// Create database tables on first start
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        location VARCHAR(200),
        contract_demand_kva DECIMAL DEFAULT 100
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS tariff_config (
        id SERIAL PRIMARY KEY,
        site_id INT REFERENCES sites(id),
        fixed_charge_lkr DECIMAL DEFAULT 0,
        demand_charge_per_kva DECIMAL DEFAULT 0,
        unit_rate_peak DECIMAL DEFAULT 0,
        unit_rate_offpeak DECIMAL DEFAULT 0,
        peak_start INT DEFAULT 18,
        peak_end INT DEFAULT 22
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS energy_readings (
        id SERIAL PRIMARY KEY,
        site_id INT REFERENCES sites(id),
        breaker_name VARCHAR(100),
        recorded_at TIMESTAMP,
        kwh DECIMAL,
        kva DECIMAL,
        voltage DECIMAL,
        uploaded_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_cost_summary (
        id SERIAL PRIMARY KEY,
        site_id INT REFERENCES sites(id),
        summary_date DATE,
        total_kwh DECIMAL,
        peak_kwh DECIMAL,
        offpeak_kwh DECIMAL,
        max_kva DECIMAL,
        total_cost_lkr DECIMAL,
        UNIQUE(site_id, summary_date)
      );
    `);
    console.log('Database tables ready');
  } finally {
    client.release();
  }
}
// Calculate and store daily costs
async function calculateCosts(site_id) {
  const client = await pool.connect();
  try {
    // Get tariff for this site
    const tariffResult = await client.query(
      'SELECT * FROM tariff_config WHERE site_id = $1', [site_id]
    );
    if (tariffResult.rows.length === 0) return;
    const t = tariffResult.rows[0];

    // Get all readings grouped by date
    const readings = await client.query(
      `SELECT DATE(recorded_at) as day,
              SUM(kwh) as total_kwh,
              MAX(COALESCE(kva, 0)) as max_kva,
              SUM(CASE WHEN EXTRACT(HOUR FROM recorded_at)
                BETWEEN $2 AND $3
                THEN kwh ELSE 0 END) as peak_kwh,
              SUM(CASE WHEN EXTRACT(HOUR FROM recorded_at)
                NOT BETWEEN $2 AND $3
                THEN kwh ELSE 0 END) as offpeak_kwh
       FROM energy_readings
       WHERE site_id = $1
       GROUP BY DATE(recorded_at)`,
      [site_id, t.peak_start, t.peak_end]
    );

    for (const row of readings.rows) {
      const energy_cost = (row.peak_kwh * t.unit_rate_peak) +
                          (row.offpeak_kwh * t.unit_rate_offpeak);
      const demand_cost = row.max_kva * t.demand_charge_per_kva;
      const total_cost = energy_cost + demand_cost;

      await client.query(
        `INSERT INTO daily_cost_summary
         (site_id, summary_date, total_kwh, peak_kwh, offpeak_kwh,
          max_kva, total_cost_lkr)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (site_id, summary_date) DO UPDATE SET
           total_kwh=$3, peak_kwh=$4, offpeak_kwh=$5,
           max_kva=$6, total_cost_lkr=$7`,
        [site_id, row.day, row.total_kwh, row.peak_kwh,
         row.offpeak_kwh, row.max_kva, total_cost]
      );
    }
    console.log(`Costs calculated for site ${site_id}`);
  } finally {
    client.release();
  }
}

// Expose cost calculation endpoint
app.post('/api/calculate-costs', async (req, res) => {
  const key = req.headers['x-api-key'];
  if (key !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const { site_id } = req.body;
  await calculateCosts(site_id);
  res.json({ success: true });
});
const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  await initDB();
  console.log('Server running on port ' + PORT);
});
app.use('/api/sites', require('./routes/sites'));