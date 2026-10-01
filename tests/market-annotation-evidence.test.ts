import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseMarketAnnotationDocument } from "../src/evidence/market-annotations.ts";

test("ships the verified stage-6 market annotation evidence", async () => {
  const raw = JSON.parse(
    await readFile("data/evidence/market-annotations.json", "utf8"),
  ) as unknown;
  const document = parseMarketAnnotationDocument(raw);

  assert.equal(document.events.length, 5);
  assert.equal(document.products.length, 2);
  assert.equal(
    document.products.reduce((sum, product) => sum + product.rewards.length, 0),
    2,
  );
  assert.equal(document.exposures.length, 0);

  const marketRule = document.events.find(
    (event) => event.event_id === "market-rule-26tots-11-2026-09-10",
  );
  assert.equal(marketRule?.effective_at, "2026-09-10T06:30:00.000Z");
  assert.equal(marketRule?.ended_at, "2026-09-10T15:00:00.000Z");

  const incident = document.events.find(
    (event) => event.event_id === "sss-mortar-sale-suspension-2026-09-17",
  );
  assert.equal(incident?.effective_at, "2026-09-17T03:33:00.000Z");
  assert.equal(incident?.ended_at, "2026-09-17T04:07:00.000Z");

  const lockerRoom = document.events.find(
    (event) => event.event_id === "locker-room-talk-11-2026-09-28",
  );
  assert.equal(lockerRoom?.announced_at, "2026-09-27T15:00:00.000Z");
  assert.match(lockerRoom?.notes ?? "", /게시 시각은 제공하지 않아/);

  const gameplayPatch = document.events.find(
    (event) => event.event_id === "gameplay-balance-2026-09-30",
  );
  assert.equal(gameplayPatch?.effective_at, "2026-09-30T02:15:00.000Z");

  const beforeFix = document.products.find(
    (product) => product.product_id === "sss-mortar-top-price-730-pre-fix",
  );
  assert.equal(beforeFix?.sale_start, "2026-09-17T02:15:00.000Z");
  assert.equal(beforeFix?.sale_end, "2026-09-17T03:33:00.000Z");
  assert.equal(beforeFix?.purchase_limit, null);
  assert.equal(beforeFix?.rewards[0]?.grade_min, 8);
  assert.equal(beforeFix?.rewards[0]?.grade_max, 11);

  const afterFix = document.products.find(
    (product) => product.product_id === "sss-mortar-top-price-730-post-fix",
  );
  assert.equal(afterFix?.sale_start, "2026-09-17T04:07:00.000Z");
  assert.equal(afterFix?.sale_end, "2026-09-17T15:00:00.000Z");
  assert.equal(afterFix?.purchase_limit, 2);
});
