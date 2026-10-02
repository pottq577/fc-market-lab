import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  runBenchmarkSignalDiagnostic,
  weightedMean,
  weightedTrimmedMean,
} from "../src/benchmark/signal-diagnostic.ts";

function fixture(days = 3): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
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
  `);
  db.exec(`
    CREATE TABLE benchmark_metric_run (
      benchmark_metric_run_id TEXT PRIMARY KEY,
      panel_family_id TEXT NOT NULL,
      metric_version TEXT NOT NULL,
      analysis_cutoff TEXT NOT NULL,
      timezone TEXT NOT NULL,
      price_semantics TEXT NOT NULL,
      minimum_weighted_coverage REAL NOT NULL,
      input_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      result_hash TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_metric_input_price (
      benchmark_metric_run_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      source_snapshot_id TEXT NOT NULL,
      source_timestamp TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      value INTEGER,
      price_semantics TEXT NOT NULL,
      quality_status TEXT NOT NULL,
      PRIMARY KEY (benchmark_metric_run_id, instrument_id, source_timestamp)
    ) STRICT;
    CREATE TABLE benchmark_metric (
      benchmark_metric_run_id TEXT NOT NULL,
      panel_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      period_type TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL,
      status TEXT NOT NULL,
      valid_count INTEGER NOT NULL,
      total_count INTEGER NOT NULL,
      valid_weight REAL NOT NULL,
      total_weight REAL NOT NULL,
      weighted_coverage REAL NOT NULL,
      details_json TEXT NOT NULL,
      PRIMARY KEY (benchmark_metric_run_id, panel_id, metric_date, metric_name)
    ) STRICT;
  `);
  db.exec(readFileSync("db/migrations/018_benchmark_signal_diagnostic.sql", "utf8"));

  db.prepare("INSERT INTO benchmark_panel VALUES ('p4', 'family', 'P4', 4, '2026-10-03T00:00:00.000Z')").run();
  for (const [player, instrument, rank] of [
    ["a", "a:1", 1],
    ["b", "b:1", 2],
    ["c", "c:1", 3],
    ["d", "d:1", 4],
  ] as const) {
    db.prepare("INSERT INTO benchmark_panel_member VALUES ('p4', ?, ?, 1, ?)")
      .run(player, instrument, rank);
  }
  db.prepare(
    `INSERT INTO benchmark_metric_run(
      benchmark_metric_run_id, panel_family_id, metric_version,
      analysis_cutoff, timezone, price_semantics,
      minimum_weighted_coverage, input_hash, created_at,
      status, result_hash
    ) VALUES (
      'metric-run', 'family', 'market-benchmark-metrics-v1',
      '2026-10-03T12:00:00.000Z', 'UTC', 'MARKET_REFERENCE_PRICE',
      0.8, 'sha256:input', '2026-10-03T12:00:00.000Z',
      'SUCCEEDED', 'sha256:result'
    )`,
  ).run();

  const prices: Record<string, number[]> = {
    "a:1": [100, 100, 100],
    "b:1": [100, 100, 100],
    "c:1": [100, 120, 120],
    "d:1": [100, 90, 90],
  };
  const dates = ["2026-10-01", "2026-10-02", "2026-10-03"];
  for (const [instrument, values] of Object.entries(prices)) {
    values.slice(0, days).forEach((value, index) => {
      const timestamp = `${dates[index]}T00:00:00.000Z`;
      db.prepare(
        `INSERT INTO benchmark_metric_input_price VALUES (
          'metric-run', ?, ?, ?, '2026-10-03T01:00:00.000Z', ?,
          'MARKET_REFERENCE_PRICE', 'VALID'
        )`,
      ).run(instrument, `source-${instrument}-${index}`, timestamp, value);
    });
  }

  const rows = [
    ["2026-10-01", null, "NO_RESULT", 0, 0, 0],
    ["2026-10-02", 0, "OK", 4, 4, 1],
    ["2026-10-03", 0, "OK", 4, 4, 1],
  ] as const;
  for (const [date, value, status, validCount, validWeight, coverage] of rows.slice(0, days)) {
    db.prepare(
      `INSERT INTO benchmark_metric VALUES (
        'metric-run', 'p4', ?, 'FIXED_PANEL_BACKCAST', 'RETURN_1D', ?, ?,
        ?, 4, ?, 4, ?, '{}'
      )`,
    ).run(date, value, status, validCount, validWeight, coverage);
  }
  return db;
}

test("calculates weighted mean and symmetric weighted trimmed mean", () => {
  const values = [
    { value: -0.1, weight: 1 },
    { value: 0, weight: 1 },
    { value: 0, weight: 1 },
    { value: 0.2, weight: 1 },
  ];
  assert.ok(Math.abs(weightedMean(values) - 0.025) < 1e-12);
  assert.ok(Math.abs(weightedTrimmedMean(values, 0.1) - 0.01875) < 1e-12);
});

test("diagnoses zero-inflated dates without changing the production metric", () => {
  const db = fixture();
  try {
    const first = runBenchmarkSignalDiagnostic(db, {
      benchmarkMetricRunId: "metric-run",
      createdAt: "2026-10-03T12:01:00.000Z",
    });
    const second = runBenchmarkSignalDiagnostic(db, {
      benchmarkMetricRunId: "metric-run",
      createdAt: "2026-10-03T12:02:00.000Z",
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.benchmark_signal_diagnostic_run_id, second.benchmark_signal_diagnostic_run_id);
    assert.equal(first.result_hash, second.result_hash);
    assert.equal(first.diagnostic_rows, 3);

    const day2 = db.prepare(
      `SELECT base_point_value, zero_count, positive_count, negative_count,
              zero_weight_ratio, weighted_median, weighted_mean, weighted_trimmed_mean
       FROM benchmark_signal_diagnostic
       WHERE benchmark_signal_diagnostic_run_id = ?
         AND panel_id = 'p4' AND metric_date = '2026-10-02'`,
    ).get(first.benchmark_signal_diagnostic_run_id) as Record<string, number>;
    assert.equal(day2.base_point_value, 0);
    assert.equal(day2.zero_count, 2);
    assert.equal(day2.positive_count, 1);
    assert.equal(day2.negative_count, 1);
    assert.equal(day2.zero_weight_ratio, 0.5);
    assert.equal(day2.weighted_median, 0);
    assert.ok(Math.abs(day2.weighted_mean - 0.025) < 1e-12);
    assert.ok(Math.abs(day2.weighted_trimmed_mean - 0.01875) < 1e-12);

    assert.deepEqual(first.panels[0], {
      panel_id: "p4",
      panel_label: "P4",
      panel_size: 4,
      diagnostic_dates: 3,
      ok_dates: 2,
      no_result_dates: 1,
      zero_dominated_dates: 2,
      median_zero_dates: 2,
      mean_nonzero_dates: 1,
      trimmed_mean_nonzero_dates: 1,
      median_zero_but_mean_nonzero_dates: 1,
      median_zero_ratio: 1,
      mean_nonzero_ratio: 0.5,
      trimmed_mean_nonzero_ratio: 0.5,
      average_zero_weight_ratio: 0.75,
      classification: "INSUFFICIENT_OK_DAYS",
    });
  } finally {
    db.close();
  }
});
