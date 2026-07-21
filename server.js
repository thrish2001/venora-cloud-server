const express = require('express');
const cors    = require('cors');
require('dotenv').config();
const pool = require('./db');
const { calculateCosts } = require('./costCalculator');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Load routes
app.use('/api/upload',    require('./routes/upload'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/sites',     require('./routes/sites'));
app.use('/api/tariff',    require('./routes/tariff'));
app.use('/api/auth',      require('./routes/auth'));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Venora Cloud Server is running', version: '2.0' });
});

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

// Create all database tables on first start
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        location VARCHAR(200),
        contract_demand_kva DECIMAL DEFAULT 100,
        max_units INT DEFAULT 10,
        max_users INT DEFAULT 2
      );
    `);
    await client.query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS max_units INT DEFAULT 10`);
    await client.query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 2`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tariff_config (
        id SERIAL PRIMARY KEY,
        site_id INT REFERENCES sites(id),
        fixed_charge_lkr DECIMAL DEFAULT 0,
        demand_charge_per_kva DECIMAL DEFAULT 0,
        unit_rate_peak DECIMAL DEFAULT 0,
        unit_rate_offpeak DECIMAL DEFAULT 0,
        peak_start INT DEFAULT 17,
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_unique
      ON energy_readings (site_id, breaker_name, recorded_at)
    `).catch(() => {});

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(200) NOT NULL,
        site_id INT REFERENCES sites(id),
        display_name VARCHAR(200),
        company_name VARCHAR(200),
        role VARCHAR(20) DEFAULT 'viewer',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('Database tables ready');
  } finally {
    client.release();
  }
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  await initDB();
  console.log('Server running on port ' + PORT);
});