<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dirisdigiware — Production Analysis</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:wght@600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --gold:#C9A347;--gold-d:#9A7A2E;--gold-l:#F0E0A8;
  --bg:#070A13;--card:#0D1220;--card2:#111827;--inp:#141D2E;
  --border:#1C2A42;--border2:#243450;
  --text:#F0EDE6;--muted:#6B7191;--sub:#8B90B0;
  --peak:#E05A5A;--day:#C9A347;--op:#4CAF7D;--blue:#5A9EE0;--purple:#A855F7;
}
body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex}
.sidebar{width:220px;min-height:100vh;background:var(--card);border-right:1px solid var(--border);display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:100}
.sidebar-logo{padding:24px 20px 18px;border-bottom:1px solid var(--border)}
.sidebar-logo .brand{font-family:'Playfair Display',serif;font-size:22px;color:var(--gold);letter-spacing:1px}
.sidebar-logo .tagline{font-size:9px;color:var(--muted);letter-spacing:2px;text-transform:uppercase;margin-top:3px}
.sidebar-nav{flex:1;padding:16px 10px}
.nav-section{font-size:9px;font-weight:600;color:var(--muted);letter-spacing:2px;text-transform:uppercase;padding:0 10px;margin:16px 0 6px}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:500;color:var(--muted);transition:all .2s;text-decoration:none;margin-bottom:2px}
.nav-item:hover{background:var(--inp);color:var(--text)}
.nav-item.active{background:linear-gradient(135deg,rgba(168,85,247,.12),rgba(168,85,247,.06));color:var(--purple);border:1px solid rgba(168,85,247,.2)}
.nav-icon{width:18px;text-align:center;font-size:14px}
.sidebar-footer{padding:14px;border-top:1px solid var(--border)}
.user-card{background:var(--inp);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.user-name{font-size:12px;font-weight:600;color:var(--text)}
.user-role{font-size:10px;color:var(--muted);margin-top:2px}
.company-tag{font-size:10px;color:var(--gold);background:rgba(201,163,71,.1);border:1px solid rgba(201,163,71,.2);border-radius:6px;padding:2px 8px;margin-top:5px;display:inline-block}
.btn-logout{width:100%;background:transparent;border:1px solid var(--border);border-radius:8px;padding:8px;font-family:'Inter',sans-serif;font-size:11px;color:var(--muted);cursor:pointer;transition:all .15s}
.btn-logout:hover{border-color:var(--peak);color:var(--peak)}
.main{margin-left:220px;flex:1;display:flex;flex-direction:column;min-height:100vh}
.topbar{background:rgba(13,18,32,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--border);padding:0 28px;display:flex;align-items:center;justify-content:space-between;height:58px;position:sticky;top:0;z-index:50;flex-shrink:0}
.page-title{font-size:15px;font-weight:700;color:var(--text)}
.page-sub{font-size:11px;color:var(--muted);margin-top:1px}
.controls{padding:14px 28px;background:var(--card2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0}
.ctrl-lbl{font-size:10px;color:var(--muted);font-weight:600;letter-spacing:1px;text-transform:uppercase;white-space:nowrap}
.dt{background:var(--inp);border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-family:'Inter',sans-serif;font-size:11px;color:var(--text);outline:none;transition:border-color .15s}
.dt:focus{border-color:var(--purple)}
.pb{background:var(--inp);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:11px;color:var(--muted);cursor:pointer;transition:all .15s;white-space:nowrap;font-family:'Inter',sans-serif}
.pb:hover,.pb.active{background:rgba(168,85,247,.1);border-color:rgba(168,85,247,.4);color:var(--purple)}
.btn-run{background:linear-gradient(135deg,#7C3AED,var(--purple));border:none;border-radius:8px;padding:7px 16px;font-family:'Inter',sans-serif;font-size:11px;font-weight:700;color:#fff;cursor:pointer;letter-spacing:.5px;transition:opacity .15s;margin-left:auto}
.btn-run:hover{opacity:.85}
.sep{width:1px;height:22px;background:var(--border);margin:0 2px}
.content{flex:1;padding:22px 28px;overflow-y:auto}
.cc{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:14px;position:relative;overflow:hidden}
.cc::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(168,85,247,.3),transparent)}
.ct{font-size:13px;font-weight:700;color:var(--text)}
.cs{font-size:10px;color:var(--muted);margin-top:3px}
/* Entry form */
.prod-grid{display:grid;grid-template-columns:repeat(5,1fr) auto;gap:10px;align-items:end;margin:16px 0}
.fg label{display:block;font-size:9px;font-weight:600;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:5px}
.fg input,.fg select{background:var(--inp);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-family:'Inter',sans-serif;font-size:12px;color:var(--text);outline:none;transition:border-color .15s;width:100%}
.fg input:focus,.fg select:focus{border-color:var(--purple)}
.btn-add{background:linear-gradient(135deg,#7C3AED,var(--purple));border:none;border-radius:8px;padding:9px 18px;font-family:'Inter',sans-serif;font-size:12px;font-weight:700;color:#fff;cursor:pointer;height:37px;white-space:nowrap}
/* Table */
.prod-table{width:100%;border-collapse:collapse;margin-top:12px}
.prod-table th{font-size:9px;font-weight:600;color:var(--muted);letter-spacing:1px;text-transform:uppercase;text-align:left;padding:0 12px 10px;border-bottom:1px solid var(--border)}
.prod-table td{padding:11px 12px;font-size:12px;color:var(--text);border-bottom:1px solid rgba(28,42,66,.5)}
.prod-table tr:last-child td{border-bottom:none}
.prod-table tr:hover td{background:rgba(255,255,255,.02)}
.shift-badge{display:inline-block;padding:2px 8px;border-radius:5px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
.sm{background:rgba(201,163,71,.15);color:var(--gold)}
.se{background:rgba(90,158,224,.15);color:var(--blue)}
.sn{background:rgba(168,85,247,.15);color:var(--purple)}
/* Reg cards */
.reg-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.reg-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;position:relative;overflow:hidden}
.reg-card.energy::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(76,175,125,.5),transparent)}
.reg-card.cost::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(168,85,247,.5),transparent)}
.reg-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.rs{background:var(--inp);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center}
.rs-val{font-size:18px;font-weight:800;margin-bottom:3px}
.rs-lbl{font-size:9px;color:var(--muted);letter-spacing:1px;text-transform:uppercase}
.eq-box{margin-top:10px;padding:10px 14px;background:rgba(255,255,255,.03);border-radius:8px;font-size:11px;color:var(--sub);border-left:3px solid}
.badge-sm{font-size:10px;font-weight:600;padding:3px 10px;border-radius:20px}
/* Loading */
.ov{position:fixed;inset:0;background:rgba(7,10,19,.85);display:flex;align-items:center;justify-content:center;z-index:200;backdrop-filter:blur(6px);display:none}
.ob{text-align:center}
.sp{width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--purple);border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 14px}
@keyframes spin{to{transform:rotate(360deg)}}
.ob p{font-size:13px;color:var(--muted)}
.footer{text-align:center;padding:14px;font-size:10px;color:#2A3050;border-top:1px solid var(--border);flex-shrink:0}
.footer strong{color:#5A6080}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
@media(max-width:900px){.sidebar{transform:translateX(-100%)}.main{margin-left:0}.reg-grid{grid-template-columns:1fr}.prod-grid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>

<div class="ov" id="ov"><div class="ob"><div class="sp"></div><p>Running regression analysis...</p></div></div>

<!-- SIDEBAR -->
<div class="sidebar">
  <div class="sidebar-logo">
    <div class="brand">Dirisdigiware</div>
    <div class="tagline">Energy Intelligence Platform</div>
  </div>
  <nav class="sidebar-nav">
    <div class="nav-section">Monitor</div>
    <a class="nav-item" href="dashboard.html"><span class="nav-icon">⚡</span>Dashboard</a>
    <a class="nav-item active" href="production.html"><span class="nav-icon">🏭</span>Production</a>
    <div class="nav-section">Reports</div>
    <a class="nav-item" href="#" onclick="alert('Coming soon')"><span class="nav-icon">📄</span>Monthly Report</a>
    <a class="nav-item" href="#" onclick="alert('Coming soon')"><span class="nav-icon">📊</span>Analytics</a>
  </nav>
  <div class="sidebar-footer">
    <div class="user-card">
      <div class="user-name" id="userName">—</div>
      <div class="user-role" id="userRole">Viewer</div>
      <div class="company-tag" id="companyTag">—</div>
    </div>
    <button class="btn-logout" onclick="logout()">Sign Out</button>
  </div>
</div>

<!-- MAIN -->
<div class="main">
  <div class="topbar">
    <div>
      <div class="page-title">Production & Regression Analysis</div>
      <div class="page-sub">Enter production data per shift — analyse correlation with energy and cost</div>
    </div>
  </div>

  <div class="controls">
    <div style="display:flex;align-items:center;gap:6px">
      <span class="ctrl-lbl">From</span><input type="date" class="dt" id="fromDate">
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span class="ctrl-lbl">To</span><input type="date" class="dt" id="toDate">
    </div>
    <div class="sep"></div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      <button class="pb" onclick="setPreset('today',this)">Today</button>
      <button class="pb" onclick="setPreset('week',this)">This Week</button>
      <button class="pb active" onclick="setPreset('month',this)">This Month</button>
      <button class="pb" onclick="setPreset('last30',this)">Last 30 Days</button>
      <button class="pb" onclick="setPreset('last3m',this)">Last 3 Months</button>
    </div>
    <button class="btn-run" onclick="loadAll()">↻ Run Analysis</button>
  </div>

  <div class="content">

    <!-- PRODUCTION ENTRY -->
    <div class="cc">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div><div class="ct">Enter Production Data</div><div class="cs">Add units produced per shift to enable regression analysis</div></div>
      </div>
      <div class="prod-grid">
        <div class="fg"><label>Date</label><input type="date" id="prodDate"></div>
        <div class="fg"><label>Shift</label>
          <select id="prodShift">
            <option value="morning">🌅 Morning (06:00–14:00)</option>
            <option value="evening">🌇 Evening (14:00–22:00)</option>
            <option value="night">🌙 Night (22:00–06:00)</option>
          </select>
        </div>
        <div class="fg"><label>Units Produced</label><input type="number" id="prodUnits" placeholder="e.g. 1250" min="0" step="1"></div>
        <div class="fg"><label>Unit Type</label><input type="text" id="prodUnitType" value="pieces" placeholder="pieces / tons / kg"></div>
        <div class="fg"><label>Notes (optional)</label><input type="text" id="prodNotes" placeholder="e.g. Machine B offline"></div>
        <button class="btn-add" onclick="addProduction()">+ Add</button>
      </div>
      <div id="prodMsg" style="font-size:12px;margin-bottom:10px;display:none"></div>
      <div style="border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:9px;font-weight:600;color:var(--muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Production Entries for Selected Period</div>
        <div id="prodTableContainer"><div style="font-size:12px;color:var(--muted)">Loading...</div></div>
      </div>
    </div>

    <!-- REGRESSION CHARTS -->
    <div class="reg-grid">

      <!-- ENERGY vs PRODUCTION -->
      <div class="reg-card energy">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div class="ct" style="color:var(--op)">⚡ Energy vs Production</div>
            <div class="cs">kWh consumed per shift vs units produced</div>
          </div>
          <div id="eBadge" class="badge-sm" style="background:rgba(76,175,125,.12);color:var(--op);border:1px solid rgba(76,175,125,.3)">—</div>
        </div>
        <div class="reg-stats" id="eStats" style="display:none">
          <div class="rs"><div class="rs-val" id="e-r2" style="color:var(--op)">—</div><div class="rs-lbl">R² Correlation</div></div>
          <div class="rs"><div class="rs-val" id="e-int" style="color:var(--op)">—</div><div class="rs-lbl">kWh / Unit</div></div>
          <div class="rs"><div class="rs-val" id="e-base" style="color:var(--op)">—</div><div class="rs-lbl">Baseline kWh</div></div>
        </div>
        <div style="height:260px;position:relative"><canvas id="eChart"></canvas></div>
        <div id="eEq" class="eq-box" style="border-color:var(--op);display:none"></div>
      </div>

      <!-- COST vs PRODUCTION -->
      <div class="reg-card cost">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div class="ct" style="color:var(--purple)">💰 Cost (LKR) vs Production</div>
            <div class="cs">LKR electricity cost per shift vs units produced</div>
          </div>
          <div id="cBadge" class="badge-sm" style="background:rgba(168,85,247,.12);color:var(--purple);border:1px solid rgba(168,85,247,.3)">—</div>
        </div>
        <div class="reg-stats" id="cStats" style="display:none">
          <div class="rs"><div class="rs-val" id="c-r2" style="color:var(--purple)">—</div><div class="rs-lbl">R² Correlation</div></div>
          <div class="rs"><div class="rs-val" id="c-int" style="color:var(--purple)">—</div><div class="rs-lbl">LKR / Unit</div></div>
          <div class="rs"><div class="rs-val" id="c-base" style="color:var(--purple)">—</div><div class="rs-lbl">Baseline LKR</div></div>
        </div>
        <div style="height:260px;position:relative"><canvas id="cChart"></canvas></div>
        <div id="cEq" class="eq-box" style="border-color:var(--purple);display:none"></div>
      </div>

    </div>

    <!-- INTERPRETATION -->
    <div class="cc" id="interpretBox" style="display:none">
      <div class="ct" style="margin-bottom:12px;color:var(--purple)">📋 Analysis Summary</div>
      <div id="interpretContent" style="font-size:12px;color:var(--sub);line-height:1.8"></div>
    </div>

  </div>

  <div class="footer">
    Dirisdigiware Energy Intelligence Platform &nbsp;·&nbsp; Developed by <strong>Thirasha Bandara</strong> &nbsp;·&nbsp; Venora Lanka Power Panels (Pvt) Ltd &nbsp;·&nbsp; &copy; 2026 All Rights Reserved
  </div>
</div>

<script>
const API_URL='https://venora-cloud-server-production.up.railway.app';
const API_KEY='venora-super-secret-key-2025-change-this';
let user=null,charts={};

function checkAuth(){
  const s=sessionStorage.getItem('user');
  if(!s){window.location.href='login.html';return false;}
  user=JSON.parse(s);
  document.getElementById('userName').textContent=user.name||user.username;
  document.getElementById('userRole').textContent=user.role||'Viewer';
  document.getElementById('companyTag').textContent=user.company||user.site_name||'Site '+user.site_id;
  return true;
}
function logout(){sessionStorage.removeItem('user');window.location.href='login.html';}
function fd(d){return d.toISOString().split('T')[0];}

function setPreset(p,el){
  document.querySelectorAll('.pb').forEach(b=>b.classList.remove('active'));el.classList.add('active');
  const n=new Date();let from,to=fd(n);
  if(p==='today'){from=to;}
  else if(p==='week'){const d=new Date(n);d.setDate(d.getDate()-d.getDay());from=fd(d);}
  else if(p==='month'){from=fd(new Date(n.getFullYear(),n.getMonth(),1));}
  else if(p==='last30'){const d=new Date(n);d.setDate(d.getDate()-30);from=fd(d);}
  else if(p==='last3m'){const d=new Date(n);d.setMonth(d.getMonth()-3);from=fd(d);}
  document.getElementById('fromDate').value=from;document.getElementById('toDate').value=to;
}

function fN(n,d=1){
  if(n===null||n===undefined||isNaN(n))return'—';n=parseFloat(n);
  if(n>=1000000)return(n/1000000).toFixed(d)+'M';if(n>=1000)return(n/1000).toFixed(d)+'K';return n.toFixed(d);
}

async function addProduction(){
  const date=document.getElementById('prodDate').value;
  const shift=document.getElementById('prodShift').value;
  const units=document.getElementById('prodUnits').value;
  const unitType=document.getElementById('prodUnitType').value||'pieces';
  const notes=document.getElementById('prodNotes').value;
  const msg=document.getElementById('prodMsg');
  if(!date||!units){msg.textContent='Please enter date and units produced.';msg.style.color='#E05A5A';msg.style.display='block';return;}
  try{
    const resp=await fetch(`${API_URL}/api/production/add`,{
      method:'POST',headers:{'Content-Type':'application/json','x-api-key':API_KEY},
      body:JSON.stringify({site_id:user.site_id,production_date:date,shift,units_produced:parseFloat(units),unit_type:unitType,notes})
    });
    const data=await resp.json();
    if(data.success){
      msg.textContent='✓ Saved: '+date+' ('+shift+') — '+parseFloat(units).toLocaleString()+' '+unitType;
      msg.style.color='#4CAF7D';msg.style.display='block';
      document.getElementById('prodUnits').value='';document.getElementById('prodNotes').value='';
      loadProductionList();
    }else{msg.textContent=data.error||'Failed.';msg.style.color='#E05A5A';msg.style.display='block';}
  }catch(e){msg.textContent='Error: '+e.message;msg.style.color='#E05A5A';msg.style.display='block';}
}

async function loadProductionList(){
  const from=document.getElementById('fromDate').value;
  const to=document.getElementById('toDate').value;
  try{
    const resp=await fetch(`${API_URL}/api/production/list?site_id=${user.site_id}&from=${from}&to=${to}`,{headers:{'x-api-key':API_KEY}});
    const data=await resp.json();
    const c=document.getElementById('prodTableContainer');
    if(!data.length){c.innerHTML='<div style="font-size:12px;color:var(--muted);padding:8px 0">No entries for this period.</div>';return;}
    c.innerHTML=`<table class="prod-table">
      <thead><tr><th>Date</th><th>Shift</th><th>Units</th><th>Type</th><th>Notes</th></tr></thead>
      <tbody>${data.map(r=>`<tr>
        <td>${new Date(r.production_date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</td>
        <td><span class="shift-badge ${r.shift==='morning'?'sm':r.shift==='evening'?'se':'sn'}">${r.shift}</span></td>
        <td style="font-weight:700;color:var(--gold)">${parseFloat(r.units_produced).toLocaleString()}</td>
        <td style="color:var(--muted)">${r.unit_type}</td>
        <td style="color:var(--muted)">${r.notes||'—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }catch(e){console.error(e);}
}

function drawRegChart(canvasId,points,reg,yKey,yLabel,lineColor){
  if(charts[canvasId])charts[canvasId].destroy();
  if(!points.length)return;
  const ctx=document.getElementById(canvasId).getContext('2d');
  const sc={morning:'rgba(201,163,71,.85)',evening:'rgba(90,158,224,.85)',night:'rgba(168,85,247,.85)'};
  const datasets=[{
    label:'Shift data',type:'scatter',
    data:points.map(p=>({x:p.units,y:p[yKey],date:p.date,shift:p.shift})),
    backgroundColor:points.map(p=>sc[p.shift]||lineColor),
    pointRadius:7,pointHoverRadius:10
  }];
  if(reg)datasets.push({
    label:'Regression line',type:'line',
    data:reg.regression_line,
    borderColor:lineColor,backgroundColor:'transparent',
    borderWidth:2,borderDash:[6,3],pointRadius:0,tension:0
  });
  const unit=points[0]?.unit_type||'units';
  charts[canvasId]=new Chart(ctx,{type:'scatter',data:{datasets},options:{
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{display:true,position:'top',labels:{color:'#8B90B0',font:{size:10},padding:12,boxWidth:8}},
      tooltip:{backgroundColor:'#0D1220',borderColor:'#1C2A42',borderWidth:1,cornerRadius:8,titleColor:lineColor,bodyColor:'#F0EDE6',padding:12,
        callbacks:{
          title:items=>{const p=points[items[0].dataIndex];return p?`${p.date} · ${p.shift} shift`:'';},
          label:item=>[` Production: ${item.raw.x.toLocaleString()} ${unit}`,` ${yLabel}: ${fN(item.raw.y,1)}${yLabel==='kWh'?' kWh':' LKR'}`]
        }}
    },
    scales:{
      x:{grid:{color:'rgba(28,42,66,.6)'},ticks:{color:'#6B7191',font:{size:10}},title:{display:true,text:`Production (${unit})`,color:'#6B7191',font:{size:10}}},
      y:{grid:{color:'rgba(28,42,66,.6)'},ticks:{color:'#6B7191',font:{size:10},callback:v=>fN(v,1)+(yLabel==='kWh'?' kWh':' LKR')},title:{display:true,text:yLabel==='kWh'?'Energy (kWh)':'Cost (LKR)',color:'#6B7191',font:{size:10}}}
    }
  }});
}

async function loadRegression(){
  const from=document.getElementById('fromDate').value;
  const to=document.getElementById('toDate').value;
  try{
    const resp=await fetch(`${API_URL}/api/production/regression?site_id=${user.site_id}&from=${from}&to=${to}`,{headers:{'x-api-key':API_KEY}});
    const data=await resp.json();

    const er=data.energy_regression;
    const eb=document.getElementById('eBadge');
    if(er){
      eb.textContent=er.interpretation+' · R²='+er.r2_percent+'%';
      document.getElementById('e-r2').textContent=(er.r2*100).toFixed(1)+'%';
      document.getElementById('e-int').textContent=er.avg_per_unit+' kWh';
      document.getElementById('e-base').textContent=fN(er.baseline,1)+' kWh';
      document.getElementById('eStats').style.display='grid';
      document.getElementById('eEq').innerHTML='<strong>Equation:</strong> Energy = '+er.variable_per_unit+' × Units + '+fN(er.baseline,1)+' kWh &nbsp;·&nbsp; R² = '+er.r2_percent+'%';
      document.getElementById('eEq').style.display='block';
    }else{eb.textContent=data.message||'No data';document.getElementById('eStats').style.display='none';document.getElementById('eEq').style.display='none';}

    const cr=data.cost_regression;
    const cb=document.getElementById('cBadge');
    if(cr){
      cb.textContent=cr.interpretation+' · R²='+cr.r2_percent+'%';
      document.getElementById('c-r2').textContent=(cr.r2*100).toFixed(1)+'%';
      document.getElementById('c-int').textContent='LKR '+fN(cr.avg_per_unit,0);
      document.getElementById('c-base').textContent='LKR '+fN(cr.baseline,0);
      document.getElementById('cStats').style.display='grid';
      document.getElementById('cEq').innerHTML='<strong>Equation:</strong> Cost = LKR '+fN(cr.variable_per_unit,2)+' × Units + LKR '+fN(cr.baseline,0)+' &nbsp;·&nbsp; R² = '+cr.r2_percent+'%';
      document.getElementById('cEq').style.display='block';
    }else{cb.textContent=data.message||'No data';document.getElementById('cStats').style.display='none';document.getElementById('cEq').style.display='none';}

    drawRegChart('eChart',data.points||[],er,'energy_kwh','kWh','#4CAF7D');
    drawRegChart('cChart',data.points||[],cr,'cost_lkr','LKR','#A855F7');

    if(er&&cr&&data.points.length>=2){
      const box=document.getElementById('interpretBox');
      const unit=data.points[0]?.unit_type||'units';
      document.getElementById('interpretContent').innerHTML=`
        <strong style="color:var(--op)">Energy Efficiency:</strong> Each ${unit} produced consumes approximately <strong style="color:var(--gold)">${er.avg_per_unit} kWh</strong> on average.
        The factory baseline energy (overhead regardless of production) is <strong style="color:var(--gold)">${fN(er.baseline,1)} kWh</strong> per shift.<br><br>
        <strong style="color:var(--purple)">Cost Efficiency:</strong> Each ${unit} costs approximately <strong style="color:var(--gold)">LKR ${fN(cr.avg_per_unit,0)}</strong> in electricity.
        Fixed electricity cost per shift is <strong style="color:var(--gold)">LKR ${fN(cr.baseline,0)}</strong> regardless of how much is produced.<br><br>
        <strong style="color:var(--sub)">Correlation Strength:</strong> Energy R² = ${er.r2_percent}% (${er.interpretation}) &nbsp;·&nbsp; Cost R² = ${cr.r2_percent}% (${cr.interpretation})<br>
        ${er.r2>=0.8?'<em style="color:var(--op)">Strong correlation — energy use is well explained by production output. Good data quality for benchmarking.</em>':er.r2>=0.5?'<em style="color:var(--day)">Moderate correlation — other factors also influence energy use. Consider machine type, product mix, or shift efficiency.</em>':'<em style="color:var(--muted)">Weak correlation — collect more data points, or production type may vary significantly across shifts.</em>'}
      `;
      box.style.display='block';
    }else{document.getElementById('interpretBox').style.display='none';}

  }catch(e){console.error(e);}
}

async function loadAll(){
  if(!checkAuth())return;
  document.getElementById('ov').style.display='flex';
  try{await Promise.all([loadProductionList(),loadRegression()]);}
  finally{document.getElementById('ov').style.display='none';}
}

if(checkAuth()){
  const n=new Date();
  document.getElementById('fromDate').value=fd(new Date(n.getFullYear(),n.getMonth(),1));
  document.getElementById('toDate').value=fd(n);
  document.getElementById('prodDate').value=fd(n);
  loadAll();
}
</script>
</body>
</html>