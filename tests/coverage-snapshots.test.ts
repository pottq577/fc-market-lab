import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseGate0BCoverageEvidenceDocument } from "../src/evidence/coverage-snapshots.ts";

async function readEvidence(): Promise<unknown> {
  return JSON.parse(
    await readFile("data/evidence/gate-0b-price-coverage.json", "utf8"),
  );
}

test("parses committed Gate 0B coverage evidence for all seed instruments", async () => {
  const document = parseGate0BCoverageEvidenceDocument(await readEvidence());

  assert.equal(document.catalog_id, "sample-market-2026-09-29");
  assert.equal(document.snapshots.length, 20);
  assert.equal(
    document.snapshots.filter((snapshot) => snapshot.class_code === "PTG").length,
    18,
  );
  assert.deepEqual(
    document.snapshots.find((snapshot) => snapshot.spid === "868005589"),
    {
      spid: "868005589",
      grade: 1,
      class_code: "26FSL",
      observed_at: "2026-09-30T05:00:55.260Z",
      raw_sha256:
        "sha256:91d02045d3999e011fc309e033eabe2188add6c8794978af344ee3ae7697451e",
      point_count: 62,
      first_source_date: "2026-07-30",
      last_source_date: "2026-09-29",
      observed_span_days: 61,
      native_granularity: "P1D",
      source_path: "data/evidence/gate-0b-price-coverage.json",
    },
  );
});

test("rejects duplicate committed coverage snapshots", async () => {
  const value = (await readEvidence()) as { snapshots: unknown[] };
  value.snapshots.push(structuredClone(value.snapshots[0]));

  assert.throws(
    () => parseGate0BCoverageEvidenceDocument(value),
    /duplicate coverage snapshot/,
  );
});
