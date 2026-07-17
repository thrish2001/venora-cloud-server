const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./db');
const { calculateCosts } = require('./costCalculator');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
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