import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findClassMarketAvailability,
  parseClassMarketAvailabilityDocument,
} from "../src/evidence/class-market-availability.ts";

async function readEvidence(): Promise<unknown> {
  return JSON.parse(
    await readFile("data/evidence/class-market-availability.json", "utf8"),
  );
}

test("parses official market-availability evidence for seed classes", async () => {
  const document = parseClassMarketAvailabilityDocument(await readEvidence());

  assert.equal(document.classes.length, 3);
  assert.deepEqual(findClassMarketAvailability(document, "863239231"), {
    spid_prefix: "863",
    class_code: "PTG",
    market_available_on: "2026-05-28",
    source_url:
      "https://fconline.nexon.com/news/notice/view?n4ArticleSN=6018",
    evidence_note: "Official PTG release notice dated 2026-05-28.",
  });
});

test("rejects duplicate class availability prefixes", async () => {
  const value = (await readEvidence()) as { classes: unknown[] };
  value.classes.push(structuredClone(value.classes[0]));

  assert.throws(
    () => parseClassMarketAvailabilityDocument(value),
    /duplicate spid_prefix/,
  );
});
