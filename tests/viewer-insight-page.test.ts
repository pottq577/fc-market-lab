import assert from "node:assert/strict";
import test from "node:test";

import { insightViewerPage } from "../src/viewer/insight-page.ts";

test("insight viewer leads with interpretable market changes instead of raw index level", () => {
  const html = insightViewerPage();
  assert.match(html, /지금 이 데이터가 말하는 것/);
  assert.match(html, /시장 7일/);
  assert.match(html, /시장 30일/);
  assert.match(html, /기간 누적 변화/);
  assert.match(html, /후속 관측 부족 · 판단 보류/);
  assert.doesNotMatch(html, /Sample index/);
});

test("insight viewer inline script is valid JavaScript", () => {
  const html = insightViewerPage();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
