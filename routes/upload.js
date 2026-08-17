// routes/upload.js — CSV upload with dual format support
// Format A (your meter): single combined "recorded_at" column  e.g. 2026-08-01 14:15:00
// Format B (other company): separate "Date" and "Time" columns e.g. 01/08/2026  14:15

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { calculateCosts } = require('../costCalculator');
require('dotenv').config();

// ── AUTH MIDDLEWARE ────────────────────────────────────────────────────────
function checkAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised — Bearer token required' });
  }
  const jwt = require('jsonwebtoken');
  try {
    req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── DATETIME PARSER ────────────────────────────────────────────────────────
// Accepts many formats and always returns a JS Date or null
function parseDateTime(raw) {
  if (!raw) return null;
  raw = String(raw).trim();

  // ISO / already standard: "2026-08-01 14:15:00" or "2026-08-01T14:15:00"
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) {
    const d = new Date(raw.replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }

  // DD/MM/YYYY HH:MM or DD/MM/YYYY HH:MM:SS
  if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
    const [datePart, timePart = '00:00:00'] = raw.split(' ');
    const [dd, mm, yyyy] = datePart.split('/');
    const d = new Date(`${yyyy}-${mm}-${dd}T${timePart}`);
    return isNaN(d) ? null : d;
  }

  // MM/DD/YYYY HH:MM
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) {
    const d = new Date(raw);
    return isNaN(d) ? null : d;
  }

  // Excel serial number (numeric only)
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const excelEpoch = new Date(1899, 11, 30);
    const days = parseFloat(raw);
    const d = new Date(excelEpoch.getTime() + days * 86400000);
    return isNaN(d) ? null : d;
  }

  return null;
}

// Combine separate date and time strings into one datetime
function combineDateAndTime(dateRaw, timeRaw) {
  if (!dateRaw) return null;
  dateRaw = String(dateRaw).trim();
  timeRaw = String(timeRaw || '00:00:00').trim();

  // If time looks like HH:MM or HH:MM:SS already, combine and parse
  const combined = dateRaw + ' ' + timeRaw;
  return parseDateTime(combined);
}

// ── CSV PARSER ─────────────────────────────────────────────────────────────
// Returns array of objects keyed by header row
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  // Find header row — first non-empty line
  let headerLine = 0;
  while (headerLine < lines.length && lines[headerLine].trim() === '') headerLine++;

  const headers = lines[headerLine]
    .split(',')
    .map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const rows = [];
  for (let i = headerLine + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted fields
    const vals = [];
    let inQ = false, cur = '';
    for (const ch of line + ',') {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }

    if (vals.length < headers.length * 0.5) continue; // skip short/empty rows

    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] !== undefined ? vals[idx] : ''; });
    rows.push(obj);
  }

  return rows;
}

// ── DETECT CSV FORMAT ──────────────────────────────────────────────────────
// Returns: 'combined' | 'split' | 'unknown'
function detectFormat(headers) {
  const h = headers.map(x => x.toLowerCase());

  // Format A — single datetime column
  if (h.includes('recorded_at') || h.includes('datetime') || h.includes('timestamp')) {
    return 'combined';
  }

  // Format B — separate date and time columns
  const hasDate = h.some(x => x === 'date' || x === 'recording date' || x === 'measurement date');
  const hasTime = h.some(x => x === 'time' || x === 'recording time' || x === 'measurement time');
  if (hasDate && hasTime) return 'split';

  // Fallback — try combined anyway if there is something date-like
  if (h.some(x => x.includes('date') || x.includes('time'))) return 'combined';

  return 'unknown';
}

// Find column value by multiple possible header names
function findCol(row, ...names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== '') return row[name];
    // case-insensitive scan
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === name.toLowerCase() && row[key] !== '') return row[key];
    }
  }
  return null;
}

// ── UPLOAD ENDPOINT ────────────────────────────────────────────────────────
router.post('/csv', checkAuth, async (req, res) => {
  const site_id = parseInt(req.query.site_id);
  if (!site_id) return res.status(400).json({ error: 'site_id query parameter required' });

  // Read raw body as text (set Content-Type: text/csv in request)
  let csvText = '';
  req.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    req.on('data', chunk => { csvText += chunk; });
    req.on('end', resolve);
    req.on('error', reject);
  });

  if (!csvText.trim()) {
    return res.status(400).json({ error: 'Empty CSV file' });
  }

  // Parse rows
  const rows = parseCSV(csvText);
  if (!rows.length) {
    return res.status(400).json({ error: 'No data rows found in CSV' });
  }

  const headers = Object.keys(rows[0]);
  const fmt     = detectFormat(headers);

  // Tell caller what we detected
  const formatNote = fmt === 'combined'
    ? 'Detected Format A — single datetime column'
    : fmt === 'split'
      ? 'Detected Format B — separate Date and Time columns'
      : 'Unknown format — attempting best-effort parse';

  // ── EXTRACT ROWS ─────────────────────────────────────────────────────────
  const toInsert = [];
  const skipped  = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // ── DATETIME ──────────────────────────────────────────────────────────
    let recorded_at = null;

    if (fmt === 'split') {
      // Format B — combine Date + Time columns
      const dateVal = findCol(row, 'date', 'recording date', 'measurement date');
      const timeVal = findCol(row, 'time', 'recording time', 'measurement time');
      recorded_at   = combineDateAndTime(dateVal, timeVal);
    } else {
      // Format A — single column
      const rawDT = findCol(row,
        'recorded_at', 'datetime', 'timestamp',
        'date time', 'recording datetime', 'measurement datetime'
      );
      recorded_at = parseDateTime(rawDT);
    }

    if (!recorded_at) {
      skipped.push({ row: i + 2, reason: 'Could not parse datetime', data: row });
      continue;
    }

    // ── BREAKER NAME ──────────────────────────────────────────────────────
    const breaker_name = findCol(row,
      'breaker_name', 'breaker', 'circuit', 'channel',
      'name', 'label', 'meter', 'point'
    ) || 'Main';

    // ── kWh ───────────────────────────────────────────────────────────────
    const kwhRaw = findCol(row,
      'kwh', 'energy', 'energy_kwh', 'active energy',
      'total kwh', 'kwh import', 'ea', 'kw'
    );
    const kwh = kwhRaw !== null && kwhRaw !== '' ? parseFloat(kwhRaw) : null;

    // ── kVA ───────────────────────────────────────────────────────────────
    const kvaRaw = findCol(row,
      'kva', 'apparent power', 'apparent_power',
      'demand', 'kva demand', 'total kva'
    );
    const kva = kvaRaw !== null && kvaRaw !== '' ? parseFloat(kvaRaw) : null;

    // ── Voltage ───────────────────────────────────────────────────────────
    const vRaw = findCol(row,
      'voltage', 'volts', 'v', 'vl1', 'vl-n avg', 'voltage avg'
    );
    const voltage = vRaw !== null && vRaw !== '' ? parseFloat(vRaw) : null;

    if (kwh === null && kva === null) {
      skipped.push({ row: i + 2, reason: 'No kWh or kVA value found', data: row });
      continue;
    }

    toInsert.push({ site_id, breaker_name, recorded_at, kwh, kva, voltage });
  }

  if (!toInsert.length) {
    return res.status(400).json({
      error: 'No valid rows to insert',
      format_detected: formatNote,
      skipped_count: skipped.length,
      skipped_sample: skipped.slice(0, 5),
      headers_found: headers,
      hint: fmt === 'unknown'
        ? 'Your CSV columns were not recognised. Expected columns: Date, Time (or recorded_at), breaker_name, kwh'
        : 'Check that your date/time columns contain valid values'
    });
  }

  // ── INSERT TO DATABASE ────────────────────────────────────────────────────
  const client = await pool.connect();
  let inserted = 0, duplicates = 0;

  try {
    await client.query('BEGIN');
    for (const r of toInsert) {
      try {
        await client.query(
          `INSERT INTO energy_readings
             (site_id, breaker_name, recorded_at, kwh, kva, voltage)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (site_id, breaker_name, recorded_at) DO NOTHING`,
          [r.site_id, r.breaker_name, r.recorded_at, r.kwh, r.kva, r.voltage]
        );
        inserted++;
      } catch (e) {
        duplicates++;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }

  // ── RUN COST CALCULATION ──────────────────────────────────────────────────
  try {
    await calculateCosts(site_id);
  } catch (e) {
    console.error('Cost calc error:', e.message);
  }

  res.json({
    success:        true,
    format_detected: formatNote,
    rows_parsed:    rows.length,
    rows_inserted:  inserted,
    rows_skipped:   skipped.length,
    duplicates:     duplicates,
    skipped_sample: skipped.slice(0, 5),
    message:        `Upload complete — ${inserted} rows inserted`
  });
});

module.exports = router;
