import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  runBenchmarkUncertainty,
  sampleQuantile,
} from "../src/benchmark/uncertainty.ts";

function fixture(insufficient = false): DatabaseSync {
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
      stratum_id TEXT NOT NULL,
      anchor_instrument_id TEXT NOT NULL,
      population_weight REAL NOT NULL,
      admission_rank INTEGER NOT NULL,
      PRIMARY KEY (panel_id, player_id)
    ) STRICT;
  `);
  db.exec(readFileSync("db/migrations/014_benchmark_metrics.sql", "utf8"));
  db.exec(readFileSync("db/migrations/015_benchmark_uncertainty.sql", "utf8"));

  const members = insufficient
    ? [
        ["a", "S1", "a:1", 50, 1],
        ["b", "S2", "b:1", 50, 2],
      ] as const
    : [
        ["a", "S1", "a:1", 25, 1],
        ["b", "S1", "b:1", 25, 2],
        ["c", "S2", "c:1", 25, 3],
        ["d", "S2", "d:1", 25, 4],
      ] as const;
  const panelId = insufficient ? "p2" : "p4";
  db.prepare("INSERT INTO benchmark_panel VALUES (?, 'family', ?, ?, '2026-10-03T00:00:00.000Z')")
    .run(panelId, insufficient ? "P2" : "P4", members.length);
  for (const member of members) {
    db.prepare("INSERT INTO benchmark_panel_member VALUES (?, ?, ?, ?, ?, ?)")
      .run(panelId, ...member);
  }

  db.prepare(
    `INSERT INTO benchmark_metric_run(
      benchmark_metric_run_id, panel_family_id, metric_version,
      analysis_cutoff, timezone, price_semantics,
      minimum_weighted_coverage, input_hash, created_at,
      status, result_hash
    ) VALUES (
      'metric-run', 'family', 'market-benchmark-metrics-v1',
      '2026-10-03T12:00:00.000Z', 'Asia/Seoul', 'MARKET_REFERENCE_PRICE',
      0.8, 'sha256:input', '2026-10-03T12:00:00.000Z',
      'SUCCEEDED', 'sha256:result'
    )`,
  ).run();

  const prices: Record<string, Array<[string, number]>> = insufficient
    ? {
        "a:1": [["2026-10-01", 100], ["2026-10-02", 110], ["2026-10-03", 121]],
        "b:1": [["2026-10-01", 100], ["2026-10-02", 90], ["2026-10-03", 99]],
      }
    : {
        "a:1": [["2026-10-01", 100], ["2026-10-02", 110], ["2026-10-03", 121]],
        "b:1": [["2026-10-01", 100], ["2026-10-02", 90], ["2026-10-03", 99]],
        "c:1": [["2026-10-01", 100], ["2026-10-02", 100], ["2026-10-03", 110]],
        "d:1": [["2026-10-01", 100], ["2026-10-02", 120], ["2026-10-03", 120]],
      };
  for (const [instrument, points] of Object.entries(prices)) {
    for (const [date, value] of points) {
      const timestamp = `${date}T00:00:00.000Z`;
      db.prepare(
        `INSERT INTO benchmark_metric_input_price VALUES (
          'metric-run', ?, ?, ?, '2026-10-03T01:00:00.000Z', ?,
          'MARKET_REFERENCE_PRICE', 'VALID'
        )`,
      ).run(instrument, `source-${instrument}`, timestamp, value);
    }
  }

  const metricValues: Record<string, Record<string, number | null>> = insufficient
    ? {
        "2026-10-01": { RETURN_1D: null, INDEX: null, BREADTH: null, IQR: null, MAD: null },
        "2026-10-02": { RETURN_1D: -0.1, INDEX: 90, BREADTH: 0.5, IQR: 0.2, MAD: 0.1 },
        "2026-10-03": { RETURN_1D: 0.1, INDEX: 99, BREADTH: 1, IQR: 0, MAD: 0 },
      }
    : {
        "2026-10-01": { RETURN_1D: null, INDEX: null, BREADTH: null, IQR: null, MAD: null },
        "2026-10-02": { RETURN_1D: 0, INDEX: 100, BREADTH: 0.5, IQR: 0.2, MAD: 0.1 },
        "2026-10-03": { RETURN_1D: 0.1, INDEX: 110, BREADTH: 0.75, IQR: 0.1, MAD: 0 },
      };
  for (const [date, values] of Object.entries(metricValues)) {
    for (const [metricName, value] of Object.entries(values)) {
      const status = value === null ? "NO_RESULT" : "OK";
      db.prepare(
        `INSERT INTO benchmark_metric VALUES (
          'metric-run', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}'
        )`,
      ).run(
        panelId,
        date,
        date < "2026-10-03" ? "FIXED_PANEL_BACKCAST" : "CONTEMPORANEOUS",
        metricName,
        value,
        status,
        value === null ? 0 : members.length,
        members.length,
        value === null ? 0 : 100,
        100,
        value === null ? 0 : 1,
      );
    }
  }
  return db;
}

test("calculates deterministic sample quantiles", () => {
  assert.equal(sampleQuantile([1, 2, 3, 4], 0.5), 2.5);
  assert.ok(Math.abs(sampleQuantile([1, 2, 3, 4], 0.025) - 1.075) < 1e-12);
});

test("bootstraps whole player series within strata deterministically", () => {
  const db = fixture();
  try {
    const first = runBenchmarkUncertainty(db, {
      benchmarkMetricRunId: "metric-run",
      replicates: 200,
      sampleSeed: "test-seed",
      createdAt: "2026-10-03T12:01:00.000Z",
    });
    const second = runBenchmarkUncertainty(db, {
      benchmarkMetricRunId: "metric-run",
      replicates: 200,
      sampleSeed: "test-seed",
      createdAt: "2026-10-03T12:02:00.000Z",
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.benchmark_uncertainty_run_id, second.benchmark_uncertainty_run_id);
    assert.equal(first.result_hash, second.result_hash);
    assert.equal(first.uncertainty_rows, 15);
    assert.equal(first.base_no_result_rows, 5);
    assert.equal(first.insufficient_rows, 0);

    const day2 = db.prepare(
      `SELECT point_value, lower_value, upper_value, status,
              valid_replicates, total_replicates
       FROM benchmark_metric_uncertainty
       WHERE benchmark_uncertainty_run_id = ?
         AND panel_id = 'p4'
         AND metric_date = '2026-10-02'
         AND metric_name = 'RETURN_1D'`,
    ).get(first.benchmark_uncertainty_run_id) as Record<string, unknown>;
    assert.equal(day2.status, "OK");
    assert.equal(day2.point_value, 0);
    assert.equal(day2.valid_replicates, 200);
    assert.equal(day2.total_replicates, 200);
    assert.ok(Number(day2.lower_value) <= Number(day2.upper_value));
  } finally {
    db.close();
  }
});

test("marks panels with undersized strata as insufficient", () => {
  const db = fixture(true);
  try {
    const result = runBenchmarkUncertainty(db, {
      benchmarkMetricRunId: "metric-run",
      replicates: 50,
      sampleSeed: "test-seed",
      createdAt: "2026-10-03T12:01:00.000Z",
    });
    assert.equal(result.ok_rows, 0);
    assert.equal(result.base_no_result_rows, 5);
    assert.equal(result.insufficient_rows, 10);
    const row = db.prepare(
      `SELECT status, lower_value, upper_value
       FROM benchmark_metric_uncertainty
       WHERE benchmark_uncertainty_run_id = ?
         AND metric_date = '2026-10-02'
         AND metric_name = 'RETURN_1D'`,
    ).get(result.benchmark_uncertainty_run_id);
    assert.deepEqual({ ...row }, {
      status: "INSUFFICIENT_UNCERTAINTY_SAMPLE",
      lower_value: null,
      upper_value: null,
    });
  } finally {
    db.close();
  }
});
