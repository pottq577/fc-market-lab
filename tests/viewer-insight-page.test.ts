import assert from "node:assert/strict";
import test from "node:test";

import { insightViewerPage } from "../src/viewer/insight-page.ts";

test("insight viewer uses the verified benchmark for market headlines and trims legacy detail", () => {
  const html = insightViewerPage();
  assert.match(html, /지금 시장은/);
  assert.match(html, /대표 선수/);
  assert.match(html, /최근 7일/);
  assert.match(html, /최근 30일/);
  assert.match(html, /오늘 오른 선수/);
  assert.match(html, /선수 그룹별 흐름/);
  assert.match(html, /평소보다 크게 움직인 날/);
  assert.match(html, /fetch\('\/api\/benchmark'\)/);
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
