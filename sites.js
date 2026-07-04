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

router.post('/', checkApiKey, async (req, res) => {
  const { name, location, contract_demand_kva } = req.body;
  const result = await pool.query(
    `INSERT INTO sites (name, location, contract_demand_kva)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, location, contract_demand_kva]
  );
  res.json(result.rows[0]);
});

module.exports = router;