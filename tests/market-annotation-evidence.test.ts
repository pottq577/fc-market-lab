import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseMarketAnnotationDocument } from "../src/evidence/market-annotations.ts";

test("ships valid default market annotation evidence", async () => {
  const raw = JSON.parse(
    await readFile("data/evidence/market-annotations.json", "utf8"),
  ) as unknown;
  const document = parseMarketAnnotationDocument(raw);

  assert.equal(document.events.length, 1);
  assert.equal(document.products.length, 0);
  assert.equal(document.exposures.length, 0);
  assert.deepEqual(document.events[0], {
    event_id: "sss-mortar-sale-suspension-2026-09-17",
    event_type: "INCIDENT",
    title: "토끼 가족의 SSS 절구 일부 상품 판매 임시 중단",
    announced_at: null,
    effective_at: "2026-09-17T03:33:00.000Z",
    ended_at: "2026-09-17T04:07:00.000Z",
    first_observed_at: "2026-09-17T03:33:00.000Z",
    source_url: "https://fconline.nexon.com/news/notice/view?n4ArticleSN=6274",
    confidence: 1,
    notes:
      "프리미엄 코인 20개 교환 상품의 구매 가능 횟수 오류로 판매가 임시 중단되었고, 구매 제한 2회 적용 후 판매가 재개됨.",
  });
});
