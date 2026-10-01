export function insightViewerPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FC Market Lab</title>
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
    header { display: flex; gap: 20px; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
    h1 { margin: 0 0 6px; font-size: 25px; letter-spacing: -.03em; }
    h2 { margin: 0 0 12px; font-size: 17px; }
    p { margin: 0; color: #9299aa; font-size: 13px; line-height: 1.55; }
    select { width: 100%; background: #171a22; color: #edf0f7; border: 1px solid #2b3040; border-radius: 8px; padding: 9px 10px; }
    .run-picker { min-width: 340px; }
    .panel, .card { background: #11141b; border: 1px solid #222733; border-radius: 12px; }
    .panel { padding: 16px; margin-top: 14px; overflow: hidden; }
    .cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .card { padding: 14px 15px; min-height: 88px; }
    .label { color: #7f8799; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 8px; font-size: 20px; font-variant-numeric: tabular-nums; }
    .subvalue { margin-top: 5px; color: #7f8799; font-size: 11px; }
    .positive { color: #66d09b; }
    .negative { color: #f07878; }
    .muted { color: #687184; }
    .insight { border-left: 3px solid #7aa2f7; padding: 13px 15px; background: #101722; border-radius: 8px; }
    .insight strong { color: #f2f4f8; }
    .insight-lines { display: grid; gap: 6px; margin-top: 7px; color: #bdc4d4; font-size: 13px; line-height: 1.5; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .toolbar .left, .toolbar .right { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .metric-select { width: 190px; }
    .window-select { width: 120px; }
    .cohorts { display: flex; flex-wrap: wrap; gap: 6px; }
    .cohort-toggle { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #303646; background: #181c25; border-radius: 999px; padding: 6px 9px; color: #c8cede; font-size: 12px; cursor: pointer; }
    .cohort-toggle input { margin: 0; }
    #chart { width: 100%; height: 390px; display: block; }
    .legend, .event-chips { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 9px; font-size: 12px; color: #b7bdcc; }
    .legend-item, .event-chip { display: inline-flex; align-items: center; gap: 6px; }
    .swatch { width: 16px; height: 3px; border-radius: 2px; }
    .event-chip { border: 1px solid #293142; border-radius: 999px; padding: 4px 7px; color: #8f99ad; }
    .chart-note { margin-top: 8px; color: #747e91; font-size: 11px; }
    .grid2 { display: grid; grid-template-columns: minmax(0, 2fr) minmax(360px, 1fr); gap: 14px; }
    .event-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
    .mini { padding: 10px 11px; background: #0d1016; border: 1px solid #202632; border-radius: 8px; }
    .mini .value { font-size: 15px; margin-top: 5px; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 8px; font-size: 11px; font-weight: 650; }
    .badge.mature { background: #153025; color: #75d6a4; }
    .badge.partial { background: #302916; color: #e6c76a; }
    .badge.pending { background: #2d1d22; color: #e8999f; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 8px 9px; border-bottom: 1px solid #252a35; text-align: right; font-variant-numeric: tabular-nums; }
    th:first-child, td:first-child { text-align: left; }
    th { position: sticky; top: 0; background: #11141b; color: #848c9e; font-weight: 600; }
    td { color: #d6dae5; }
    .table-wrap { max-height: 420px; overflow: auto; }
    .shock { font-weight: 650; }
    .context { margin-top: 3px; color: #7f8799; font-size: 11px; line-height: 1.35; }
    .error { padding: 20px; border: 1px solid #66363a; background: #251519; border-radius: 10px; color: #ffb3b7; white-space: pre-wrap; }
    @media (max-width: 980px) {
      header { flex-direction: column; }
      .run-picker { width: 100%; min-width: 0; }
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid2 { grid-template-columns: 1fr; }
      .event-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>FC Market Lab</h1>
      <p>시장 방향, cohort 차이, 사건 이후 반응을 먼저 읽고 필요할 때 원시 지표를 내려본다.</p>
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
const DAY_MS = 86400000;
let payload = null;
let chartMode = 'CHANGE';
let chartWindow = 90;
let enabledCohorts = new Set();

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}
function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value) * 100;
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}
function signedClass(value) {
  return Number(value) > 0 ? 'positive' : Number(value) < 0 ? 'negative' : '';
}
function cohortName(id) {
  return payload?.cohorts.find(c => c.cohort_id === id)?.name ?? id;
}
function sampleCohort() {
  return payload?.cohorts.find(c => c.name === 'SAMPLE_MARKET') ?? null;
}
function dateMinus(date, days) {
  return new Date(Date.parse(date + 'T00:00:00Z') - days * DAY_MS).toISOString().slice(0, 10);
}
function dayNumber(date) {
  return Math.floor(Date.parse(date + 'T00:00:00Z') / DAY_MS);
}
function card(label, value, signedValue = null, sub = '') {
  return '<div class="card"><div class="label">' + esc(label) + '</div><div class="value ' +
    (signedValue == null ? '' : signedClass(signedValue)) + '">' + esc(value) + '</div>' +
    (sub ? '<div class="subvalue">' + esc(sub) + '</div>' : '') + '</div>';
}
function indexRows(scopeId) {
  return payload.metrics
    .filter(m => m.scope_id === scopeId && m.metric_name === 'INDEX' && m.status === 'OK' && m.value != null)
    .sort((a, b) => a.metric_date.localeCompare(b.metric_date));
}
function latestDate() {
  const sample = sampleCohort();
  return sample ? indexRows(sample.cohort_id).at(-1)?.metric_date ?? null : null;
}
function changeOver(scopeId, days) {
  const latest = latestDate();
  if (!latest) return null;
  const rows = indexRows(scopeId).filter(r => r.metric_date <= latest);
  const end = rows.at(-1);
  const target = dateMinus(latest, days);
  const start = rows.filter(r => r.metric_date <= target).at(-1);
  if (!start || !end || start.value == null || end.value == null || Number(start.value) === 0) return null;
  return Number(end.value) / Number(start.value) - 1;
}
function latestBreadth() {
  const sample = sampleCohort();
  const latest = latestDate();
  if (!sample || !latest) return null;
  const row = payload.metrics.find(m =>
    m.scope_id === sample.cohort_id &&
    m.metric_date === latest &&
    m.metric_name === 'BREADTH' &&
    m.status === 'OK'
  );
  return row?.value ?? null;
}
function rankCohorts(days) {
  return payload.cohorts
    .filter(c => c.name !== 'SAMPLE_MARKET')
    .flatMap(c => {
      const change = changeOver(c.cohort_id, days);
      return change == null ? [] : [{ id: c.cohort_id, name: c.name, change }];
    })
    .sort((a, b) => b.change - a.change || a.name.localeCompare(b.name));
}
function shocksInLast(days) {
  const latest = latestDate();
  if (!latest) return [];
  const cutoff = dateMinus(latest, days - 1);
  return payload.shocks.filter(s => s.metric_date >= cutoff && s.metric_date <= latest);
}
function historyCount(scopeId, days) {
  const latest = latestDate();
  if (!latest) return 0;
  const cutoff = dateMinus(latest, days);
  return indexRows(scopeId).filter(r => r.metric_date >= cutoff && r.metric_date <= latest).length;
}
function eventInsight(event) {
  const rows = payload.replay.filter(r =>
    r.event_id === event.event_id &&
    r.anchor_type === event.anchor_type &&
    r.status === 'OK'
  );
  const offsets = [...new Set(rows.map(r => r.offset_days))].sort((a, b) => a - b);
  const nonNegative = offsets.filter(o => o >= 0);
  const latestOffset = nonNegative.at(-1) ?? offsets.at(-1) ?? null;
  let maturity = 'PENDING';
  if (offsets.includes(7)) maturity = 'MATURE';
  else if (offsets.includes(3)) maturity = 'PARTIAL';
  else if (offsets.includes(1)) maturity = 'EARLY';

  const relative = latestOffset == null ? [] : rows
    .filter(r => r.offset_days === latestOffset && r.metric_name === 'RELATIVE_STRENGTH' && r.value != null)
    .flatMap(r => {
      const name = cohortName(r.scope_id);
      return name === 'SAMPLE_MARKET' ? [] : [{ id: r.scope_id, name, change: Number(r.value) }];
    })
    .sort((a, b) => b.change - a.change || a.name.localeCompare(b.name));

  return {
    event,
    offsets,
    latestOffset,
    maturity,
    strongest: relative[0] ?? null,
    weakest: relative.at(-1) ?? null
  };
}
function shockContext(shock) {
  const nearest = payload.events
    .map(event => ({ event, distance: dayNumber(shock.metric_date) - dayNumber(event.anchor_date) }))
    .filter(candidate => Math.abs(candidate.distance) <= 3)
    .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance) || a.event.anchor_date.localeCompare(b.event.anchor_date))[0];
  return nearest ?? null;
}

async function initRuns() {
  const runs = await fetch('/api/runs').then(r => r.json());
  const select = document.querySelector('#run-select');
  select.innerHTML = runs.map(run =>
    '<option value="' + esc(run.analysis_run_id) + '">' +
    esc(run.created_at.slice(0, 19).replace('T', ' ')) + ' · ' + esc(run.analysis_version) +
    '</option>'
  ).join('');
  select.addEventListener('change', () => loadRun(select.value));
  if (runs.length) await loadRun(runs[0].analysis_run_id);
  else document.querySelector('#app').innerHTML = '<div class="error">볼 수 있는 성공한 analysis run이 없습니다.</div>';
}

async function loadRun(runId) {
  try {
    payload = await fetch('/api/data?run=' + encodeURIComponent(runId)).then(async response => {
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    });
    enabledCohorts = new Set(
      payload.cohorts
        .filter(c => c.name === 'SAMPLE_MARKET' || historyCount(c.cohort_id, 90) >= 7)
        .map(c => c.cohort_id)
    );
    chartMode = 'CHANGE';
    chartWindow = 90;
    render();
  } catch (error) {
    document.querySelector('#app').innerHTML = '<div class="error">' + esc(error?.stack ?? error) + '</div>';
  }
}

function summaryLines() {
  const sample = sampleCohort();
  if (!sample) return '<div>• SAMPLE_MARKET cohort가 없어 시장 요약을 만들 수 없다.</div>';
  const change7 = changeOver(sample.cohort_id, 7);
  const change30 = changeOver(sample.cohort_id, 30);
  const breadth = latestBreadth();
  const ranked = rankCohorts(7);
  const strongest = ranked[0] ?? null;
  const weakest = ranked.at(-1) ?? null;
  const shocks = shocksInLast(30);
  const lines = [];

  if (change7 != null && change30 != null) {
    lines.push('<div>• SAMPLE_MARKET은 최근 7일 <strong class="' + signedClass(change7) + '">' +
      pct(change7) + '</strong>, 최근 30일 <strong class="' + signedClass(change30) + '">' +
      pct(change30) + '</strong> 움직였다.</div>');
  }
  if (breadth != null) {
    let breadthText = '상승/하락이 혼재돼 있다';
    if (Number(breadth) >= .7) breadthText = '표본 다수가 함께 상승했다';
    else if (Number(breadth) <= .3) breadthText = '상승이 소수에 제한됐다';
    lines.push('<div>• 최신 상승 breadth는 <strong>' + pct(breadth) + '</strong> — ' + breadthText + '.</div>');
  }
  if (strongest && weakest) {
    lines.push('<div>• 최근 7일 cohort 중 <strong>' + esc(strongest.name) + ' ' + pct(strongest.change) +
      '</strong>가 가장 강하고, <strong>' + esc(weakest.name) + ' ' + pct(weakest.change) +
      '</strong>가 가장 약했다.</div>');
  }
  lines.push('<div>• 최근 30일 Shock candidate는 <strong>' + shocks.length +
    '</strong>건이다. Shock는 원인 판정이 아니라 비정상 변동 후보만 뜻한다.</div>');
  return lines.join('');
}

function render() {
  const sample = sampleCohort();
  const change7 = sample ? changeOver(sample.cohort_id, 7) : null;
  const change30 = sample ? changeOver(sample.cohort_id, 30) : null;
  const breadth = latestBreadth();
  const ranked = rankCohorts(7);
  const strongest = ranked[0] ?? null;
  const shocks30 = shocksInLast(30);
  const app = document.querySelector('#app');

  app.innerHTML =
    '<section class="insight"><strong>지금 이 데이터가 말하는 것</strong><div class="insight-lines">' +
      summaryLines() + '</div></section>' +
    '<section class="cards" style="margin-top:14px">' +
      card('시장 7일', pct(change7), change7, 'SAMPLE_MARKET') +
      card('시장 30일', pct(change30), change30, 'SAMPLE_MARKET') +
      card('상승 breadth', pct(breadth), breadth, '최신 관측일') +
      card('7일 강한 cohort', strongest?.name ?? '—', strongest?.change ?? null, strongest ? pct(strongest.change) : '비교 데이터 부족') +
      card('최근 30일 Shock', String(shocks30.length), null, '통계적 이상치 후보') +
    '</section>' +
    '<section class="panel">' +
      '<div class="toolbar"><div class="left"><div><h2 style="margin:0 0 4px">Cohort 움직임 비교</h2>' +
      '<p>기본값은 각 cohort의 표시 구간 첫 관측을 0%로 다시 맞춘 누적 변화다.</p></div>' +
      '<select id="mode-select" class="metric-select">' +
        '<option value="CHANGE">기간 누적 변화</option>' +
        '<option value="RETURN_1D">1일 수익률</option>' +
        '<option value="RELATIVE_STRENGTH">시장 대비 상대강도</option>' +
        '<option value="BREADTH">상승 breadth</option>' +
      '</select>' +
      '<select id="window-select" class="window-select">' +
        '<option value="30">30일</option><option value="90" selected>90일</option><option value="0">전체</option>' +
      '</select></div><div id="cohort-toggles" class="cohorts"></div></div>' +
      '<svg id="chart" viewBox="0 0 1200 390" preserveAspectRatio="none"></svg>' +
      '<div id="legend" class="legend"></div><div id="event-chips" class="event-chips"></div>' +
      '<div class="chart-note">기간 누적 변화는 cohort마다 자신의 첫 표시 관측을 0%로 재기준화한다. 시작일이 다른 cohort의 절대 지수 수준을 비교하는 그래프가 아니다.</div>' +
    '</section>' +
    '<section class="grid2">' +
      '<div class="panel"><div class="toolbar"><div><h2 style="margin:0 0 4px">사건 이후 무엇이 달랐나</h2>' +
      '<p>상대강도는 SAMPLE_MARKET 대비 차이다. 후속 데이터가 부족하면 영향 해석을 보류한다.</p></div>' +
      '<select id="event-select" style="width:390px"></select></div><div id="event-summary"></div>' +
      '<div id="replay-table" class="table-wrap"></div></div>' +
      '<div class="panel"><h2>Shock: 비정상적으로 튄 날</h2>' +
      '<p style="margin-bottom:10px">z는 평소 분포에서 얼마나 멀리 벗어났는지를 나타낸다. 가까운 등록 사건은 시간적 근접성만 표시한다.</p>' +
      '<div id="shock-table" class="table-wrap"></div></div>' +
    '</section>';

  document.querySelector('#mode-select').value = chartMode;
  document.querySelector('#mode-select').addEventListener('change', event => {
    chartMode = event.target.value;
    renderChart();
  });
  document.querySelector('#window-select').value = String(chartWindow);
  document.querySelector('#window-select').addEventListener('change', event => {
    chartWindow = Number(event.target.value);
    renderChart();
  });

  renderCohortToggles();
  renderChart();
  renderEventControls();
  renderShocks();
}

function renderCohortToggles() {
  const host = document.querySelector('#cohort-toggles');
  host.innerHTML = payload.cohorts.map((cohort, index) =>
    '<label class="cohort-toggle"><input type="checkbox" data-id="' + esc(cohort.cohort_id) + '" ' +
    (enabledCohorts.has(cohort.cohort_id) ? 'checked' : '') + ' />' +
    '<span class="swatch" style="background:' + palette[index % palette.length] + '"></span>' +
    esc(cohort.name) + '</label>'
  ).join('');

  host.querySelectorAll('input').forEach(input => input.addEventListener('change', event => {
    event.target.checked
      ? enabledCohorts.add(event.target.dataset.id)
      : enabledCohorts.delete(event.target.dataset.id);
    renderChart();
  }));
}

function chartRows() {
  const latest = latestDate();
  const cutoff = latest && chartWindow > 0 ? dateMinus(latest, chartWindow) : null;

  if (chartMode === 'CHANGE') {
    const rows = [];
    payload.cohorts.forEach(cohort => {
      if (!enabledCohorts.has(cohort.cohort_id)) return;
      const source = indexRows(cohort.cohort_id)
        .filter(row => !cutoff || row.metric_date >= cutoff);
      if (source.length < 2) return;
      const base = Number(source[0].value);
      if (!Number.isFinite(base) || base === 0) return;
      source.forEach(row => rows.push({
        metric_date: row.metric_date,
        scope_id: row.scope_id,
        value: Number(row.value) / base - 1
      }));
    });
    return rows;
  }

  return payload.metrics
    .filter(metric =>
      metric.metric_name === chartMode &&
      metric.status === 'OK' &&
      metric.value != null &&
      enabledCohorts.has(metric.scope_id) &&
      (!cutoff || metric.metric_date >= cutoff)
    )
    .map(metric => ({
      metric_date: metric.metric_date,
      scope_id: metric.scope_id,
      value: Number(metric.value)
    }));
}

function renderChart() {
  const svg = document.querySelector('#chart');
  const legend = document.querySelector('#legend');
  const chips = document.querySelector('#event-chips');
  const selected = chartRows();

  if (!selected.length) {
    svg.innerHTML = '<text x="600" y="195" text-anchor="middle" fill="#6e7688">이 기간에 비교 가능한 데이터가 없습니다.</text>';
    legend.innerHTML = '';
    chips.innerHTML = '';
    return;
  }

  const dates = [...new Set(selected.map(row => row.metric_date))].sort();
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const values = selected.map(row => Number(row.value));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (chartMode === 'CHANGE' || chartMode === 'RETURN_1D' || chartMode === 'RELATIVE_STRENGTH') {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    min -= .01;
    max += .01;
  }
  const pad = Math.max((max - min) * .08, .0001);
  min -= pad;
  max += pad;

  const left = 66, right = 18, top = 24, bottom = 42, width = 1200, height = 390;
  const x = date => left + (dateIndex.get(date) ?? 0) / Math.max(1, dates.length - 1) * (width - left - right);
  const y = value => top + (max - value) / (max - min) * (height - top - bottom);
  let html = '';

  for (let index = 0; index <= 4; index += 1) {
    const value = max - (max - min) * index / 4;
    const yy = y(value);
    html += '<line x1="' + left + '" y1="' + yy + '" x2="' + (width - right) + '" y2="' + yy + '" stroke="#232936" />' +
      '<text x="' + (left - 8) + '" y="' + (yy + 4) + '" text-anchor="end" fill="#737c90" font-size="11">' +
      pct(value) + '</text>';
  }
  if (min < 0 && max > 0) {
    const yy = y(0);
    html += '<line x1="' + left + '" y1="' + yy + '" x2="' + (width - right) + '" y2="' + yy + '" stroke="#566176" stroke-width="1.2" />';
  }

  const visibleEvents = payload.events.filter(event => dateIndex.has(event.anchor_date));
  visibleEvents.forEach(event => {
    const xx = x(event.anchor_date);
    html += '<g><title>' + esc(event.anchor_date + ' · ' + event.title) + '</title>' +
      '<line x1="' + xx + '" y1="' + top + '" x2="' + xx + '" y2="' + (height - bottom) +
      '" stroke="#394354" stroke-dasharray="3 5" /><circle cx="' + xx + '" cy="' + (top + 4) +
      '" r="3" fill="#8490a6" /></g>';
  });

  payload.cohorts.forEach((cohort, cohortIndex) => {
    if (!enabledCohorts.has(cohort.cohort_id)) return;
    const rows = selected
      .filter(row => row.scope_id === cohort.cohort_id)
      .sort((a, b) => a.metric_date.localeCompare(b.metric_date));
    if (rows.length < 2) return;
    const points = rows.map(row =>
      x(row.metric_date).toFixed(2) + ',' + y(Number(row.value)).toFixed(2)
    ).join(' ');
    html += '<polyline points="' + points + '" fill="none" stroke="' +
      palette[cohortIndex % palette.length] +
      '" stroke-width="2" vector-effect="non-scaling-stroke" />';
  });

  const ticks = [0, Math.floor((dates.length - 1) / 3), Math.floor((dates.length - 1) * 2 / 3), dates.length - 1];
  [...new Set(ticks)].forEach(index => {
    const date = dates[index];
    const xx = x(date);
    html += '<text x="' + xx + '" y="' + (height - 14) + '" text-anchor="middle" fill="#737c90" font-size="11">' +
      esc(date) + '</text>';
  });

  svg.innerHTML = html;
  legend.innerHTML = payload.cohorts
    .filter(cohort => enabledCohorts.has(cohort.cohort_id))
    .map(cohort => {
      const cohortIndex = payload.cohorts.findIndex(candidate => candidate.cohort_id === cohort.cohort_id);
      const count = selected.filter(row => row.scope_id === cohort.cohort_id).length;
      return '<span class="legend-item ' + (count < 2 ? 'muted' : '') + '">' +
        '<span class="swatch" style="background:' + palette[cohortIndex % palette.length] + '"></span>' +
        esc(cohort.name) + (count < 2 ? ' · 데이터 부족' : '') + '</span>';
    }).join('');
  chips.innerHTML = visibleEvents
    .map(event => '<span class="event-chip">' + esc(event.anchor_date.slice(5) + ' · ' + event.title) + '</span>')
    .join('');
}

function maturityLabel(maturity) {
  if (maturity === 'MATURE') return ['D+7 관측 완료', 'mature'];
  if (maturity === 'PARTIAL') return ['D+3까지 관측', 'partial'];
  if (maturity === 'EARLY') return ['D+1까지만 관측', 'partial'];
  return ['후속 관측 부족 · 판단 보류', 'pending'];
}

function renderEventControls() {
  const select = document.querySelector('#event-select');
  const indexed = payload.events.map((event, index) => ({
    event,
    index,
    insight: eventInsight(event)
  }));

  select.innerHTML = indexed.slice().reverse().map(item =>
    '<option value="' + item.index + '">' +
    esc(item.event.anchor_date + ' · ' + item.event.title + ' · ' + item.event.anchor_type) +
    '</option>'
  ).join('');

  const defaultEvent = indexed.slice().reverse().find(item => item.insight.maturity === 'MATURE') ?? indexed.at(-1);
  if (defaultEvent) select.value = String(defaultEvent.index);
  select.addEventListener('change', renderEvent);
  renderEvent();
}

function renderEvent() {
  const event = payload.events[Number(document.querySelector('#event-select').value || 0)];
  const summaryHost = document.querySelector('#event-summary');
  const tableHost = document.querySelector('#replay-table');

  if (!event) {
    summaryHost.innerHTML = '';
    tableHost.innerHTML = '<div class="muted">Replay event가 없습니다.</div>';
    return;
  }

  const insight = eventInsight(event);
  const label = maturityLabel(insight.maturity);
  const basis = insight.latestOffset == null
    ? '—'
    : 'D' + (insight.latestOffset === 0 ? '' : insight.latestOffset > 0 ? '+' + insight.latestOffset : insight.latestOffset);

  summaryHost.innerHTML =
    '<div class="event-summary">' +
      '<div class="mini"><div class="label">관측 상태</div><div class="value"><span class="badge ' +
        label[1] + '">' + esc(label[0]) + '</span></div></div>' +
      '<div class="mini"><div class="label">비교 기준</div><div class="value">' + esc(basis) + '</div></div>' +
      '<div class="mini"><div class="label">시장보다 강한 cohort</div><div class="value ' +
        signedClass(insight.strongest?.change) + '">' +
        (insight.strongest ? esc(insight.strongest.name + ' ' + pct(insight.strongest.change)) : '—') +
      '</div></div>' +
      '<div class="mini"><div class="label">시장보다 약한 cohort</div><div class="value ' +
        signedClass(insight.weakest?.change) + '">' +
        (insight.weakest ? esc(insight.weakest.name + ' ' + pct(insight.weakest.change)) : '—') +
      '</div></div>' +
    '</div>';

  const rows = payload.replay.filter(row =>
    row.event_id === event.event_id &&
    row.anchor_type === event.anchor_type &&
    row.metric_name === 'RELATIVE_STRENGTH'
  );
  const offsets = insight.offsets.filter(offset => [-7, -3, -1, 0, 1, 3, 7].includes(offset));
  if (!offsets.length) {
    tableHost.innerHTML = '<div class="muted">비교 가능한 상대강도 결과가 없습니다.</div>';
    return;
  }

  const scopes = [...new Set(rows.map(row => row.scope_id))]
    .filter(scopeId => cohortName(scopeId) !== 'SAMPLE_MARKET');
  const map = new Map(rows.map(row => [row.scope_id + '|' + row.offset_days, row]));

  tableHost.innerHTML =
    '<table><thead><tr><th>Cohort</th>' +
      offsets.map(offset => '<th>D' + (offset === 0 ? '' : offset > 0 ? '+' + offset : offset) + '</th>').join('') +
    '</tr></thead><tbody>' +
      scopes.map(scopeId =>
        '<tr><td>' + esc(cohortName(scopeId)) + '</td>' +
        offsets.map(offset => {
          const row = map.get(scopeId + '|' + offset);
          return '<td class="' + (row && row.status === 'OK' ? signedClass(row.value) : 'muted') + '">' +
            (row && row.status === 'OK' ? esc(pct(row.value)) : '—') +
            '</td>';
        }).join('') +
        '</tr>'
      ).join('') +
    '</tbody></table>';
}

function renderShocks() {
  const host = document.querySelector('#shock-table');
  if (!payload.shocks.length) {
    host.innerHTML = '<div class="muted">검출된 Shock candidate가 없습니다.</div>';
    return;
  }

  host.innerHTML =
    '<table><thead><tr><th>Date / Cohort</th><th>Return</th><th>z</th></tr></thead><tbody>' +
    payload.shocks.map(shock => {
      const context = shockContext(shock);
      let note = '등록된 사건과 ±3일 내 근접 없음';
      if (context) {
        const distance = context.distance;
        const timing = distance === 0
          ? '같은 날'
          : distance > 0
            ? '사건 ' + distance + '일 후'
            : '사건 ' + Math.abs(distance) + '일 전';
        note = timing + ' · ' + context.event.title;
      }
      return '<tr><td><div class="shock">' + esc(shock.metric_date + ' · ' + cohortName(shock.scope_id)) +
        '</div><div class="context">' + esc(note) + '</div></td><td class="' +
        signedClass(shock.value) + '">' + esc(pct(shock.value)) + '</td><td>' +
        Number(shock.robust_z).toFixed(2) + '</td></tr>';
    }).join('') +
    '</tbody></table>';
}

initRuns().catch(error => {
  document.querySelector('#app').innerHTML = '<div class="error">' + esc(error?.stack ?? error) + '</div>';
});
</script>
</body>
</html>`;
}
