export function insightViewerPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FC Market Lab · 시장 인사이트</title>
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
    .header-actions { display: grid; gap: 9px; justify-items: end; min-width: 390px; }
    .nav { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .nav a { padding: 7px 10px; border: 1px solid #293142; border-radius: 8px; color: #98a2b7; font-size: 12px; text-decoration: none; }
    .nav a.active { color: #edf0f7; background: #171c26; border-color: #3b465b; }
    .run-picker { width: 100%; max-width: 390px; }
    .eyebrow { color: #73809a; font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; margin-bottom: 5px; }
    .panel, .card { background: #11141b; border: 1px solid #222733; border-radius: 12px; }
    .panel { padding: 16px; margin-top: 14px; overflow: hidden; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .card { padding: 14px 15px; min-height: 88px; }
    .label { color: #7f8799; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 8px; font-size: 20px; font-variant-numeric: tabular-nums; }
    .subvalue { margin-top: 5px; color: #7f8799; font-size: 11px; }
    .positive { color: #66d09b; }
    .negative { color: #f07878; }
    .muted { color: #687184; }
    .insight { border-left: 3px solid #7aa2f7; padding: 13px 15px; background: #101722; border-radius: 8px; }
    .insight strong { color: #f2f4f8; }
    .insight-head { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: baseline; justify-content: space-between; }
    .data-basis { color: #748096; font-size: 11px; }
    details.terms { margin-top: 12px; border-top: 1px solid #252a35; padding-top: 10px; }
    details.terms summary { cursor: pointer; color: #9ba6b9; font-size: 12px; }
    .term-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin-top: 9px; }
    .term { padding: 9px 10px; border-radius: 8px; background: #0d1016; color: #8d97a9; font-size: 11px; line-height: 1.5; }
    .term strong { display: block; color: #c5ccda; margin-bottom: 2px; }
    .insight-lines { display: grid; gap: 6px; margin-top: 7px; color: #bdc4d4; font-size: 13px; line-height: 1.5; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .toolbar .left, .toolbar .right { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .metric-select { width: 190px; }
    .window-select { width: 120px; }
    .cohorts { display: flex; flex-wrap: wrap; gap: 6px; }
    .cohort-toggle { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #303646; background: #181c25; border-radius: 999px; padding: 6px 9px; color: #c8cede; font-size: 12px; cursor: pointer; }
    .cohort-toggle input { margin: 0; }
    #chart-wrap { position: relative; }
    #chart { width: 100%; height: 390px; display: block; cursor: crosshair; touch-action: none; }
    .chart-tooltip { position: absolute; z-index: 3; min-width: 220px; max-width: 320px; padding: 10px 11px; border: 1px solid #343b4b; border-radius: 9px; background: rgba(18, 22, 30, .96); box-shadow: 0 8px 24px rgba(0, 0, 0, .28); pointer-events: none; font-size: 11px; line-height: 1.45; }
    .chart-tooltip[hidden] { display: none; }
    .tooltip-date { margin-bottom: 7px; color: #edf0f7; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .tooltip-event { margin: 0 0 7px; padding: 7px 8px; border-radius: 7px; background: #171c26; color: #c7cfdd; }
    .tooltip-event-meta { color: #7f899c; }
    .tooltip-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: 4px; color: #b8c0cf; }
    .tooltip-series { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .tooltip-value { color: #edf0f7; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .legend, .event-chips { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 9px; font-size: 12px; color: #b7bdcc; }
    .legend-item, .event-chip { display: inline-flex; align-items: center; gap: 6px; }
    .swatch { width: 16px; height: 3px; border-radius: 2px; }
    .event-chip { border: 1px solid #293142; border-radius: 999px; padding: 4px 7px; color: #8f99ad; outline: none; cursor: default; }
    .event-chip:focus-visible { border-color: #7aa2f7; color: #c8d6f3; }
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
      .header-actions { width: 100%; min-width: 0; justify-items: stretch; }
      .nav { justify-content: flex-start; }
      .run-picker { width: 100%; max-width: none; }
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid2 { grid-template-columns: 1fr; }
      .event-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .term-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="eyebrow">FC온라인 이적시장</div>
      <h1>시장 인사이트</h1>
      <p>먼저 시장이 얼마나 올랐는지 보여줘요. 더 궁금하면 선수 그룹별 흐름을 내려볼 수 있어요.</p>
    </div>
    <div class="header-actions">
      <nav class="nav" aria-label="화면 이동">
        <a class="active" href="/">시장 인사이트</a>
        <a href="/benchmark">시장 대표지표</a>
      </nav>
      <div class="run-picker">
        <div class="label" style="margin-bottom:6px">선수 그룹 분석 기준</div>
        <select id="run-select"></select>
      </div>
    </div>
  </header>
  <div id="app"><div class="panel">시장 데이터를 불러오는 중…</div></div>
</main>
<script>
const palette = ['#7aa2f7','#9ece6a','#e0af68','#bb9af7','#7dcfff','#f7768e','#73daca','#c0caf5'];
const DAY_MS = 86400000;
let payload = null;
let benchmark = null;
let chartMode = 'CHANGE';
let chartWindow = 90;
let enabledCohorts = new Set();
const cohortLabels = {
  SAMPLE_MARKET: '초기 시장 표본',
  CORE: '핵심 인기 선수 그룹',
  META: '메타 상위 선수 그룹',
  PACK_EXPOSED: '선수팩 직접 공급 그룹',
  INDIRECT_EXPOSED: '선수팩 간접 영향 그룹'
};
const anchorLabels = {
  ANNOUNCED: '공지 시점',
  EFFECTIVE: '적용 시점',
  ENDED: '종료 시점',
  FIRST_OBSERVED: '최초 관측 시점'
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}
function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value) * 100;
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}
function plainPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return (Number(value) * 100).toFixed(2) + '%';
}
function axisPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value) * 100;
  if (Math.abs(n) < 1e-10) return '0%';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return (n > 0 ? '+' : '') + n.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }) + '%';
}
function niceChartStep(range) {
  const rough = range / 5;
  if (!Number.isFinite(rough) || rough <= 0) return .01;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  return niceFraction * magnitude;
}
function niceChartScale(values, includeZero = true) {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    const delta = Math.max(Math.abs(min) * .05, .01);
    min -= delta;
    max += delta;
  }
  const step = niceChartStep(max - min);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const count = Math.max(1, Math.round((niceMax - niceMin) / step));
  const ticks = Array.from({ length: count + 1 }, (_, index) =>
    Number((niceMax - step * index).toPrecision(12))
  );
  return { min: niceMin, max: niceMax, ticks };
}
function signedClass(value) {
  return Number(value) > 0 ? 'positive' : Number(value) < 0 ? 'negative' : '';
}
function cohortName(id) {
  const raw = payload?.cohorts.find(c => c.cohort_id === id)?.name ?? id;
  return cohortLabels[raw] ?? raw.replaceAll('_', ' ');
}
function anchorLabel(type) {
  return anchorLabels[type] ?? type.replaceAll('_', ' ');
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
function returnRows(scopeId) {
  return payload.metrics
    .filter(m => m.scope_id === scopeId && m.metric_name === 'RETURN_1D' && m.status === 'OK' && m.value != null)
    .sort((a, b) => a.metric_date.localeCompare(b.metric_date));
}
function latestDate() {
  const sample = sampleCohort();
  return sample ? returnRows(sample.cohort_id).at(-1)?.metric_date ?? null : null;
}
function changeOver(scopeId, days) {
  const latest = latestDate();
  if (!latest) return null;
  const target = dateMinus(latest, days);
  const rows = returnRows(scopeId).filter(r => r.metric_date > target && r.metric_date <= latest);
  if (rows.length !== days) return null;
  const targetDay = dayNumber(target);
  if (rows.some((row, index) => dayNumber(row.metric_date) !== targetDay + index + 1)) return null;
  return rows.reduce((factor, row) => factor * (1 + Number(row.value)), 1) - 1;
}
function marketReady() {
  return benchmark?.published === true &&
    benchmark.analysis_version === 'market-benchmark-v2' &&
    benchmark.benchmark_status === 'STABLE' &&
    benchmark.display_role === 'SELECTED_PRODUCTION';
}
function marketMetric(name) {
  return benchmark?.latest_metrics.find(item => item.metric_name === name) ?? null;
}
function marketHistory(name) {
  return (benchmark?.history_metrics ?? [])
    .filter(item => item.metric_name === name && item.metric_status === 'OK' && item.point_value != null)
    .sort((a, b) => a.metric_date.localeCompare(b.metric_date));
}
function marketLatestDate() {
  return benchmark?.latest_metric_date ?? null;
}
function marketChangeOver(days) {
  const latest = marketLatestDate();
  if (!latest) return null;
  const target = dateMinus(latest, days);
  const rows = marketHistory('RETURN_1D').filter(
    row => row.metric_date > target && row.metric_date <= latest
  );
  if (rows.length !== days) return null;
  return rows.reduce((factor, row) => factor * (1 + Number(row.point_value)), 1) - 1;
}
function latestBreadth() {
  return marketMetric('BREADTH')?.point_value ?? null;
}
function latestCoverage() {
  return marketMetric('RETURN_1D')?.weighted_coverage ?? null;
}
function marketBackcastNotice() {
  const latest = marketLatestDate();
  if (!latest) return '';
  const cutoff = dateMinus(latest, 30);
  const includesBackcast = marketHistory('RETURN_1D').some(
    row => row.metric_date > cutoff && row.metric_date <= latest && row.period_type === 'FIXED_PANEL_BACKCAST'
  );
  if (!includesBackcast) return '';
  return '최근 30일 일부는 지금 고른 대표 선수 ' + benchmark.display_panel_size + '명의 당시 가격으로 다시 계산했어요.';
}
function rankCohorts(days) {
  return payload.cohorts
    .filter(c => c.name !== 'SAMPLE_MARKET')
    .flatMap(c => {
      const change = changeOver(c.cohort_id, days);
      return change == null ? [] : [{ id: c.cohort_id, name: cohortName(c.cohort_id), change }];
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
  return returnRows(scopeId).filter(r => r.metric_date >= cutoff && r.metric_date <= latest).length;
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
      const cohort = payload?.cohorts.find(candidate => candidate.cohort_id === r.scope_id);
      return cohort?.name === 'SAMPLE_MARKET'
        ? []
        : [{ id: r.scope_id, name: cohortName(r.scope_id), change: Number(r.value) }];
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
    esc('데이터 기준 ' + run.analysis_cutoff.slice(0, 10) + ' · 생성 ' + run.created_at.slice(0, 10)) +
    '</option>'
  ).join('');
  select.addEventListener('change', () => loadRun(select.value));
  if (runs.length) await loadRun(runs[0].analysis_run_id);
  else document.querySelector('#app').innerHTML = '<div class="error">표시할 분석 결과가 없다. 먼저 시장 분석을 실행해야 한다.</div>';
}

async function loadRun(runId) {
  try {
    [payload, benchmark] = await Promise.all([
      fetch('/api/data?run=' + encodeURIComponent(runId)).then(async response => {
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      }),
      fetch('/api/benchmark').then(async response => {
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      })
    ]);
    if (!marketReady()) {
      throw new Error('검증된 시장 대표지표가 아직 준비되지 않았어요. 시장 대표지표 검증을 먼저 완료해 주세요.');
    }
    enabledCohorts = new Set(
      payload.cohorts
        .filter(c => c.name !== 'SAMPLE_MARKET' && historyCount(c.cohort_id, 90) >= 7)
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
  if (!marketReady()) return '<div>검증된 시장 대표지표가 아직 없다.</div>';
  const change7 = marketChangeOver(7);
  const change30 = marketChangeOver(30);
  const breadth = latestBreadth();
  const lines = [];

  if (change7 != null && change30 != null) {
    lines.push('<div>최근 7일 시장은 <strong class="' + signedClass(change7) + '">' +
      pct(change7) + '</strong>, 최근 30일은 <strong class="' + signedClass(change30) + '">' +
      pct(change30) + '</strong> 움직였어요.</div>');
  }
  if (breadth != null) {
    let breadthText = '오른 선수와 내린 선수가 비슷하게 섞여 있어요';
    if (Number(breadth) >= .7) breadthText = '대표 선수 대부분이 함께 올랐어요';
    else if (Number(breadth) <= .3) breadthText = '오른 선수는 일부에 그쳤어요';
    lines.push('<div>가장 최근에는 대표 선수 중 <strong>' + plainPct(breadth) + '</strong>가 전날보다 올랐어요. ' + breadthText + '.</div>');
  }
  return lines.join('');
}

function render() {
  const change7 = marketChangeOver(7);
  const change30 = marketChangeOver(30);
  const breadth = latestBreadth();
  const ranked = rankCohorts(7);
  const strongest = ranked[0] ?? null;
  const coverage = latestCoverage();
  const latestReturn = marketMetric('RETURN_1D');
  const app = document.querySelector('#app');
  const backcastNotice = marketBackcastNotice();
  const basis = [
    marketLatestDate() ? marketLatestDate() + ' 기준' : null,
    benchmark?.display_panel_size ? '대표 선수 ' + benchmark.display_panel_size + '명' : null,
    latestReturn ? latestReturn.valid_count + '/' + latestReturn.total_count + '명 가격 반영' : null,
    coverage == null ? null : '데이터 ' + plainPct(coverage) + ' 반영'
  ].filter(Boolean).join(' · ');

  app.innerHTML =
    '<section class="insight"><div class="insight-head"><strong>지금 시장은</strong><span class="data-basis">' + esc(basis) + '</span></div><div class="insight-lines">' +
      summaryLines() + '</div>' +
      (backcastNotice ? '<div class="data-basis" style="margin-top:8px">' + esc(backcastNotice) + '</div>' : '') +
    '</section>' +
    '<section class="cards" style="margin-top:14px">' +
      card('최근 7일', pct(change7), change7, benchmark.display_panel_size + '명 대표지표') +
      card('최근 30일', pct(change30), change30, benchmark.display_panel_size + '명 대표지표') +
      card('오늘 오른 선수', plainPct(breadth), null, '대표 선수 중 전날보다 오른 비율') +
      card('7일 동안 가장 많이 오른 그룹', strongest?.name ?? '—', strongest?.change ?? null, strongest ? pct(strongest.change) : '비교 데이터 부족') +
    '</section>' +
    '<section class="panel">' +
      '<div class="toolbar"><div class="left"><div><h2 style="margin:0 0 4px">선수 그룹별 흐름</h2>' +
      '<p>같은 기간에 어떤 선수 그룹이 더 많이 오르고 내렸는지 비교해요.</p></div>' +
      '<select id="mode-select" class="metric-select">' +
        '<option value="CHANGE">기간 누적 등락</option>' +
        '<option value="RETURN_1D">하루 등락</option>' +
      '</select>' +
      '<select id="window-select" class="window-select">' +
        '<option value="30">30일</option><option value="90" selected>90일</option><option value="0">전체</option>' +
      '</select></div><div id="cohort-toggles" class="cohorts"></div></div>' +
      '<div id="chart-wrap"><svg id="chart" viewBox="0 0 1200 390" preserveAspectRatio="none"></svg>' +
      '<div id="chart-tooltip" class="chart-tooltip" hidden></div></div>' +
      '<div id="legend" class="legend"></div><div id="event-chips" class="event-chips"></div>' +
      '<div class="chart-note">기간 누적 등락은 표시 구간의 첫 유효 날짜를 0%로 맞추고 하루 등락률을 이어 계산해요. 데이터가 끊기면 새 구간을 0%에서 다시 시작해요.</div>' +
    '</section>' +
    '<section class="panel"><h2>평소보다 크게 움직인 날</h2>' +
      '<p style="margin-bottom:10px">평소보다 가격이 크게 움직인 날짜만 모았어요. 근처 이벤트는 함께 보여주지만 원인이라고 단정하지 않아요.</p>' +
      '<div id="shock-table" class="table-wrap"></div></section>';

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
  renderShocks();
}

function renderCohortToggles() {
  const host = document.querySelector('#cohort-toggles');
  host.innerHTML = payload.cohorts.map((cohort, index) =>
    '<label class="cohort-toggle"><input type="checkbox" data-id="' + esc(cohort.cohort_id) + '" ' +
    (enabledCohorts.has(cohort.cohort_id) ? 'checked' : '') + ' />' +
    '<span class="swatch" style="background:' + palette[index % palette.length] + '"></span>' +
    esc(cohortName(cohort.cohort_id)) + '</label>'
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
      const source = returnRows(cohort.cohort_id)
        .filter(row => !cutoff || row.metric_date >= cutoff);
      if (source.length < 2) return;

      let previousDate = null;
      let factor = 1;
      let segment = 0;
      source.forEach(row => {
        const continuous = previousDate != null && dayNumber(row.metric_date) === dayNumber(previousDate) + 1;
        if (!continuous) {
          factor = 1;
          segment += 1;
        } else {
          factor *= 1 + Number(row.value);
        }
        rows.push({
          metric_date: row.metric_date,
          scope_id: row.scope_id,
          value: factor - 1,
          segment
        });
        previousDate = row.metric_date;
      });
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
      value: Number(metric.value),
      segment: 0
    }));
}

function renderChart() {
  const svg = document.querySelector('#chart');
  const tooltip = document.querySelector('#chart-tooltip');
  const legend = document.querySelector('#legend');
  const chips = document.querySelector('#event-chips');
  const selected = chartRows();

  if (!selected.length) {
    svg.innerHTML = '<text x="600" y="195" text-anchor="middle" fill="#6e7688">이 기간에 비교 가능한 데이터가 없습니다.</text>';
    tooltip.hidden = true;
    legend.innerHTML = '';
    chips.innerHTML = '';
    return;
  }

  const dates = [...new Set(selected.map(row => row.metric_date))].sort();
  const startDay = dayNumber(dates[0]);
  const endDay = dayNumber(dates.at(-1));
  const spanDays = Math.max(1, endDay - startDay);
  const values = selected.map(row => Number(row.value));
  const scale = niceChartScale(values, true);
  const min = scale.min;
  const max = scale.max;

  const left = 66, right = 18, top = 24, bottom = 42, width = 1200, height = 390;
  const x = date => left + (dayNumber(date) - startDay) / spanDays * (width - left - right);
  const y = value => top + (max - value) / (max - min) * (height - top - bottom);
  let html = '';

  scale.ticks.forEach(value => {
    const yy = y(value);
    html += '<line x1="' + left + '" y1="' + yy + '" x2="' + (width - right) + '" y2="' + yy + '" stroke="#232936" />' +
      '<text x="' + (left - 8) + '" y="' + (yy + 4) + '" text-anchor="end" fill="#737c90" font-size="11">' +
      axisPct(value) + '</text>';
  });
  if (min < 0 && max > 0) {
    const yy = y(0);
    html += '<line x1="' + left + '" y1="' + yy + '" x2="' + (width - right) + '" y2="' + yy + '" stroke="#566176" stroke-width="1.2" />';
  }

  const visibleEvents = payload.events.filter(event => {
    const day = dayNumber(event.anchor_date);
    return day >= startDay && day <= endDay;
  });
  visibleEvents.forEach(event => {
    const xx = x(event.anchor_date);
    html += '<g aria-label="' + esc(event.anchor_date + ' · ' + event.title) + '">' +
      '<line x1="' + xx + '" y1="' + top + '" x2="' + xx + '" y2="' + (height - bottom) +
      '" stroke="#394354" stroke-dasharray="3 5" /><circle cx="' + xx + '" cy="' + (top + 4) +
      '" r="3.5" fill="#8490a6" /></g>';
  });

  payload.cohorts.forEach((cohort, cohortIndex) => {
    if (!enabledCohorts.has(cohort.cohort_id)) return;
    const rows = selected
      .filter(row => row.scope_id === cohort.cohort_id)
      .sort((a, b) => a.metric_date.localeCompare(b.metric_date));
    const segments = [...new Set(rows.map(row => row.segment ?? 0))];
    segments.forEach(segment => {
      const segmentRows = rows.filter(row => (row.segment ?? 0) === segment);
      if (segmentRows.length === 1) {
        const row = segmentRows[0];
        html += '<circle cx="' + x(row.metric_date) + '" cy="' + y(Number(row.value)) + '" r="2.5" fill="' +
          palette[cohortIndex % palette.length] + '" />';
        return;
      }
      if (segmentRows.length < 2) return;
      const points = segmentRows.map(row =>
        x(row.metric_date).toFixed(2) + ',' + y(Number(row.value)).toFixed(2)
      ).join(' ');
      html += '<polyline points="' + points + '" fill="none" stroke="' +
        palette[cohortIndex % palette.length] +
        '" stroke-width="2" vector-effect="non-scaling-stroke" />';
    });
  });

  const ticks = [0, Math.floor((dates.length - 1) / 3), Math.floor((dates.length - 1) * 2 / 3), dates.length - 1];
  [...new Set(ticks)].forEach(index => {
    const date = dates[index];
    const xx = x(date);
    html += '<text x="' + xx + '" y="' + (height - 14) + '" text-anchor="middle" fill="#737c90" font-size="11">' +
      esc(date) + '</text>';
  });
  html += '<g id="hover-layer" visibility="hidden" pointer-events="none"></g>';

  svg.innerHTML = html;
  legend.innerHTML = payload.cohorts
    .filter(cohort => enabledCohorts.has(cohort.cohort_id))
    .map(cohort => {
      const cohortIndex = payload.cohorts.findIndex(candidate => candidate.cohort_id === cohort.cohort_id);
      const count = selected.filter(row => row.scope_id === cohort.cohort_id).length;
      return '<span class="legend-item ' + (count < 2 ? 'muted' : '') + '">' +
        '<span class="swatch" style="background:' + palette[cohortIndex % palette.length] + '"></span>' +
        esc(cohortName(cohort.cohort_id)) + (count < 2 ? ' · 데이터 부족' : '') + '</span>';
    }).join('');
  chips.innerHTML = visibleEvents
    .map(event => '<span class="event-chip" tabindex="0" data-date="' + esc(event.anchor_date) + '">' +
      esc(event.anchor_date.slice(5) + ' · ' + event.title) + '</span>')
    .join('');

  const hoverLayer = svg.querySelector('#hover-layer');
  const chartRect = () => svg.getBoundingClientRect();
  const hideHover = () => {
    hoverLayer.setAttribute('visibility', 'hidden');
    hoverLayer.innerHTML = '';
    tooltip.hidden = true;
  };
  const showHover = (date, clientX = null, clientY = null) => {
    const dateRows = selected.filter(row => row.metric_date === date);
    const eventsAtDate = visibleEvents.filter(event => event.anchor_date === date);
    const xx = x(date);
    hoverLayer.innerHTML = '<line x1="' + xx + '" y1="' + top + '" x2="' + xx + '" y2="' + (height - bottom) +
      '" stroke="#909bb0" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke" />' +
      dateRows.map(row => {
        const cohortIndex = payload.cohorts.findIndex(cohort => cohort.cohort_id === row.scope_id);
        return '<circle cx="' + xx + '" cy="' + y(Number(row.value)) + '" r="4" fill="#11141b" stroke="' +
          palette[cohortIndex % palette.length] + '" stroke-width="2" vector-effect="non-scaling-stroke" />';
      }).join('');
    hoverLayer.setAttribute('visibility', 'visible');

    const eventHtml = eventsAtDate.map(event =>
      '<div class="tooltip-event">게임사 이벤트 · ' + esc(event.title) +
      '<div class="tooltip-event-meta">' + esc(anchorLabel(event.anchor_type)) + '</div></div>'
    ).join('');
    const valueHtml = payload.cohorts
      .filter(cohort => enabledCohorts.has(cohort.cohort_id))
      .map(cohort => {
        const cohortIndex = payload.cohorts.findIndex(candidate => candidate.cohort_id === cohort.cohort_id);
        const row = dateRows.find(candidate => candidate.scope_id === cohort.cohort_id);
        return '<div class="tooltip-row"><span class="tooltip-series"><span class="swatch" style="background:' +
          palette[cohortIndex % palette.length] + '"></span>' + esc(cohortName(cohort.cohort_id)) +
          '</span><span class="tooltip-value">' + (row ? esc(pct(row.value)) : '—') + '</span></div>';
      }).join('');
    tooltip.innerHTML = '<div class="tooltip-date">' + esc(date) + '</div>' + eventHtml + valueHtml;
    tooltip.hidden = false;

    const rect = chartRect();
    const fallbackX = rect.left + xx / width * rect.width;
    const anchorX = clientX ?? fallbackX;
    const anchorY = clientY ?? rect.top + 16;
    const localX = anchorX - rect.left;
    const localY = anchorY - rect.top;
    let tooltipLeft = localX + 12;
    if (tooltipLeft + tooltip.offsetWidth > rect.width - 8) {
      tooltipLeft = localX - tooltip.offsetWidth - 12;
    }
    tooltip.style.left = Math.max(8, tooltipLeft) + 'px';
    tooltip.style.top = Math.max(8, Math.min(rect.height - tooltip.offsetHeight - 8, localY + 10)) + 'px';
  };

  svg.onpointermove = event => {
    const rect = chartRect();
    if (!rect.width) return;
    const pointerX = (event.clientX - rect.left) / rect.width * width;
    if (pointerX < left || pointerX > width - right) {
      hideHover();
      return;
    }
    const eventThreshold = 10 / rect.width * width;
    const nearestEvent = visibleEvents
      .map(item => ({ item, distance: Math.abs(x(item.anchor_date) - pointerX) }))
      .sort((a, b) => a.distance - b.distance)[0];
    const date = nearestEvent && nearestEvent.distance <= eventThreshold
      ? nearestEvent.item.anchor_date
      : dates.reduce((best, candidate) =>
          Math.abs(x(candidate) - pointerX) < Math.abs(x(best) - pointerX) ? candidate : best,
        dates[0]);
    showHover(date, event.clientX, event.clientY);
  };
  svg.onpointerleave = hideHover;
  chips.querySelectorAll('.event-chip').forEach(chip => {
    const show = () => showHover(chip.dataset.date);
    chip.addEventListener('mouseenter', show);
    chip.addEventListener('focus', show);
    chip.addEventListener('mouseleave', hideHover);
    chip.addEventListener('blur', hideHover);
  });
}

function maturityLabel(maturity) {
  if (maturity === 'MATURE') return ['이벤트 7일 후까지 관측', 'mature'];
  if (maturity === 'PARTIAL') return ['이벤트 3일 후까지 관측', 'partial'];
  if (maturity === 'EARLY') return ['이벤트 1일 후까지 관측', 'partial'];
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
    esc(item.event.anchor_date + ' · ' + item.event.title + ' · ' + anchorLabel(item.event.anchor_type)) +
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
    tableHost.innerHTML = '<div class="muted">등록된 이벤트가 없다.</div>';
    return;
  }

  const insight = eventInsight(event);
  const label = maturityLabel(insight.maturity);
  const basis = insight.latestOffset == null
    ? '—'
    : insight.latestOffset === 0
      ? '이벤트 당일'
      : insight.latestOffset > 0
        ? '이벤트 ' + insight.latestOffset + '일 후'
        : '이벤트 ' + Math.abs(insight.latestOffset) + '일 전';

  summaryHost.innerHTML =
    '<div class="event-summary">' +
      '<div class="mini"><div class="label">후속 관측</div><div class="value"><span class="badge ' +
        label[1] + '">' + esc(label[0]) + '</span></div></div>' +
      '<div class="mini"><div class="label">현재 비교 시점</div><div class="value">' + esc(basis) + '</div></div>' +
      '<div class="mini"><div class="label">시장보다 더 오르거나 덜 내린 선수군</div><div class="value ' +
        signedClass(insight.strongest?.change) + '">' +
        (insight.strongest ? esc(insight.strongest.name + ' ' + pct(insight.strongest.change)) : '—') +
      '</div></div>' +
      '<div class="mini"><div class="label">시장보다 덜 오르거나 더 내린 선수군</div><div class="value ' +
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
    tableHost.innerHTML = '<div class="muted">시장 전체 표본과 비교할 수 있는 결과가 없다.</div>';
    return;
  }

  const scopes = [...new Set(rows.map(row => row.scope_id))]
    .filter(scopeId => payload.cohorts.find(cohort => cohort.cohort_id === scopeId)?.name !== 'SAMPLE_MARKET');
  const map = new Map(rows.map(row => [row.scope_id + '|' + row.offset_days, row]));

  tableHost.innerHTML =
    '<table><thead><tr><th>선수군</th>' +
      offsets.map(offset => '<th>' + (offset === 0 ? '당일' : offset > 0 ? offset + '일 후' : Math.abs(offset) + '일 전') + '</th>').join('') +
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
    host.innerHTML = '<div class="muted">감지된 급변 날짜가 없다.</div>';
    return;
  }

  const visibleShocks = payload.shocks.filter(shock =>
    payload.cohorts.find(cohort => cohort.cohort_id === shock.scope_id)?.name !== 'SAMPLE_MARKET'
  );
  if (!visibleShocks.length) {
    host.innerHTML = '<div class="muted">감지된 급변 날짜가 없다.</div>';
    return;
  }

  host.innerHTML =
    '<table><thead><tr><th>날짜 / 선수 그룹</th><th>가격 변동</th></tr></thead><tbody>' +
    visibleShocks.map(shock => {
      const context = shockContext(shock);
      let note = '가까운 시점에 등록된 이벤트 없음';
      if (context) {
        const distance = context.distance;
        const timing = distance === 0
          ? '같은 날'
          : distance > 0
            ? '이벤트 ' + distance + '일 후'
            : '이벤트 ' + Math.abs(distance) + '일 전';
        note = timing + ' · ' + context.event.title;
      }
      return '<tr><td><div class="shock">' + esc(shock.metric_date + ' · ' + cohortName(shock.scope_id)) +
        '</div><div class="context">' + esc(note) + '</div></td><td class="' +
        signedClass(shock.value) + '">' + esc(pct(shock.value)) + '</td></tr>';
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
