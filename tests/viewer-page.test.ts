import assert from "node:assert/strict";
import test from "node:test";

import { viewerPage } from "../src/viewer/page.ts";

test("advanced viewer keeps internal data explorable with user-facing labels", () => {
  const html = viewerPage();
  assert.match(html, /고급 지표/);
  assert.match(html, /검증과 세부 확인용/);
  assert.match(html, /시장·선수군 원시 시계열/);
  assert.match(html, /이벤트 전후 원시값/);
  assert.match(html, /급변 감지 결과/);
  assert.match(html, /가격이 오른 선수 비율/);
  assert.doesNotMatch(html, /Shock candidates/);
  assert.doesNotMatch(html, /Event replay/);
});

test("advanced viewer inline script is valid JavaScript", () => {
  const html = viewerPage();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
