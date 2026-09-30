import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDatacenterPriceCaptureEvidence,
  inferNativeGranularity,
  parseDatacenterPriceGraph,
} from "../src/evidence/datacenter-price-history.ts";

const fixturePath = "tests/fixtures/datacenter-player-price-graph.html";
const json1FixturePath =
  "tests/fixtures/datacenter-player-price-graph-json1.html";

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

test("parses the official json1 time/value format with trailing commas", async () => {
  const raw = await readFile(json1FixturePath, "utf8");
  const points = parseDatacenterPriceGraph(raw, "2026-01-03T09:00:00+09:00");

  assert.deepEqual(points, [
    { source_timestamp_ms: Date.UTC(2025, 11, 30), value: 1000000 },
    { source_timestamp_ms: Date.UTC(2025, 11, 31), value: 1100000 },
    { source_timestamp_ms: Date.UTC(2026, 0, 1), value: 1050000 },
    { source_timestamp_ms: Date.UTC(2026, 0, 2), value: 1200000 },
  ]);
});

test("infers the native cadence even when one daily observation is missing", async () => {
  const raw = await readFile(fixturePath, "utf8");
  const points = parseDatacenterPriceGraph(raw);

  assert.equal(inferNativeGranularity(points), "P1D");
});

test("builds deterministic Gate evidence from the timestamped response", async () => {
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
    history_span: "4_POINTS_4D_SPAN",
    evidence_hash: evidence.raw_sha256,
  });
});

test("builds deterministic Gate evidence from the official json1 response shape", async () => {
  const raw = await readFile(json1FixturePath, "utf8");
  const evidence = buildDatacenterPriceCaptureEvidence({
    raw,
    spid: "851224371",
    grade: 1,
    observed_at: "2026-01-03T09:00:00+09:00",
  });

  assert.equal(evidence.point_count, 4);
  assert.equal(evidence.first_source_date, "2025-12-30");
  assert.equal(evidence.last_source_date, "2026-01-02");
  assert.equal(evidence.observed_span_days, 3);
  assert.equal(evidence.native_granularity, "P1D");
  assert.equal(evidence.gate_update.history_span, "4_POINTS_3D_SPAN");
});

test("requires observed_at when json1 only provides month/day labels", async () => {
  const raw = await readFile(json1FixturePath, "utf8");

  assert.throws(
    () => parseDatacenterPriceGraph(raw),
    /observed_at is required/,
  );
});

test("rejects responses without supported graph assignments", () => {
  assert.throws(
    () => parseDatacenterPriceGraph("<html></html>"),
    /supported price graph assignment/,
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

  assert.throws(() => parseDatacenterPriceGraph(raw), /duplicate timestamp/);
});

test("extracts json1 arrays when the assignment contains non-JSON JavaScript", () => {
  const raw = `
    <script>
    var json1 = {
      time: ["12.30", "12.31", "1.01", "1.02",],
      value: ["1000000", "1100000", "1050000", "1200000",],
      formatter: function (value) { return value; },
    };
    </script>
  `;

  const points = parseDatacenterPriceGraph(raw, "2026-01-03T09:00:00+09:00");
  assert.deepEqual(points, [
    { source_timestamp_ms: Date.UTC(2025, 11, 30), value: 1000000 },
    { source_timestamp_ms: Date.UTC(2025, 11, 31), value: 1100000 },
    { source_timestamp_ms: Date.UTC(2026, 0, 1), value: 1050000 },
    { source_timestamp_ms: Date.UTC(2026, 0, 2), value: 1200000 },
  ]);
});

test("parses live legacy chartData with unquoted time/value keys", () => {
  const raw = `
    <script>
    var chartData = {
      time: ["12.30", "12.31", "1.01", "1.02",],
      value: ["1000000", "1100000", "1050000", "1200000",],
    };
    </script>
  `;

  const points = parseDatacenterPriceGraph(raw, "2026-01-03T09:00:00+09:00");
  assert.deepEqual(points, [
    { source_timestamp_ms: Date.UTC(2025, 11, 30), value: 1000000 },
    { source_timestamp_ms: Date.UTC(2025, 11, 31), value: 1100000 },
    { source_timestamp_ms: Date.UTC(2026, 0, 1), value: 1050000 },
    { source_timestamp_ms: Date.UTC(2026, 0, 2), value: 1200000 },
  ]);
});

test("parses legacy chartData timestamp strings", () => {
  const raw = `
    <script>
    var chartData = {
      time: [
        "new Date(1790262000000)",
        "new Date(1790348400000)",
        "new Date(1790521200000)",
      ],
      value: ["1000000", "1100000", "1050000"],
    };
    </script>
  `;

  assert.deepEqual(parseDatacenterPriceGraph(raw), [
    { source_timestamp_ms: 1790262000000, value: 1000000 },
    { source_timestamp_ms: 1790348400000, value: 1100000 },
    { source_timestamp_ms: 1790521200000, value: 1050000 },
  ]);
});

test("parses timestamped chartData with unquoted known keys", () => {
  const raw = `
    <script>
    var chartData = {
      datasets: [{
        data: [
          {x: 1790262000000, y: 1000000},
          {x: 1790348400000, y: 1100000},
        ],
      }],
    };
    </script>
  `;

  assert.deepEqual(parseDatacenterPriceGraph(raw), [
    { source_timestamp_ms: 1790262000000, value: 1000000 },
    { source_timestamp_ms: 1790348400000, value: 1100000 },
  ]);
});

test("parses mixed legacy chartData date labels and Date(timestamp) entries", () => {
  const october2 = Date.UTC(2025, 9, 2);
  const raw = `
    <script>
    var chartData = {
      time: ["9.30", "10.01", "Date(${october2})", "10.03"],
      value: ["1000000", "1100000", "1050000", "1200000"],
    };
    </script>
  `;

  assert.deepEqual(
    parseDatacenterPriceGraph(raw, "2025-10-04T09:00:00+09:00"),
    [
      { source_timestamp_ms: Date.UTC(2025, 8, 30), value: 1000000 },
      { source_timestamp_ms: Date.UTC(2025, 9, 1), value: 1100000 },
      { source_timestamp_ms: october2, value: 1050000 },
      { source_timestamp_ms: Date.UTC(2025, 9, 3), value: 1200000 },
    ],
  );
});

test("parses mixed legacy chartData with new Date and plain timestamp entries", () => {
  const september30 = Date.UTC(2025, 8, 30);
  const october1 = Date.UTC(2025, 9, 1);
  const raw = `
    <script>
    var chartData = {
      time: ["${september30}", "new Date(${october1})", "10.02", "10.03"],
      value: ["1000000", "1100000", "1050000", "1200000"],
    };
    </script>
  `;

  assert.deepEqual(
    parseDatacenterPriceGraph(raw, "2025-10-04T09:00:00+09:00"),
    [
      { source_timestamp_ms: september30, value: 1000000 },
      { source_timestamp_ms: october1, value: 1100000 },
      { source_timestamp_ms: Date.UTC(2025, 9, 2), value: 1050000 },
      { source_timestamp_ms: Date.UTC(2025, 9, 3), value: 1200000 },
    ],
  );
});
test("parses non-zero-padded legacy month/day labels", () => {
  const raw = `
    <script>
    var chartData = {
      time: ["10.30", "10.31", "11.1", "11.2"],
      value: ["1000000", "1100000", "1050000", "1200000"],
    };
    </script>
  `;

  assert.deepEqual(
    parseDatacenterPriceGraph(raw, "2025-11-03T09:00:00+09:00"),
    [
      { source_timestamp_ms: Date.UTC(2025, 9, 30), value: 1000000 },
      { source_timestamp_ms: Date.UTC(2025, 9, 31), value: 1100000 },
      { source_timestamp_ms: Date.UTC(2025, 10, 1), value: 1050000 },
      { source_timestamp_ms: Date.UTC(2025, 10, 2), value: 1200000 },
    ],
  );
});
