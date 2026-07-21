// routes/auth.js — User authentication and management

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
require('dotenv').config();

function checkApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const result = await pool.query(
      `SELECT u.*, s.name as site_name, s.contract_demand_kva, s.max_users
       FROM users u
       JOIN sites s ON s.id = u.site_id
       WHERE u.username = $1 AND u.active = true`,
      [username]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const u = result.rows[0];
    if (u.password !== password) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    res.json({
      username:   u.username,
      name:       u.display_name || u.username,
      site_id:    u.site_id,
      site_name:  u.site_name,
      role:       u.role,
      company:    u.company_name
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADD USER (admin only) ─────────────────────────────────────────────────────
router.post('/add-user', checkApiKey, async (req, res) => {
  const { username, password, site_id, display_name, role, company_name } = req.body;
  if (!username || !password || !site_id) {
    return res.status(400).json({ error: 'username, password and site_id are required' });
  }
  try {
    // Check user limit for this site
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM users WHERE site_id = $1 AND active = true`,
      [site_id]
    );
    const siteResult = await pool.query(
      `SELECT COALESCE(max_users, 2) as max_users FROM sites WHERE id = $1`,
      [site_id]
    );
    const currentCount = parseInt(countResult.rows[0].count);
    const maxUsers     = parseInt(siteResult.rows[0]?.max_users || 2);

    if (currentCount >= maxUsers) {
      return res.status(403).json({
        error: `User limit reached. This site allows ${maxUsers} users. Contact Venora Lanka to add more.`,
        current_users: currentCount,
        max_users: maxUsers
      });
    }

    await pool.query(
      `INSERT INTO users (username, password, site_id, display_name, company_name, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [username, password, site_id, display_name || username, company_name || '', role || 'viewer']
    );

    res.json({ success: true, message: `User ${username} created for site ${site_id}` });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── LIST USERS FOR A SITE ─────────────────────────────────────────────────────
router.get('/users', checkApiKey, async (req, res) => {
  const { site_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT username, display_name, company_name, role, active, created_at
       FROM users WHERE site_id = $1 ORDER BY created_at ASC`,
      [site_id]
    );
    const siteResult = await pool.query(
      `SELECT COALESCE(max_users, 2) as max_users FROM sites WHERE id = $1`,
      [site_id]
    );
    res.json({
      users: result.rows,
      count: result.rows.length,
      max_users: siteResult.rows[0]?.max_users || 2
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE USER LIMIT FOR A SITE ──────────────────────────────────────────────
router.post('/set-user-limit', checkApiKey, async (req, res) => {
  const { site_id, max_users } = req.body;
  try {
    await pool.query(
      `UPDATE sites SET max_users = $1 WHERE id = $2`,
      [max_users, site_id]
    );
    res.json({ success: true, site_id, max_users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DEACTIVATE USER ───────────────────────────────────────────────────────────
router.post('/deactivate-user', checkApiKey, async (req, res) => {
  const { username } = req.body;
  try {
    await pool.query(`UPDATE users SET active = false WHERE username = $1`, [username]);
    res.json({ success: true, message: `User ${username} deactivated` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
router.post('/change-password', checkApiKey, async (req, res) => {
  const { username, new_password } = req.body;
  try {
    await pool.query(`UPDATE users SET password = $1 WHERE username = $2`, [new_password, username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;