export function viewerPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FC Market Lab Viewer</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0b0d12;
      color: #edf0f7;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: #0b0d12; }
    main { width: min(1500px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 56px; }
    header { display: flex; gap: 20px; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    h1 { margin: 0 0 6px; font-size: 25px; letter-spacing: -.03em; }
    h2 { margin: 0 0 14px; font-size: 17px; }
    p { margin: 0; color: #9299aa; font-size: 13px; line-height: 1.5; }
    .run-picker { min-width: 340px; }
    select { width: 100%; background: #171a22; color: #edf0f7; border: 1px solid #2b3040; border-radius: 8px; padding: 9px 10px; }
    .cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
    .card, .panel { background: #11141b; border: 1px solid #222733; border-radius: 12px; }
    .card { padding: 14px 15px; min-height: 82px; }
    .label { color: #7f8799; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 8px; font-size: 20px; font-variant-numeric: tabular-nums; }
    .panel { padding: 16px; margin-top: 14px; overflow: hidden; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .toolbar .left, .toolbar .right { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .metric-select { width: 190px; }
    .cohorts { display: flex; flex-wrap: wrap; gap: 6px; }
    .cohort-toggle { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #303646; background: #181c25; border-radius: 999px; padding: 6px 9px; color: #c8cede; font-size: 12px; cursor: pointer; }
    .cohort-toggle input { margin: 0; }
    #chart-wrap { position: relative; min-height: 390px; }
    #chart { width: 100%; height: 390px; display: block; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 12px; color: #b7bdcc; }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .swatch { width: 16px; height: 3px; border-radius: 2px; }
    .event-note { color: #8d95a8; font-size: 11px; }
    .grid2 { display: grid; grid-template-columns: minmax(0, 2fr) minmax(360px, 1fr); gap: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 8px 9px; border-bottom: 1px solid #252a35; text-align: right; font-variant-numeric: tabular-nums; }
    th:first-child, td:first-child { text-align: left; }
    th { position: sticky; top: 0; background: #11141b; color: #848c9e; font-weight: 600; }
    td { color: #d6dae5; }
    .table-wrap { max-height: 420px; overflow: auto; }
    .positive { color: #66d09b; }
    .negative { color: #f07878; }
    .muted { color: #687184; }
    .shock { font-weight: 650; }
    .error { padding: 20px; border: 1px solid #66363a; background: #251519; border-radius: 10px; color: #ffb3b7; white-space: pre-wrap; }
    @media (max-width: 980px) {
      header { flex-direction: column; }
      .run-picker { width: 100%; min-width: 0; }
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid2 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>FC Market Lab</h1>
      <p>표본 시장 지수, cohort 상대 움직임, 사건 replay와 Shock를 한 화면에서 확인한다.</p>
    </div>
    <div class="run-picker">
      <div class="label" style="margin-bottom:6px">Analysis run</div>
      <select id="run-select"></select>
    </div>
  </header>

  <div id="app"><div class="panel">데이터를 불러오는 중...</div></div>
</main>
<script>
const palette = ['#7aa2f7','#9ece6a','#e0af68','#bb9af7','#7dcfff','#f7768e','#73daca','#c0caf5'];
const metricLabels = {
  INDEX: 'Index', RETURN_1D: '1D Return', RELATIVE_STRENGTH: 'Relative Strength',
  BREADTH: 'Breadth', IQR: 'IQR', MAD: 'MAD'
};
let payload = null;
let selectedMetric = 'INDEX';
let enabledCohorts = new Set();

function esc(value) {
  return String(value ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch]));
}
function fmt(value, metric) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (metric === 'RETURN_1D' || metric === 'RELATIVE_STRENGTH' || metric === 'BREADTH' || metric === 'IQR' || metric === 'MAD') {
    return (n * 100).toFixed(2) + '%';
  }
  return n.toFixed(2);
}
function signedClass(value) { return Number(value) > 0 ? 'positive' : Number(value) < 0 ? 'negative' : ''; }
function cohortName(id) { return payload?.cohorts.find(c => c.cohort_id === id)?.name ?? id; }
function sampleCohort() { return payload?.cohorts.find(c => c.name === 'SAMPLE_MARKET'); }

async function initRuns() {
  const runs = await fetch('/api/runs').then(r => r.json());
  const select = document.querySelector('#run-select');
  select.innerHTML = runs.map(run =>
    '<option value="' + esc(run.analysis_run_id) + '">' + esc(run.created_at.slice(0, 19).replace('T',' ')) + ' · ' + esc(run.analysis_version) + '</option>'
  ).join('');
  select.addEventListener('change', () => loadRun(select.value));
  if (runs.length) await loadRun(runs[0].analysis_run_id);
  else document.querySelector('#app').innerHTML = '<div class="error">볼 수 있는 성공한 analysis run이 없습니다.</div>';
}

async function loadRun(runId) {
  try {
    payload = await fetch('/api/data?run=' + encodeURIComponent(runId)).then(async r => {
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    });
    enabledCohorts = new Set(payload.cohorts.map(c => c.cohort_id));
    selectedMetric = 'INDEX';
    render();
  } catch (error) {
    document.querySelector('#app').innerHTML = '<div class="error">' + esc(error?.stack ?? error) + '</div>';
  }
}

function latestMetric(scopeId, metric) {
  const rows = payload.metrics.filter(m => m.scope_id === scopeId && m.metric_name === metric && m.status === 'OK');
  return rows.at(-1) ?? null;
}

function render() {
  const sample = sampleCohort();
  const latestIndex = sample ? latestMetric(sample.cohort_id, 'INDEX') : null;
  const latestReturn = sample ? latestMetric(sample.cohort_id, 'RETURN_1D') : null;
  const app = document.querySelector('#app');
  app.innerHTML = \
    '<section class="cards">' +
      card('Cutoff', payload.run.analysis_cutoff.slice(0,10)) +
      card('Sample index', latestIndex ? fmt(latestIndex.value, 'INDEX') : '—') +
      card('Latest return', latestReturn ? fmt(latestReturn.value, 'RETURN_1D') : '—', latestReturn?.value) +
      card('Replay anchors', payload.events.length) +
      card('Shock candidates', payload.shocks.length) +
    '</section>' +
    '<section class="panel"><div class="toolbar"><div class="left"><h2 style="margin:0">시장 / Cohort 시계열</h2>' +
      '<select id="metric-select" class="metric-select">' + Object.entries(metricLabels).map(([k,v]) => '<option value="'+k+'" '+(k===selectedMetric?'selected':'')+'>'+v+'</option>').join('') + '</select></div>' +
      '<div id="cohort-toggles" class="cohorts"></div></div>' +
      '<div id="chart-wrap"><svg id="chart" viewBox="0 0 1200 390" preserveAspectRatio="none"></svg></div><div id="legend" class="legend"></div></section>' +
    '<section class="grid2"><div class="panel"><div class="toolbar"><h2 style="margin:0">Event replay</h2><div class="right">' +
      '<select id="event-select" style="width:330px"></select><select id="replay-metric" class="metric-select"></select></div></div><div id="replay-table" class="table-wrap"></div></div>' +
      '<div class="panel"><h2>Shock candidates</h2><div id="shock-table" class="table-wrap"></div></div></section>';

  document.querySelector('#metric-select').addEventListener('change', e => { selectedMetric = e.target.value; renderChart(); });
  renderCohortToggles();
  renderChart();
  renderReplayControls();
  renderShocks();
}
function card(label, value, signedValue=null) {
  return '<div class="card"><div class="label">'+esc(label)+'</div><div class="value '+(signedValue==null?'':signedClass(signedValue))+'">'+esc(value)+'</div></div>';
}

function renderCohortToggles() {
  const host = document.querySelector('#cohort-toggles');
  host.innerHTML = payload.cohorts.map((c,i) =>
    '<label class="cohort-toggle"><input type="checkbox" data-id="'+esc(c.cohort_id)+'" '+(enabledCohorts.has(c.cohort_id)?'checked':'')+' />' +
    '<span class="swatch" style="background:'+palette[i%palette.length]+'"></span>'+esc(c.name)+'</label>'
  ).join('');
  host.querySelectorAll('input').forEach(input => input.addEventListener('change', e => {
    e.target.checked ? enabledCohorts.add(e.target.dataset.id) : enabledCohorts.delete(e.target.dataset.id);
    renderChart();
  }));
}

function renderChart() {
  const svg = document.querySelector('#chart');
  const legend = document.querySelector('#legend');
  const selected = payload.metrics.filter(m => m.metric_name === selectedMetric && m.status === 'OK' && enabledCohorts.has(m.scope_id));
  if (!selected.length) {
    svg.innerHTML = '<text x="600" y="195" text-anchor="middle" fill="#6e7688">표시할 OK 결과가 없습니다.</text>';
    legend.innerHTML = '';
    return;
  }
  const dates = [...new Set(selected.map(m => m.metric_date))].sort();
  const dateIndex = new Map(dates.map((d,i) => [d,i]));
  const values = selected.map(m => Number(m.value));
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = Math.max((max-min)*0.08, 0.0001); min -= pad; max += pad;
  const left=62,right=18,top=22,bottom=42,w=1200,h=390;
  const x = d => left + (dateIndex.get(d) ?? 0) / Math.max(1, dates.length-1) * (w-left-right);
  const y = v => top + (max-v)/(max-min)*(h-top-bottom);
  let html = '';
  for (let i=0;i<=4;i++) {
    const v=max-(max-min)*i/4, yy=y(v);
    html += '<line x1="'+left+'" y1="'+yy+'" x2="'+(w-right)+'" y2="'+yy+'" stroke="#232936" stroke-width="1" />';
    html += '<text x="'+(left-8)+'" y="'+(yy+4)+'" text-anchor="end" fill="#737c90" font-size="11">'+esc(fmt(v,selectedMetric))+'</text>';
  }
  payload.events.forEach(ev => {
    if (!dateIndex.has(ev.anchor_date)) return;
    const xx=x(ev.anchor_date);
    html += '<line x1="'+xx+'" y1="'+top+'" x2="'+xx+'" y2="'+(h-bottom)+'" stroke="#4d566a" stroke-dasharray="4 4" />';
    html += '<text x="'+(xx+4)+'" y="'+(top+11)+'" fill="#778196" font-size="9" transform="rotate(90 '+(xx+4)+' '+(top+11)+')">'+esc(ev.title.slice(0,26))+'</text>';
  });
  payload.cohorts.forEach((cohort,ci) => {
    if (!enabledCohorts.has(cohort.cohort_id)) return;
    const rows=selected.filter(m => m.scope_id===cohort.cohort_id).sort((a,b)=>a.metric_date.localeCompare(b.metric_date));
    if (!rows.length) return;
    const points=rows.map(r => x(r.metric_date).toFixed(2)+','+y(Number(r.value)).toFixed(2)).join(' ');
    html += '<polyline points="'+points+'" fill="none" stroke="'+palette[ci%palette.length]+'" stroke-width="2" vector-effect="non-scaling-stroke" />';
  });
  const ticks=[0,Math.floor((dates.length-1)/3),Math.floor((dates.length-1)*2/3),dates.length-1];
  [...new Set(ticks)].forEach(i => {
    const d=dates[i], xx=x(d);
    html += '<text x="'+xx+'" y="'+(h-14)+'" text-anchor="middle" fill="#737c90" font-size="11">'+esc(d)+'</text>';
  });
  svg.innerHTML=html;
  legend.innerHTML=payload.cohorts.filter(c=>enabledCohorts.has(c.cohort_id)).map((c,i) => {
    const realIndex=payload.cohorts.findIndex(x=>x.cohort_id===c.cohort_id);
    return '<span class="legend-item"><span class="swatch" style="background:'+palette[realIndex%palette.length]+'"></span>'+esc(c.name)+'</span>';
  }).join('') + '<span class="event-note">점선 = event anchor</span>';
}

function renderReplayControls() {
  const eventSelect=document.querySelector('#event-select');
  eventSelect.innerHTML=payload.events.map((ev,i) => '<option value="'+i+'">'+esc(ev.anchor_date+' · '+ev.title+' · '+ev.anchor_type)+'</option>').join('');
  const metricSelect=document.querySelector('#replay-metric');
  metricSelect.innerHTML=Object.entries(metricLabels).map(([k,v])=>'<option value="'+k+'" '+(k==='RELATIVE_STRENGTH'?'selected':'')+'>'+v+'</option>').join('');
  eventSelect.addEventListener('change', renderReplayTable);
  metricSelect.addEventListener('change', renderReplayTable);
  renderReplayTable();
}
function renderReplayTable() {
  const event=payload.events[Number(document.querySelector('#event-select').value || 0)];
  const metric=document.querySelector('#replay-metric').value;
  const host=document.querySelector('#replay-table');
  if(!event){ host.innerHTML='<div class="muted">Replay event가 없습니다.</div>'; return; }
  const rows=payload.replay.filter(r=>r.event_id===event.event_id && r.anchor_type===event.anchor_type && r.metric_name===metric);
  const offsets=[-7,-3,-1,0,1,3,7];
  const scopes=[...new Set(rows.map(r=>r.scope_id))];
  const map=new Map(rows.map(r=>[r.scope_id+'|'+r.offset_days,r]));
  host.innerHTML='<table><thead><tr><th>Cohort</th>'+offsets.map(o=>'<th>D'+(o===0?'':o>0?'+'+o:o)+'</th>').join('')+'</tr></thead><tbody>'+
    scopes.map(scope=>'<tr><td>'+esc(cohortName(scope))+'</td>'+offsets.map(o=>{const r=map.get(scope+'|'+o);return '<td class="'+(r&&r.status==='OK'?signedClass(r.value):'muted')+'" title="'+esc(r?.reason??'')+'">'+(r&&r.status==='OK'?esc(fmt(r.value,metric)):'—')+'</td>';}).join('')+'</tr>').join('')+'</tbody></table>';
}

function renderShocks() {
  const host=document.querySelector('#shock-table');
  if(!payload.shocks.length){ host.innerHTML='<div class="muted">검출된 Shock candidate가 없습니다.</div>'; return; }
  host.innerHTML='<table><thead><tr><th>Date / Cohort</th><th>Return</th><th>z</th></tr></thead><tbody>' + payload.shocks.map(s =>
    '<tr><td><div class="shock">'+esc(s.metric_date)+'</div><div class="muted">'+esc(cohortName(s.scope_id))+'</div></td><td class="'+signedClass(s.value)+'">'+esc(fmt(s.value,'RETURN_1D'))+'</td><td>'+Number(s.robust_z).toFixed(2)+'</td></tr>'
  ).join('')+'</tbody></table>';
}

initRuns().catch(error => document.querySelector('#app').innerHTML='<div class="error">'+esc(error?.stack??error)+'</div>');
</script>
</body>
</html>`;
}
