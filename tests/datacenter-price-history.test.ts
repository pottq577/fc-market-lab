import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDatacenterPriceCaptureEvidence,
  inferNativeGranularity,
  parseDatacenterPriceGraph,
} from "../src/evidence/datacenter-price-history.ts";

const fixturePath = "tests/fixtures/datacenter-player-price-graph.html";

test("parses timestamped market-reference price points from a saved graph response", async () => {
  const raw = await readFile(fixturePath, "utf8");
  const points = parseDatacenterPriceGraph(raw);

  assert.deepEqual(points, [
    { source_timestamp_ms: 1790262000000, value: 1000000 },
    { source_timestamp_ms: 1790348400000, value: 1100000 },
    { source_timestamp_ms: 1790521200000, value: 1050000 },
    { source_timestamp_ms: 1790607600000, value: 1200000 },
  ]);
});

test("infers the native cadence even when one daily observation is missing", async () => {
  const raw = await readFile(fixturePath, "utf8");
  const points = parseDatacenterPriceGraph(raw);

  assert.equal(inferNativeGranularity(points), "P1D");
});

test("builds deterministic Gate evidence from the saved raw response", async () => {
  const raw = await readFile(fixturePath, "utf8");
  const evidence = buildDatacenterPriceCaptureEvidence({
    raw,
    spid: "851224371",
    grade: 1,
    observed_at: "2026-09-29T16:20:00+09:00",
  });

  assert.equal(evidence.source_id, "fconline-datacenter-price-history");
  assert.equal(evidence.native_granularity, "P1D");
  assert.equal(evidence.point_count, 4);
  assert.equal(evidence.observed_span_days, 4);
  assert.match(evidence.raw_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(evidence.gate_update, {
    native_granularity: "P1D",
    history_span: "4D_OBSERVED",
    evidence_hash: evidence.raw_sha256,
  });
});

test("rejects responses without chartData", () => {
  assert.throws(
    () => parseDatacenterPriceGraph("<html></html>"),
    /does not contain a JSON chartData assignment/,
  );
});

test("rejects duplicate source timestamps", () => {
  const raw = `
    <script>
    var chartData = {"datasets":[{"data":[
      {"x":1790262000000,"y":1000},
      {"x":1790262000000,"y":1100}
    ]}]};
    </script>
  `;

  assert.throws(
    () => parseDatacenterPriceGraph(raw),
    /duplicate timestamp/,
  );
});
