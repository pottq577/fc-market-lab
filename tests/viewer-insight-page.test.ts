import assert from "node:assert/strict";
import test from "node:test";

import { insightViewerPage } from "../src/viewer/insight-page.ts";

test("insight viewer leads with plain-language market interpretation", () => {
  const html = insightViewerPage();
  assert.match(html, /현재 시장 요약/);
  assert.match(html, /최근 7일 시장/);
  assert.match(html, /최근 30일 시장/);
  assert.match(html, /선수군별 가격 흐름/);
  assert.match(html, /이벤트 전후 반응/);
  assert.match(html, /평소보다 크게 움직인 날/);
  assert.match(html, /가격이 오른 선수 비율/);
  assert.match(html, /시장 전체 표본/);
  assert.doesNotMatch(html, /Cohort 움직임 비교/);
  assert.doesNotMatch(html, /상승 breadth/);
  assert.doesNotMatch(html, /Shock candidate/);
});

test("insight viewer inline script is valid JavaScript", () => {
  const html = insightViewerPage();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
