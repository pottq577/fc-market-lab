import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  candidateDay,
  runBenchmarkSignalCandidates,
  weightedWinsorizedMean,
} from "../src/benchmark/signal-candidates.ts";

function fixture(): DatabaseSync {
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
    CREATE TABLE benchmark_signal_diagnostic_run (
      benchmark_signal_diagnostic_run_id TEXT PRIMARY KEY,
      benchmark_metric_run_id TEXT NOT NULL,
      diagnostic_version TEXT NOT NULL,
      trim_ratio REAL NOT NULL,
      zero_dominance_threshold REAL NOT NULL,
      input_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      result_hash TEXT NOT NULL
    ) STRICT;
  `);
  db.exec(readFileSync("db/migrations/019_benchmark_signal_candidates.sql", "utf8"));

  for (const [panelId, size] of [["p2", 2], ["p3", 3], ["p4", 4]] as const) {
    db.prepare("INSERT INTO benchmark_panel VALUES (?, 'family', ?, ?, '2026-10-05T00:00:00.000Z')")
      .run(panelId, `P${size}`, size);
  }
  const players = [
    ["a", "a:1"],
    ["b", "b:1"],
    ["c", "c:1"],
    ["d", "d:1"],
  ] as const;
  for (const [panelId, size] of [["p2", 2], ["p3", 3], ["p4", 4]] as const) {
    players.slice(0, size).forEach(([playerId, instrumentId], index) => {
      db.prepare("INSERT INTO benchmark_panel_member VALUES (?, ?, ?, 1, ?)")
        .run(panelId, playerId, instrumentId, index + 1);
    });
  }

  db.prepare(
    `INSERT INTO benchmark_metric_run VALUES (
      'metric-run', 'family', 'market-benchmark-metrics-v1',
      '2026-10-04T12:00:00.000Z', 'UTC', 'MARKET_REFERENCE_PRICE',
      0.8, 'sha256:metric-input', '2026-10-04T12:00:00.000Z',
      'SUCCEEDED', 'sha256:metric-result'
    )`,
  ).run();
  db.prepare(
    `INSERT INTO benchmark_signal_diagnostic_run VALUES (
      'diagnostic-run', 'metric-run', 'market-benchmark-signal-diagnostic-v1',
      0.1, 0.5, 'sha256:diagnostic-input', '2026-10-04T12:01:00.000Z',
      'SUCCEEDED', 'sha256:diagnostic-result'
    )`,
  ).run();

  const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
  const prices: Record<string, number[]> = {
    "a:1": [100, 100, 100, 100],
    "b:1": [100, 110, 110, 121],
    "c:1": [100, 120, 108, 108],
    "d:1": [100, 90, 99, 99],
  };
  for (const [instrumentId, values] of Object.entries(prices)) {
    values.forEach((value, index) => {
      const timestamp = `${dates[index]}T00:00:00.000Z`;
      db.prepare(
        `INSERT INTO benchmark_metric_input_price VALUES (
          'metric-run', ?, ?, ?, '2026-10-04T12:00:00.000Z', ?,
          'MARKET_REFERENCE_PRICE', 'VALID'
        )`,
      ).run(instrumentId, `source-${instrumentId}-${index}`, timestamp, value);
    });
  }

  for (const [panelId, size] of [["p2", 2], ["p3", 3], ["p4", 4]] as const) {
    dates.forEach((date, index) => {
      const status = index === 0 ? "NO_RESULT" : "OK";
      const value = status === "OK" ? 0 : null;
      const valid = status === "OK" ? size : 0;
      db.prepare(
        `INSERT INTO benchmark_metric VALUES (
          'metric-run', ?, ?, 'FIXED_PANEL_BACKCAST', 'RETURN_1D', ?, ?,
          ?, ?, ?, ?, ?, '{}'
        )`,
      ).run(
        panelId,
        date,
        value,
        status,
        valid,
        size,
        valid,
        size,
        status === "OK" ? 1 : 0,
      );
    });
  }
  return db;
}

test("decomposes sparse weighted returns and winsorizes movers only", () => {
  const values = [
    { value: 0, weight: 99 },
    { value: 0.1, weight: 1 },
  ];
  const result = candidateDay(values, 0.1);
  assert.equal(result.activity_weight_ratio, 0.01);
  assert.equal(result.weighted_mean, 0.001);
  assert.equal(result.mover_weighted_mean, 0.1);
  assert.equal(result.activity_scaled_mover_median, 0.001);
  assert.equal(result.activity_scaled_mover_winsorized_mean, 0.001);

  const movers = Array.from({ length: 10 }, (_, index) => ({
    value: index === 9 ? 1 : 0.1,
    weight: 1,
  }));
  assert.ok(weightedWinsorizedMean(movers, 0.1) < 0.19);
});

test("evaluates candidate signal density and adjacent-panel convergence reproducibly", () => {
  const db = fixture();
  try {
    const first = runBenchmarkSignalCandidates(db, {
      benchmarkSignalDiagnosticRunId: "diagnostic-run",
      minimumCommonValidDays: 2,
      returnMedianAbsDiffMax: 1,
      returnP95AbsDiffMax: 1,
      directionMatchRatioMin: 0,
      createdAt: "2026-10-04T12:02:00.000Z",
    });
    const second = runBenchmarkSignalCandidates(db, {
      benchmarkSignalDiagnosticRunId: "diagnostic-run",
      minimumCommonValidDays: 2,
      returnMedianAbsDiffMax: 1,
      returnP95AbsDiffMax: 1,
      directionMatchRatioMin: 0,
      createdAt: "2026-10-04T12:03:00.000Z",
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.benchmark_signal_candidate_run_id, second.benchmark_signal_candidate_run_id);
    assert.equal(first.result_hash, second.result_hash);
    assert.equal(first.metric_rows, 12);
    assert.deepEqual(
      first.candidates.map((candidate) => candidate.candidate_name),
      [
        "WEIGHTED_MEAN",
        "ACTIVITY_SCALED_MOVER_MEDIAN",
        "ACTIVITY_SCALED_MOVER_WINSORIZED_MEAN",
      ],
    );
    assert.ok(first.candidates.every((candidate) => candidate.pairs.length === 2));
    assert.ok(first.candidates.every((candidate) => candidate.terminal_pair_status === "PASS"));

    const p4Mean = first.candidates
      .find((candidate) => candidate.candidate_name === "WEIGHTED_MEAN")!
      .panels.find((panel) => panel.panel_id === "p4")!;
    assert.equal(p4Mean.valid_dates, 3);
    assert.equal(p4Mean.signal_dates, 2);
    assert.equal(p4Mean.signal_ratio, 0.666666666667);

    const day2 = db.prepare(
      `SELECT activity_weight_ratio, weighted_mean,
              activity_scaled_mover_median,
              activity_scaled_mover_winsorized_mean
       FROM benchmark_signal_candidate_metric
       WHERE benchmark_signal_candidate_run_id = ?
         AND panel_id = 'p4' AND metric_date = '2026-10-02'`,
    ).get(first.benchmark_signal_candidate_run_id) as Record<string, number>;
    assert.equal(day2.activity_weight_ratio, 0.75);
    assert.equal(day2.weighted_mean, 0.05);
    assert.equal(day2.activity_scaled_mover_median, 0.075);
    assert.equal(day2.activity_scaled_mover_winsorized_mean, 0.05);
  } finally {
    db.close();
  }
});
