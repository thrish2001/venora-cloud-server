// routes/upload.js — Diris Digiware semicolon fix
const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { calculateCosts } = require('../costCalculator');
require('dotenv').config();

function checkAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorised — Bearer token required' });
  const jwt = require('jsonwebtoken');
  try {
    req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'venora-jwt-secret-2025');
    next();
  } catch(e) { return res.status(401).json({ error: 'Invalid or expired token' }); }
}

function detectDelimiter(lines) {
  const sample = lines.slice(0,8).join('\n');
  const s = (sample.match(/;/g)||[]).length;
  const t = (sample.match(/\t/g)||[]).length;
  const c = (sample.match(/,/g)||[]).length;
  if (s > c && s > t) return ';';
  if (t > c && t > s) return '\t';
  return ',';
}

function splitLine(line, delim) {
  return line.split(delim).map(c => c.trim().replace(/^"|"$/g,''));
}

function parseDateTime(raw) {
  if (!raw) return null;
  raw = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) return new Date(raw.replace(' ','T'));
  if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
    const [dp,tp='00:00:00'] = raw.split(' ');
    const [dd,mm,yyyy] = dp.split('/');
    return new Date(`${yyyy}-${mm}-${dd}T${tp}`);
  }
  return null;
}

function parseDirisIndex(lines, delim) {
  const rows = [];
  let loadNameIdx=-1, measIdx=-1, unitIdx=-1, scaleIdx=-1, dataStart=-1;
  for (let i=0;i<Math.min(25,lines.length);i++) {
    const low = lines[i].toLowerCase();
    if (low.includes('load name')) loadNameIdx=i;
    if (low.includes('measured value')) measIdx=i;
    if (low.startsWith('unit')) unitIdx=i;
    if (low.startsWith('scale')) scaleIdx=i;
  }
  const hdrEnd = Math.max(loadNameIdx,measIdx,unitIdx,scaleIdx);
  for (let i=hdrEnd+1;i<lines.length;i++) {
    const cols = splitLine(lines[i],delim);
    if (cols[0] && parseDateTime(cols[0])) { dataStart=i; break; }
  }
  if (loadNameIdx===-1||dataStart===-1) return null;
  const loadNames = splitLine(lines[loadNameIdx],delim);
  const measValues = measIdx!==-1 ? splitLine(lines[measIdx],delim) : [];
  const units = unitIdx!==-1 ? splitLine(lines[unitIdx],delim) : [];
  const scales = scaleIdx!==-1 ? splitLine(lines[scaleIdx],delim) : [];
  const colMap=[];
  for (let c=1;c<loadNames.length;c++) {
    const breaker=(loadNames[c]||'').trim();
    const measured=(measValues[c]||'').trim().toLowerCase();
    const unit=(units[c]||'').trim().toLowerCase();
    const scale=parseFloat(scales[c])||1;
    if (breaker) colMap.push({c,breaker,measured,unit,scale});
  }
  for (let i=dataStart;i<lines.length;i++) {
    const line=lines[i].trim(); if(!line) continue;
    const cols=splitLine(line,delim);
    const recorded_at=parseDateTime(cols[0]); if(!recorded_at) continue;
    const bd={};
    for (const col of colMap) {
      const raw=parseFloat(cols[col.c]); if(isNaN(raw)) continue;
      const val=raw/col.scale;
      if(!bd[col.breaker]) bd[col.breaker]={kwh:null,kva:null};
      if(col.measured==='ea+'&&col.unit.includes('kwh')) bd[col.breaker].kwh=val;
      if(col.measured==='es'&&col.unit.includes('kvah')) bd[col.breaker].kva=val/0.25;
    }
    for (const [breaker,vals] of Object.entries(bd)) {
      if(vals.kwh===null&&vals.kva===null) continue;
      rows.push({breaker_name:breaker,recorded_at,kwh:vals.kwh,kva:vals.kva,voltage:null});
    }
  }
  return rows;
}

router.post('/csv', checkAuth, async (req,res) => {
  const site_id=parseInt(req.query.site_id);
  if(!site_id) return res.status(400).json({error:'site_id required'});
  let csvText='';
  req.setEncoding('utf8');
  await new Promise((resolve,reject)=>{req.on('data',c=>{csvText+=c;});req.on('end',resolve);req.on('error',reject);});
  if(!csvText.trim()) return res.status(400).json({error:'Empty file'});
  const lines=csvText.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const delim=detectDelimiter(lines);
  const top8=lines.slice(0,8).join('\n').toLowerCase();
  const isDiris=top8.includes('device name')||top8.includes('load name')||top8.includes('measured value');
  let toInsert=[]; const skipped=[];
  if(isDiris){
    const parsed=parseDirisIndex(lines,delim);
    if(!parsed||!parsed.length) return res.status(400).json({error:'Could not parse Diris Index file',delim,first5:lines.slice(0,5)});
    toInsert=parsed.map(r=>({...r,site_id}));
  } else {
    let hdrIdx=0;
    while(hdrIdx<lines.length&&!lines[hdrIdx].trim()) hdrIdx++;
    const headers=splitLine(lines[hdrIdx],delim).map(h=>h.toLowerCase());
    function findCol(row,...names){for(const n of names){const i=headers.indexOf(n);if(i!==-1&&row[i]!==undefined&&row[i]!=='')return row[i];}return null;}
    for(let i=hdrIdx+1;i<lines.length;i++){
      const line=lines[i].trim(); if(!line) continue;
      const cols=splitLine(line,delim);
      const dt=parseDateTime(findCol(cols,'recorded_at','datetime','timestamp'));
      if(!dt){skipped.push({row:i+1});continue;}
      const breaker=findCol(cols,'breaker_name','breaker','circuit')||'Main';
      const kwh=parseFloat(findCol(cols,'kwh','energy','kw')||'');
      const kva=parseFloat(findCol(cols,'kva','demand')||'');
      if(isNaN(kwh)&&isNaN(kva)){skipped.push({row:i+1});continue;}
      toInsert.push({site_id,breaker_name:breaker,recorded_at:dt,kwh:isNaN(kwh)?null:kwh,kva:isNaN(kva)?null:kva,voltage:null});
    }
  }
  if(!toInsert.length) return res.status(400).json({error:'No valid rows',delim,skipped_count:skipped.length});
  const client=await pool.connect();
  let inserted=0,duplicates=0;
  try{
    await client.query('BEGIN');
    for(const r of toInsert){
      const result=await client.query(`INSERT INTO energy_readings (site_id,breaker_name,recorded_at,kwh,kva,voltage) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (site_id,breaker_name,recorded_at) DO NOTHING`,[r.site_id,r.breaker_name,r.recorded_at,r.kwh,r.kva,r.voltage]);
      if(result.rowCount>0) inserted++; else duplicates++;
    }
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');return res.status(500).json({error:e.message});}
  finally{client.release();}
  try{await calculateCosts(site_id);}catch(e){console.error('Cost calc:',e.message);}
  res.json({success:true,delimiter:delim,rows_inserted:inserted,duplicates,rows_skipped:skipped.length,message:`Upload complete — ${inserted} rows inserted`});
});

module.exports = router;
