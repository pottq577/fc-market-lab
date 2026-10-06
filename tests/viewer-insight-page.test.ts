import assert from "node:assert/strict";
import test from "node:test";

import { insightViewerPage } from "../src/viewer/insight-page.ts";

test("insight viewer uses verified headlines and exposes actual price evidence", () => {
  const html = insightViewerPage();
  assert.match(html, /지금 시장은/);
  assert.match(html, /대표 선수/);
  assert.match(html, /최근 7일/);
  assert.match(html, /최근 30일/);
  assert.match(html, /오늘 오른 선수/);
  assert.match(html, /인기 선수 실제 시세 흐름/);
  assert.match(html, /평소보다 크게 움직인 날/);
  assert.match(html, /fetch\('\/api\/benchmark'\)/);
  assert.match(html, /chart-tooltip/);
  assert.match(html, /niceChartScale/);
  assert.match(html, /chartMode = 'PRICE'/);
  assert.match(html, /price_stats/);
  assert.match(html, /실제 중앙 시세/);
  assert.match(html, /실제 카드 표본/);
  assert.match(html, /BP 화폐 단위 조정/);
  assert.match(html, /1억:1 조정 후 제공한 새 BP 단위/);
  assert.match(html, /onpointermove/);
  assert.match(html, /데이터가 끊기면 새 구간을 0%에서 다시 시작/);
  assert.doesNotMatch(html, /고급 지표/);
  assert.doesNotMatch(html, /legacy=1/);
  assert.doesNotMatch(html, /이 화면의 용어 보기/);
  assert.doesNotMatch(html, /이벤트 전후 반응/);
  assert.doesNotMatch(html, /시장 대비 초과 변동/);
  assert.doesNotMatch(html, /<th>이상도<\/th>/);
});

test("insight viewer inline script is valid JavaScript", () => {
  const html = insightViewerPage();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
