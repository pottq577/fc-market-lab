export function benchmarkViewerPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FC Market Lab · Broad Market</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0b0d12; color:#edf0f7; }
    * { box-sizing:border-box; }
    body { margin:0; background:#0b0d12; }
    main { width:min(1320px, calc(100% - 32px)); margin:0 auto; padding:28px 0 56px; }
    a { color:#8fb6ff; text-decoration:none; }
    header { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; margin-bottom:16px; }
    h1 { margin:0 0 6px; font-size:26px; letter-spacing:-.03em; }
    h2 { margin:0 0 10px; font-size:17px; }
    p { margin:0; color:#9299aa; font-size:13px; line-height:1.55; }
    .panel { background:#11141b; border:1px solid #222733; border-radius:12px; padding:16px; margin-top:14px; }
    .status { border-left:3px solid #7aa2f7; }
    .status.unstable { border-left-color:#e0af68; background:#17150f; }
    .status.stable { border-left-color:#66d09b; background:#0f1714; }
    .status-title { display:flex; align-items:center; gap:8px; font-weight:700; }
    .badge { display:inline-flex; padding:4px 8px; border-radius:999px; font-size:11px; }
    .badge.unstable { background:#302916; color:#e6c76a; }
    .badge.stable { background:#153025; color:#75d6a4; }
    .meaning { margin-top:9px; color:#c6ccda; font-size:14px; line-height:1.65; }
    .cards { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; margin-top:14px; }
    .card { background:#11141b; border:1px solid #222733; border-radius:12px; padding:14px 15px; min-height:112px; }
    .label { color:#7f8799; font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
    .value { margin-top:8px; font-size:20px; font-variant-numeric:tabular-nums; }
    .sub { margin-top:6px; color:#8a93a5; font-size:11px; line-height:1.45; }
    .positive { color:#66d09b; }
    .negative { color:#f07878; }
    .meta { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
    .mini { padding:11px 12px; background:#0d1016; border:1px solid #202632; border-radius:8px; }
    .mini strong { display:block; margin-top:5px; font-size:13px; word-break:break-all; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th, td { padding:8px 9px; border-bottom:1px solid #252a35; text-align:right; font-variant-numeric:tabular-nums; }
    th:first-child, td:first-child { text-align:left; }
    th { color:#848c9e; font-weight:600; }
    td { color:#d6dae5; }
    .warning { margin-top:10px; padding:10px 12px; border:1px solid #4d4324; border-radius:8px; color:#d9c27b; font-size:12px; line-height:1.5; }
    .error { white-space:pre-wrap; color:#ffb3b7; }
    @media (max-width:980px) { .cards { grid-template-columns:repeat(2,minmax(0,1fr)); } .meta { grid-template-columns:repeat(2,minmax(0,1fr)); } header { flex-direction:column; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>BROAD_MARKET benchmark</h1>
      <p>가중 시장 지표, 불확실성, 패널 수렴 상태를 한 화면에서 확인한다.</p>
    </div>
    <a href="/">PoC insight viewer로 돌아가기</a>
  </header>
  <div id="app"><div class="panel">benchmark 데이터를 불러오는 중…</div></div>
</main>
<script>
function esc(value) { return String(value ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
function pct(value) { if (value == null || Number.isNaN(Number(value))) return '—'; const n=Number(value)*100; return (n>0?'+':'')+n.toFixed(2)+'%'; }
function num(value) { return value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(4); }
function signed(value) { return Number(value)>0?'positive':Number(value)<0?'negative':''; }
function metric(data, name) { return data.latest_metrics.find(item => item.metric_name === name) ?? null; }
function ci(row, formatter) {
  if (!row) return '데이터 없음';
  if (row.uncertainty_status !== 'OK' || row.lower_value == null || row.upper_value == null) {
    return '95% CI 없음 · ' + esc(row.uncertainty_status ?? 'NO_UNCERTAINTY');
  }
  return '95% CI ' + formatter(row.lower_value) + ' ~ ' + formatter(row.upper_value);
}
function coverage(row) {
  if (!row) return '';
  return 'coverage ' + pct(row.weighted_coverage) + ' · valid ' + row.valid_count + '/' + row.total_count;
}
function card(label, value, row, formatter) {
  return '<div class="card"><div class="label">'+esc(label)+'</div><div class="value '+(row?signed(row.point_value):'')+'">'+esc(value)+'</div><div class="sub">'+ci(row, formatter)+'<br>'+coverage(row)+'</div></div>';
}
function reasonLabel(reason) {
  const labels = {
    DIRECTION_COMPARABLE_DAYS: '0이 아닌 수익률 방향 비교일 부족',
    RETURN_COMMON_VALID_DAYS: '공통 수익률 유효일 부족',
    BREADTH_COMMON_VALID_DAYS: '공통 breadth 유효일 부족',
    RETURN_MEDIAN_ABS_DIFF: '수익률 중앙 절대차 초과',
    RETURN_P95_ABS_DIFF: '수익률 P95 절대차 초과',
    RETURN_DIRECTION_MATCH_RATIO: '수익률 방향 일치율 미달',
    BREADTH_MEDIAN_ABS_DIFF: 'breadth 중앙 절대차 초과'
  };
  return labels[reason] ?? reason;
}
function meaning(data) {
  if (data.benchmark_status === 'STABLE') {
    return '인접 패널 수렴 기준을 통과했다. <strong>'+esc(data.display_panel_label)+'</strong>을 production candidate로 사용할 수 있다.';
  }
  const directionOnly = data.convergence_pairs.length > 0 && data.convergence_pairs.every(pair => pair.reasons.includes('DIRECTION_COMPARABLE_DAYS'));
  if (directionOnly) {
    return '패널 크기를 늘려도 점 추정치 차이는 작지만, 0이 아닌 일간 수익률이 없어 방향 일치율을 검증할 수 없다. <strong>'+esc(data.display_panel_label)+'</strong>은 진단용이며 현재 BROAD_MARKET 대표 패널로 확정하지 않는다.';
  }
  return '수렴 기준을 충족하지 못했다. <strong>'+esc(data.display_panel_label)+'</strong>은 진단용이며 BROAD_MARKET 대표값으로 확정하지 않는다.';
}
function pairRows(data) {
  return data.convergence_pairs.map(pair => '<tr><td>'+esc(pair.smaller_panel_label+' ↔ '+pair.larger_panel_label)+'</td><td>'+esc(pair.status)+'</td><td>'+pair.common_valid_return_days+'</td><td>'+pair.direction_compared_days+'</td><td>'+pct(pair.return_median_abs_diff)+'</td><td>'+pct(pair.return_p95_abs_diff)+'</td><td>'+pct(pair.return_direction_match_ratio)+'</td><td>'+pct(pair.breadth_median_abs_diff)+'</td><td>'+esc(pair.reasons.map(reasonLabel).join(', ') || '—')+'</td></tr>').join('');
}
function render(data) {
  if (!data) {
    document.querySelector('#app').innerHTML='<div class="panel error">실행된 benchmark convergence가 없습니다.</div>';
    return;
  }
  const ret=metric(data,'RETURN_1D');
  const index=metric(data,'INDEX');
  const breadth=metric(data,'BREADTH');
  const iqr=metric(data,'IQR');
  const mad=metric(data,'MAD');
  const period=ret?.period_type ?? 'NO_RESULT';
  document.querySelector('#app').innerHTML=
    '<section class="panel status '+(data.benchmark_status==='STABLE'?'stable':'unstable')+'"><div class="status-title"><span class="badge '+(data.benchmark_status==='STABLE'?'stable':'unstable')+'">'+esc(data.benchmark_status)+'</span><span>그래서 지금 이 benchmark를 어떻게 봐야 하나</span></div><div class="meaning">'+meaning(data)+'</div>'+
    (period==='FIXED_PANEL_BACKCAST'?'<div class="warning">현재 최신 표시값은 FIXED_PANEL_BACKCAST다. 현재 선정된 패널의 과거 움직임을 재생한 값이며, 당시 전체 FC온라인 시장을 대표했다는 뜻이 아니다.</div>':'')+'</section>'+
    '<section class="cards">'+
      card('1일 return',pct(ret?.point_value),ret,pct)+
      card('index',num(index?.point_value),index,num)+
      card('상승 breadth',pct(breadth?.point_value),breadth,pct)+
      card('dispersion IQR',pct(iqr?.point_value),iqr,pct)+
      card('dispersion MAD',pct(mad?.point_value),mad,pct)+
    '</section>'+
    '<section class="panel"><h2>표본과 provenance</h2><div class="meta">'+
      '<div class="mini"><div class="label">표시 패널</div><strong>'+esc(data.display_panel_label)+' · '+data.display_panel_size+'명</strong><div class="sub">'+esc(data.display_role)+'</div></div>'+
      '<div class="mini"><div class="label">가격 관측 가능 모집단</div><strong>'+data.price_eligible_player_count+'명</strong><div class="sub">universe as-of '+esc(data.universe_as_of)+'</div></div>'+
      '<div class="mini"><div class="label">panel version</div><strong>'+esc(data.panel_version)+'</strong><div class="sub">effective from '+esc(data.effective_from)+'</div></div>'+
      '<div class="mini"><div class="label">latest metric</div><strong>'+esc(data.latest_metric_date ?? '—')+'</strong><div class="sub">'+esc(period)+' · '+(data.published?'published':'not published')+'</div></div>'+
    '</div></section>'+
    '<section class="panel"><h2>Nested panel convergence</h2><p>PASS가 아닌 pair가 있으면 대표 패널을 확정하지 않는다.</p><div style="overflow:auto;margin-top:10px"><table><thead><tr><th>pair</th><th>status</th><th>valid days</th><th>direction days</th><th>return median Δ</th><th>return P95 Δ</th><th>direction match</th><th>breadth median Δ</th><th>reason</th></tr></thead><tbody>'+pairRows(data)+'</tbody></table></div></section>';
}
fetch('/api/benchmark').then(async response => {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}).then(render).catch(error => {
  document.querySelector('#app').innerHTML='<div class="panel error">'+esc(error?.stack ?? error)+'</div>';
});
</script>
</body>
</html>`;
}
