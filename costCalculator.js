const pool = require('./db');

async function calculateCosts(site_id) {
  const client = await pool.connect();
  try {
    const tariffResult = await client.query(
      'SELECT * FROM tariff_config WHERE site_id = $1', [site_id]
    );
    if (tariffResult.rows.length === 0) {
      console.log(`No tariff found for site ${site_id}`);
      return;
    }
    const t = tariffResult.rows[0];

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

module.exports = { calculateCosts };