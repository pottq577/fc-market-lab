export function benchmarkViewerPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FC Market Lab · 시장 대표지표</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0b0d12; color:#edf0f7; }
    * { box-sizing:border-box; }
    body { margin:0; background:#0b0d12; }
    main { width:min(1320px, calc(100% - 32px)); margin:0 auto; padding:24px 0 56px; }
    a { color:inherit; text-decoration:none; }
    header { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; margin-bottom:18px; }
    h1 { margin:0 0 6px; font-size:27px; letter-spacing:-.035em; }
    h2 { margin:0 0 7px; font-size:18px; letter-spacing:-.015em; }
    p { margin:0; color:#9299aa; font-size:13px; line-height:1.6; }
    .eyebrow { color:#73809a; font-size:11px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; margin-bottom:5px; }
    .nav { display:flex; flex-wrap:wrap; gap:6px; }
    .nav a { padding:7px 10px; border:1px solid #293142; border-radius:8px; color:#98a2b7; font-size:12px; }
    .nav a.active { color:#edf0f7; background:#171c26; border-color:#3b465b; }
    .panel { background:#11141b; border:1px solid #222733; border-radius:12px; padding:17px; margin-top:14px; }
    .status { border-left:3px solid #7aa2f7; }
    .status.unstable { border-left-color:#e0af68; background:#17150f; }
    .status.stable { border-left-color:#66d09b; background:#0f1714; }
    .status-title { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-weight:700; }
    .badge { display:inline-flex; align-items:center; padding:4px 8px; border-radius:999px; font-size:11px; font-weight:700; }
    .badge.unstable { background:#302916; color:#e6c76a; }
    .badge.stable { background:#153025; color:#75d6a4; }
    .badge.pass { background:#153025; color:#75d6a4; }
    .badge.fail { background:#351e22; color:#f09a9e; }
    .badge.hold { background:#302916; color:#e6c76a; }
    .meaning { margin-top:9px; color:#d0d5df; font-size:14px; line-height:1.7; }
    .cards { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; margin-top:14px; }
    .card { background:#11141b; border:1px solid #222733; border-radius:12px; padding:14px 15px; min-height:132px; }
    .label { color:#7f8799; font-size:11px; letter-spacing:.02em; }
    .value { margin-top:8px; font-size:21px; font-variant-numeric:tabular-nums; }
    .sub { margin-top:6px; color:#8a93a5; font-size:11px; line-height:1.5; }
    .why { margin-top:8px; color:#b5bdcb; font-size:12px; line-height:1.45; }
    .positive { color:#66d09b; }
    .negative { color:#f07878; }
    .meta { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin-top:12px; }
    .mini { padding:11px 12px; background:#0d1016; border:1px solid #202632; border-radius:8px; }
    .mini strong { display:block; margin-top:5px; font-size:13px; word-break:break-word; }
    .mini .sub { margin-top:4px; }
    .section-lead { max-width:900px; }
    .table-wrap { overflow:auto; margin-top:12px; }
    table { width:100%; border-collapse:collapse; font-size:12px; min-width:900px; }
    th, td { padding:9px 10px; border-bottom:1px solid #252a35; text-align:right; font-variant-numeric:tabular-nums; vertical-align:top; }
    th:first-child, td:first-child { text-align:left; }
    th:last-child, td:last-child { text-align:left; }
    th { color:#848c9e; font-weight:600; white-space:nowrap; }
    td { color:#d6dae5; }
    .warning { margin-top:11px; padding:11px 12px; border:1px solid #4d4324; border-radius:8px; color:#d9c27b; font-size:12px; line-height:1.55; }
    details { margin-top:12px; border-top:1px solid #252a35; padding-top:12px; }
    summary { cursor:pointer; color:#aab3c3; font-size:12px; }
    .tech-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-top:10px; }
    .tech { padding:9px 10px; background:#0d1016; border-radius:7px; color:#80899b; font-size:11px; line-height:1.5; word-break:break-all; }
    .error { white-space:pre-wrap; color:#ffb3b7; }
    @media (max-width:980px) { .cards { grid-template-columns:repeat(2,minmax(0,1fr)); } .meta { grid-template-columns:repeat(2,minmax(0,1fr)); } header { flex-direction:column; } .nav { width:100%; } }
    @media (max-width:600px) { main { width:min(100% - 20px, 1320px); } .cards,.meta,.tech-grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="eyebrow">FC온라인 이적시장</div>
      <h1>시장 대표지표</h1>
      <p>많이 쓰이는 선수들을 대표 표본으로 묶어, 전체 시장이 얼마나 움직였는지와 그 값이 얼마나 안정적인지 보여준다.</p>
    </div>
    <nav class="nav" aria-label="화면 이동">
      <a href="/">시장 인사이트</a>
      <a class="active" href="/benchmark">시장 대표지표</a>
      <a href="/?legacy=1">고급 지표</a>
    </nav>
  </header>
  <div id="app"><div class="panel">시장 대표지표를 불러오는 중…</div></div>
</main>
<script>
function esc(value) { return String(value ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
function pct(value) { if (value == null || Number.isNaN(Number(value))) return '—'; const n=Number(value)*100; return (n>0?'+':'')+n.toFixed(2)+'%'; }
function plainPct(value) { if (value == null || Number.isNaN(Number(value))) return '—'; return (Number(value)*100).toFixed(1)+'%'; }
function pp(value) { if (value == null || Number.isNaN(Number(value))) return '—'; return (Number(value)*100).toFixed(2)+'%p'; }
function num(value) { return value == null || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(2); }
function signed(value) { return Number(value)>0?'positive':Number(value)<0?'negative':''; }
function metric(data, name) { return data.latest_metrics.find(item => item.metric_name === name) ?? null; }
function statusLabel(status) {
  if (status === 'PASS') return ['통과','pass'];
  if (status === 'FAIL') return ['실패','fail'];
  return ['판단 보류','hold'];
}
function displayRoleLabel(role) {
  return role === 'SELECTED_PRODUCTION' ? '대표 표본으로 채택됨' : '진단용 최대 표본';
}
function periodLabel(period) {
  if (period === 'CONTEMPORANEOUS') return '당시 구성 기준';
  if (period === 'FIXED_PANEL_BACKCAST') return '현재 표본으로 과거 재계산';
  return '결과 없음';
}
function aggregationLabel(value) {
  if (value === 'WEIGHTED_MEAN_PLAYER_RETURN') return '시장 규모 가중 평균';
  if (value === 'WEIGHTED_MEDIAN_PLAYER_RETURN') return '시장 규모 가중 중앙값';
  return value;
}
function uncertainty(row, formatter) {
  if (!row) return '표시할 데이터가 없음';
  if (row.uncertainty_status !== 'OK' || row.lower_value == null || row.upper_value == null) {
    return '불확실성 범위를 계산하지 못함';
  }
  return '95% 추정 범위 ' + formatter(row.lower_value) + ' ~ ' + formatter(row.upper_value);
}
function coverage(row) {
  if (!row) return '';
  return '데이터 반영률 ' + plainPct(row.weighted_coverage) + ' · ' + row.valid_count + '/' + row.total_count + '명';
}
function card(label, value, row, formatter, why, signedValue = null) {
  return '<div class="card"><div class="label">'+esc(label)+'</div><div class="value '+(signedValue==null?'':signed(signedValue))+'">'+esc(value)+'</div><div class="why">'+esc(why)+'</div><div class="sub">'+uncertainty(row, formatter)+'<br>'+coverage(row)+'</div></div>';
}
function reasonLabel(reason) {
  const labels = {
    DIRECTION_COMPARABLE_DAYS: '가격 방향을 비교할 수 있는 날이 부족함',
    RETURN_COMMON_VALID_DAYS: '두 표본에 공통으로 유효한 수익률 날짜가 부족함',
    BREADTH_COMMON_VALID_DAYS: '두 표본에 공통으로 유효한 상승 비율 날짜가 부족함',
    RETURN_MEDIAN_ABS_DIFF: '일반적인 가격 변동률 차이가 허용 범위를 넘음',
    RETURN_P95_ABS_DIFF: '큰 가격 변동률 차이가 허용 범위를 넘음',
    RETURN_DIRECTION_MATCH_RATIO: '상승·하락 방향 일치율이 기준보다 낮음',
    BREADTH_MEDIAN_ABS_DIFF: '상승 선수 비율 차이가 허용 범위를 넘음'
  };
  return labels[reason] ?? reason;
}
function meaning(data) {
  if (data.benchmark_status === 'STABLE') {
    return '<strong>'+esc(data.display_panel_size)+'명 대표 표본을 시장 대표값으로 사용할 수 있다.</strong> 표본 규모를 더 키워도 주요 결과가 충분히 비슷하게 유지되는 구간이 확인됐다.';
  }
  const directionOnly = data.convergence_pairs.length > 0 && data.convergence_pairs.every(pair => pair.reasons.includes('DIRECTION_COMPARABLE_DAYS'));
  if (directionOnly) {
    return '표본 크기에 따른 값 차이는 작지만 상승·하락 방향을 검증할 날짜가 부족하다. 현재 '+esc(data.display_panel_size)+'명 표본은 <strong>진단용</strong>으로만 보고 시장 대표값 확정을 보류한다.';
  }
  return '표본 크기를 바꿨을 때 결과가 충분히 안정적으로 유지되지 않았다. 현재 '+esc(data.display_panel_size)+'명 표본은 <strong>진단용</strong>이며 시장 대표값으로 사용하지 않는다.';
}
function pairRows(data) {
  return data.convergence_pairs.map(pair => {
    const status=statusLabel(pair.status);
    return '<tr><td>'+esc(pair.smaller_panel_size+'명 → '+pair.larger_panel_size+'명')+'</td><td><span class="badge '+status[1]+'">'+status[0]+'</span></td><td>'+pair.common_valid_return_days+'일</td><td>'+pair.direction_compared_days+'일</td><td>'+pp(pair.return_median_abs_diff)+'</td><td>'+pp(pair.return_p95_abs_diff)+'</td><td>'+plainPct(pair.return_direction_match_ratio)+'</td><td>'+pp(pair.breadth_median_abs_diff)+'</td><td>'+esc(pair.reasons.map(reasonLabel).join(' · ') || '모든 기준 충족')+'</td></tr>';
  }).join('');
}
function render(data) {
  if (!data) {
    document.querySelector('#app').innerHTML='<div class="panel error">아직 계산된 시장 대표지표가 없다. 먼저 시장 대표지표 분석을 실행해야 한다.</div>';
    return;
  }
  const ret=metric(data,'RETURN_1D');
  const index=metric(data,'INDEX');
  const breadth=metric(data,'BREADTH');
  const iqr=metric(data,'IQR');
  const mad=metric(data,'MAD');
  const period=ret?.period_type ?? 'NO_RESULT';
  const stable=data.benchmark_status==='STABLE';
  document.querySelector('#app').innerHTML=
    '<section class="panel status '+(stable?'stable':'unstable')+'"><div class="status-title"><span class="badge '+(stable?'stable':'unstable')+'">'+(stable?'대표값 사용 가능':'대표값 확정 전')+'</span><span>'+(stable?'현재 시장 대표지표를 읽어도 된다':'현재 값은 진단용으로 봐야 한다')+'</span></div><div class="meaning">'+meaning(data)+'</div>'+
    '<div class="sub" style="margin-top:9px">데이터 기준일 '+esc(data.latest_metric_date ?? '—')+' · '+esc(periodLabel(period))+' · '+esc(displayRoleLabel(data.display_role))+'</div>'+
    (period==='FIXED_PANEL_BACKCAST'?'<div class="warning">과거 구간은 현재 선정된 대표 선수들을 기준으로 다시 계산했다. 당시 시장에서 인기 있던 선수 구성이 그대로 반영된 시계열은 아니다.</div>':'')+'</section>'+
    '<section class="cards">'+
      card('오늘 시장 변동',pct(ret?.point_value),ret,pct,'대표 선수들의 하루 가격 변동을 하나의 값으로 요약',ret?.point_value)+
      card('시장 지수',num(index?.point_value),index,num,'기준시점 100에서 시장 가격 수준이 얼마나 변했는지 표시')+
      card('가격이 오른 선수 비율',plainPct(breadth?.point_value),breadth,plainPct,'대표 표본 중 전일보다 가격이 오른 선수의 비중')+
      card('중간 50% 변동폭',pp(iqr?.point_value),iqr,pp,'선수별 가격 변동이 서로 얼마나 퍼져 있는지 확인')+
      card('일반적 편차',pp(mad?.point_value),mad,pp,'극단값 영향을 줄여 본 선수별 변동의 전형적인 차이')+
    '</section>'+
    '<section class="panel"><h2>이 값은 얼마나 믿을 만한가</h2><p class="section-lead">대표 표본의 크기, 실제 가격이 잡힌 선수 비율, 표본 규모를 바꿨을 때 결과가 유지되는지를 함께 확인한다.</p><div class="meta">'+
      '<div class="mini"><div class="label">현재 대표 표본</div><strong>'+data.display_panel_size+'명</strong><div class="sub">'+esc(displayRoleLabel(data.display_role))+'</div></div>'+
      '<div class="mini"><div class="label">가격 관측 가능 선수</div><strong>'+data.price_eligible_player_count+'명</strong><div class="sub">전체 후보군 중 가격 이력을 계산할 수 있는 선수</div></div>'+
      '<div class="mini"><div class="label">최신 지표 반영률</div><strong>'+plainPct(ret?.weighted_coverage)+'</strong><div class="sub">'+(ret?ret.valid_count+'/'+ret.total_count+'명 반영':'데이터 없음')+'</div></div>'+
      '<div class="mini"><div class="label">계산 방식</div><strong>'+esc(aggregationLabel(data.return_aggregation))+'</strong><div class="sub">선수별 시장 규모를 반영해 하루 변동을 합산</div></div>'+
    '</div>'+
    '<details><summary>기술 정보 보기</summary><div class="tech-grid">'+
      '<div class="tech">분석 버전: '+esc(data.analysis_version ?? '미게시')+'<br>지표 버전: '+esc(data.metric_version)+'</div>'+
      '<div class="tech">표본: '+esc(data.display_panel_label)+' / '+esc(data.panel_version)+'<br>유효 시작일: '+esc(data.effective_from)+'</div>'+
      '<div class="tech">후보군 기준일: '+esc(data.universe_as_of)+'<br>분석 마감: '+esc(data.analysis_cutoff)+'</div>'+
      '<div class="tech">수렴 버전: '+esc(data.convergence_version)+'<br>게시 상태: '+(data.published?'게시됨':'미게시')+'</div>'+
    '</div></details></section>'+
    '<section class="panel"><h2>표본을 더 늘려도 같은 결론이 나오는가</h2><p class="section-lead">인접한 표본 규모끼리 비교한다. 차이가 작고 상승·하락 방향도 비슷하면 통과한다. 이 표는 대표 표본을 몇 명으로 잡아도 결과가 흔들리지 않는지 보여준다.</p><div class="table-wrap"><table><thead><tr><th>표본 비교</th><th>결과</th><th>둘 다 계산된 날</th><th>상승·하락 비교일</th><th>보통 차이</th><th>큰 차이</th><th>방향 일치</th><th>상승비율 차이</th><th>해석</th></tr></thead><tbody>'+pairRows(data)+'</tbody></table></div></section>';
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
