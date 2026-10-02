import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  runBenchmarkMetrics,
  weightedDispersion,
  weightedMedian,
  weightedQuantile,
} from "../src/benchmark/metrics.ts";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE benchmark_panel_family (
      panel_family_id TEXT PRIMARY KEY,
      panel_version TEXT NOT NULL,
      stratification_basis TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_panel (
      panel_id TEXT PRIMARY KEY,
      panel_family_id TEXT NOT NULL,
      panel_label TEXT NOT NULL,
      panel_size INTEGER NOT NULL,
      effective_from TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_panel_member (
      panel_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      anchor_instrument_id TEXT NOT NULL,
      population_weight REAL NOT NULL,
      admission_rank INTEGER NOT NULL,
      PRIMARY KEY (panel_id, player_id)
    ) STRICT;
    CREATE TABLE source_snapshot (
      source_snapshot_id TEXT PRIMARY KEY,
      observed_at TEXT NOT NULL,
      parse_status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE price_point (
      source_snapshot_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      source_timestamp TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      value INTEGER,
      price_semantics TEXT NOT NULL,
      quality_status TEXT NOT NULL,
      PRIMARY KEY (source_snapshot_id, source_timestamp)
    ) STRICT;
  `);
  db.exec(readFileSync("db/migrations/014_benchmark_metrics.sql", "utf8"));
  db.prepare(
    `INSERT INTO benchmark_panel_family VALUES (
      'family', 'market-benchmark-panel-v2', 'PRICE_ONLY',
      '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z'
    )`,
  ).run();
  db.prepare(
    `INSERT INTO benchmark_panel VALUES (
      'p2', 'family', 'P2', 2, '2026-10-03T00:00:00.000Z'
    )`,
  ).run();
  db.prepare(
    `INSERT INTO benchmark_panel VALUES (
      'p4', 'family', 'P4', 4, '2026-10-03T00:00:00.000Z'
    )`,
  ).run();

  const p2 = [
    ["a", "a:1", 30, 1],
    ["b", "b:1", 70, 2],
  ] as const;
  for (const row of p2) {
    db.prepare("INSERT INTO benchmark_panel_member VALUES ('p2', ?, ?, ?, ?)")
      .run(...row);
  }
  const p4 = [
    ["a", "a:1", 25, 1],
    ["b", "b:1", 25, 2],
    ["c", "c:1", 25, 3],
    ["d", "d:1", 25, 4],
  ] as const;
  for (const row of p4) {
    db.prepare("INSERT INTO benchmark_panel_member VALUES ('p4', ?, ?, ?, ?)")
      .run(...row);
  }

  const prices: Record<string, Array<[string, number]>> = {
    "a:1": [["2026-10-01", 100], ["2026-10-02", 110], ["2026-10-03", 121]],
    "b:1": [["2026-10-01", 100], ["2026-10-02", 90]],
    "c:1": [["2026-10-01", 100], ["2026-10-02", 100], ["2026-10-03", 110]],
    "d:1": [["2026-10-01", 100], ["2026-10-02", 120], ["2026-10-03", 120]],
  };
  for (const [instrument, points] of Object.entries(prices)) {
    const source = `source-${instrument}`;
    db.prepare("INSERT INTO source_snapshot VALUES (?, '2026-10-03T01:00:00.000Z', 'PARSED')")
      .run(source);
    for (const [date, value] of points) {
      const timestamp = `${date}T00:00:00.000Z`;
      db.prepare(
        `INSERT INTO price_point VALUES (
          ?, ?, ?, '2026-10-03T01:00:00.000Z', ?,
          'MARKET_REFERENCE_PRICE', 'VALID'
        )`,
      ).run(source, instrument, timestamp, value);
    }
  }

  db.prepare(
    "INSERT INTO source_snapshot VALUES ('future-a', '2026-10-04T01:00:00.000Z', 'PARSED')",
  ).run();
  db.prepare(
    `INSERT INTO price_point VALUES (
      'future-a', 'a:1', '2026-10-02T00:00:00.000Z',
      '2026-10-04T01:00:00.000Z', 999,
      'MARKET_REFERENCE_PRICE', 'VALID'
    )`,
  ).run();
  return db;
}

test("calculates deterministic weighted statistics", () => {
  const values = [
    { value: -0.1, weight: 1 },
    { value: 0, weight: 1 },
    { value: 0.1, weight: 1 },
    { value: 0.2, weight: 1 },
  ];
  assert.equal(weightedMedian(values), 0);
  assert.equal(weightedQuantile(values, 0.25), -0.1);
  assert.equal(weightedQuantile(values, 0.75), 0.1);
  assert.deepEqual(weightedDispersion(values), { iqr: 0.2, mad: 0.1 });
});

test("freezes benchmark inputs and calculates weighted panel metrics idempotently", () => {
  const db = fixture();
  try {
    const first = runBenchmarkMetrics(db, {
      panelFamilyId: "family",
      analysisCutoff: "2026-10-03T12:00:00.000Z",
      createdAt: "2026-10-03T12:01:00.000Z",
    });
    const second = runBenchmarkMetrics(db, {
      panelFamilyId: "family",
      analysisCutoff: "2026-10-03T12:00:00.000Z",
      createdAt: "2026-10-03T12:02:00.000Z",
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.benchmark_metric_run_id, second.benchmark_metric_run_id);
    assert.equal(first.result_hash, second.result_hash);
    assert.equal(first.metric_dates, 3);
    assert.equal(first.metric_rows, 30);

    const p2Return = db.prepare(
      `SELECT value, status, valid_count, total_count,
              valid_weight, total_weight, weighted_coverage, period_type
       FROM benchmark_metric
       WHERE benchmark_metric_run_id = ?
         AND panel_id = 'p2'
         AND metric_date = '2026-10-02'
         AND metric_name = 'RETURN_1D'`,
    ).get(first.benchmark_metric_run_id);
    assert.deepEqual({ ...p2Return }, {
      value: -0.1,
      status: "OK",
      valid_count: 2,
      total_count: 2,
      valid_weight: 100,
      total_weight: 100,
      weighted_coverage: 1,
      period_type: "FIXED_PANEL_BACKCAST",
    });

    const p2Breadth = db.prepare(
      `SELECT value FROM benchmark_metric
       WHERE benchmark_metric_run_id = ? AND panel_id = 'p2'
         AND metric_date = '2026-10-02' AND metric_name = 'BREADTH'`,
    ).get(first.benchmark_metric_run_id) as { value: number };
    assert.equal(p2Breadth.value, 0.3);

    const p4 = db.prepare(
      `SELECT metric_name, value, status
       FROM benchmark_metric
       WHERE benchmark_metric_run_id = ? AND panel_id = 'p4'
         AND metric_date = '2026-10-02'
         AND metric_name IN ('RETURN_1D', 'BREADTH', 'IQR', 'MAD', 'INDEX')
       ORDER BY metric_name`,
    ).all(first.benchmark_metric_run_id).map((row) => ({ ...row }));
    assert.deepEqual(p4, [
      { metric_name: "BREADTH", value: 0.5, status: "OK" },
      { metric_name: "INDEX", value: 100, status: "OK" },
      { metric_name: "IQR", value: 0.2, status: "OK" },
      { metric_name: "MAD", value: 0.1, status: "OK" },
      { metric_name: "RETURN_1D", value: 0, status: "OK" },
    ]);

    const lowCoverage = db.prepare(
      `SELECT metric_name, value, status, weighted_coverage, period_type
       FROM benchmark_metric
       WHERE benchmark_metric_run_id = ? AND panel_id = 'p4'
         AND metric_date = '2026-10-03'
       ORDER BY metric_name`,
    ).all(first.benchmark_metric_run_id).map((row) => ({ ...row }));
    assert.equal(lowCoverage.length, 5);
    assert.ok(lowCoverage.every((row) => row.status === "NO_RESULT"));
    assert.ok(lowCoverage.every((row) => row.value === null));
    assert.ok(lowCoverage.every((row) => row.weighted_coverage === 0.75));
    assert.ok(lowCoverage.every((row) => row.period_type === "CONTEMPORANEOUS"));

    const frozenFuture = db.prepare(
      `SELECT COUNT(*) AS count
       FROM benchmark_metric_input_price
       WHERE benchmark_metric_run_id = ? AND source_snapshot_id = 'future-a'`,
    ).get(first.benchmark_metric_run_id) as { count: number | bigint };
    assert.equal(Number(frozenFuture.count), 0);
  } finally {
    db.close();
  }
});
