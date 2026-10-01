import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  dispersion,
  median,
  parseMarketMetricParameters,
  runMarketMetrics,
} from "../src/analysis/market-metrics.ts";

function dbFixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE dataset_snapshot (
      dataset_snapshot_id TEXT PRIMARY KEY,
      analysis_cutoff TEXT NOT NULL,
      schema_version INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE analysis_run (
      analysis_run_id TEXT PRIMARY KEY,
      dataset_snapshot_id TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      status TEXT NOT NULL,
      result_hash TEXT
    ) STRICT;
    CREATE TABLE instrument (
      instrument_id TEXT PRIMARY KEY,
      spid TEXT NOT NULL,
      grade INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE player_card (
      spid TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      season TEXT NOT NULL
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
    CREATE TABLE dataset_snapshot_price_point (
      dataset_snapshot_id TEXT NOT NULL,
      source_snapshot_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      source_timestamp TEXT NOT NULL,
      PRIMARY KEY (dataset_snapshot_id, source_snapshot_id, instrument_id, source_timestamp)
    ) STRICT;
    CREATE TABLE cohort_membership (
      cohort_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      membership_source TEXT NOT NULL,
      confidence REAL NOT NULL,
      PRIMARY KEY (cohort_id, instrument_id, valid_from)
    ) STRICT;
    CREATE TABLE dataset_snapshot_cohort_membership (
      dataset_snapshot_id TEXT NOT NULL,
      cohort_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      membership_source TEXT,
      confidence REAL,
      PRIMARY KEY (dataset_snapshot_id, cohort_id, instrument_id, valid_from)
    ) STRICT;
    CREATE TABLE dataset_snapshot_cohort_definition (
      dataset_snapshot_id TEXT NOT NULL,
      cohort_id TEXT NOT NULL,
      name TEXT NOT NULL,
      aggregation_level TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      rule_params_json TEXT NOT NULL,
      PRIMARY KEY (dataset_snapshot_id, cohort_id)
    ) STRICT;
    CREATE TABLE event (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      effective_at TEXT,
      ended_at TEXT
    ) STRICT;
    CREATE TABLE dataset_snapshot_event (
      dataset_snapshot_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      PRIMARY KEY (dataset_snapshot_id, event_id)
    ) STRICT;
    CREATE TABLE analysis_metric (
      analysis_run_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL,
      status TEXT NOT NULL,
      valid_count INTEGER NOT NULL,
      total_count INTEGER NOT NULL,
      coverage_ratio REAL NOT NULL,
      details_json TEXT NOT NULL,
      PRIMARY KEY (analysis_run_id, metric_date, scope_type, scope_id, metric_name)
    ) STRICT;
  `);
  db.prepare("INSERT INTO dataset_snapshot VALUES ('ds', '2026-10-03T00:00:00.000Z', 8)").run();
  db.prepare(
    `INSERT INTO analysis_run VALUES (
      'run', 'ds', ?, 'READY', NULL
    )`,
  ).run(JSON.stringify({
    timezone: "Asia/Seoul",
    price_semantics: "MARKET_REFERENCE_PRICE",
    sample_market: { min_valid_count: 2, min_coverage_ratio: 0.6 },
    allow_regime_crossing: false,
    regimes: [],
    cross_player_cohort: { min_valid_count: 2, min_coverage_ratio: 0.6 },
  }));

  const cards = [
    ["100:1", "100", "p1", 11, "26TOTS"],
    ["200:1", "200", "p2", 1, "PTG"],
    ["300:1", "300", "p3", 1, "PTG"],
  ] as const;
  for (const [instrument, spid, player, grade, season] of cards) {
    db.prepare("INSERT INTO instrument VALUES (?, ?, ?)").run(instrument, spid, grade);
    db.prepare("INSERT INTO player_card VALUES (?, ?, ?)").run(spid, player, season);
  }
  const prices = [
    ["100:1", 100, 110],
    ["200:1", 100, 90],
    ["300:1", 100, 120],
  ] as const;
  for (const [instrument, day1, day2] of prices) {
    for (const [day, value] of [["2026-10-01", day1], ["2026-10-02", day2]] as const) {
      const source = `${instrument}-${day}`;
      const ts = `${day}T00:00:00.000Z`;
      db.prepare(
        `INSERT INTO price_point VALUES (?, ?, ?, ?, ?, 'MARKET_REFERENCE_PRICE', 'VALID')`,
      ).run(source, instrument, ts, ts, value);
      db.prepare("INSERT INTO dataset_snapshot_price_point VALUES ('ds', ?, ?, ?)")
        .run(source, instrument, ts);
    }
  }

  const definitions = [
    ["SAMPLE_MARKET:test", "SAMPLE_MARKET"],
    ["CORE:test", "CORE"],
    ["PACK_EXPOSED", "PACK_EXPOSED"],
  ] as const;
  for (const [id, name] of definitions) {
    db.prepare("INSERT INTO dataset_snapshot_cohort_definition VALUES ('ds', ?, ?, 'PLAYER', 'v1', '{}')")
      .run(id, name);
  }
  for (const instrument of ["100:1", "200:1", "300:1"]) {
    db.prepare("INSERT INTO cohort_membership VALUES ('SAMPLE_MARKET:test', ?, '2026-09-01T00:00:00Z', NULL, 'TEST', 1)")
      .run(instrument);
    db.prepare("INSERT INTO dataset_snapshot_cohort_membership VALUES ('ds', 'SAMPLE_MARKET:test', ?, '2026-09-01T00:00:00Z', NULL, 'TEST', 1)")
      .run(instrument);
  }
  for (const instrument of ["100:1", "200:1"]) {
    db.prepare("INSERT INTO cohort_membership VALUES ('CORE:test', ?, '2026-09-01T00:00:00Z', NULL, 'TEST', 1)")
      .run(instrument);
    db.prepare("INSERT INTO dataset_snapshot_cohort_membership VALUES ('ds', 'CORE:test', ?, '2026-09-01T00:00:00Z', NULL, 'TEST', 1)")
      .run(instrument);
  }
  return db;
}

test("calculates robust helper statistics", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 3]), 2);
  assert.deepEqual(dispersion([-0.1, 0.1, 0.2]), {
    iqr: 0.15,
    mad: 0.1,
  });
  assert.deepEqual(parseMarketMetricParameters({
    timezone: "Asia/Seoul",
    price_semantics: "MARKET_REFERENCE_PRICE",
    sample_market: { min_valid_count: 10, min_coverage_ratio: 0.6 },
    allow_regime_crossing: false,
    regimes: [],
    cross_player_cohort: { min_valid_count: 3, min_coverage_ratio: 0.6 },
  }).sample_market, { min_valid_count: 10, min_coverage_ratio: 0.6 });
});

test("computes snapshot-bound market metrics and emits NO_RESULT for empty cohorts", () => {
  const db = dbFixture();
  try {
    const first = runMarketMetrics(db, "run");
    const second = runMarketMetrics(db, "run");
    assert.equal(first.result_hash, second.result_hash);
    assert.equal(first.metric_dates, 2);

    const sample = db.prepare(
      `SELECT value, status, valid_count, total_count
       FROM analysis_metric
       WHERE analysis_run_id = 'run'
         AND metric_date = '2026-10-02'
         AND scope_id = 'SAMPLE_MARKET:test'
         AND metric_name = 'RETURN_1D'`,
    ).get();
    assert.deepEqual({ ...sample }, {
      value: 0.1,
      status: "OK",
      valid_count: 3,
      total_count: 3,
    });

    const core = db.prepare(
      `SELECT value, status FROM analysis_metric
       WHERE analysis_run_id = 'run'
         AND metric_date = '2026-10-02'
         AND scope_id = 'CORE:test'
         AND metric_name = 'RETURN_1D'`,
    ).get();
    assert.deepEqual({ ...core }, { value: 0, status: "OK" });

    const relative = db.prepare(
      `SELECT value, status FROM analysis_metric
       WHERE analysis_run_id = 'run'
         AND metric_date = '2026-10-02'
         AND scope_id = 'CORE:test'
         AND metric_name = 'RELATIVE_STRENGTH'`,
    ).get();
    assert.deepEqual({ ...relative }, { value: -0.1, status: "OK" });

    const empty = db.prepare(
      `SELECT value, status, total_count FROM analysis_metric
       WHERE analysis_run_id = 'run'
         AND metric_date = '2026-10-02'
         AND scope_id = 'PACK_EXPOSED'
         AND metric_name = 'RETURN_1D'`,
    ).get();
    assert.deepEqual({ ...empty }, { value: null, status: "NO_RESULT", total_count: 0 });

    const run = db.prepare("SELECT status, result_hash FROM analysis_run WHERE analysis_run_id = 'run'").get() as {
      status: string;
      result_hash: string;
    };
    assert.equal(run.status, "SUCCEEDED");
    assert.equal(run.result_hash, first.result_hash);
  } finally {
    db.close();
  }
});

test("blocks only instruments whose configured Regime boundary is crossed", () => {
  const db = dbFixture();
  try {
    db.prepare(
      "INSERT INTO event VALUES ('rule', 'MARKET_RULE_CHANGE', '2026-10-01T12:00:00.000Z', NULL)",
    ).run();
    db.prepare("INSERT INTO dataset_snapshot_event VALUES ('ds', 'rule')").run();
    db.prepare(
      "UPDATE analysis_run SET parameters_json = ? WHERE analysis_run_id = 'run'",
    ).run(JSON.stringify({
      timezone: "Asia/Seoul",
      price_semantics: "MARKET_REFERENCE_PRICE",
      allow_regime_crossing: false,
      regimes: [{
        regime_id: "26tots-11-test",
        event_id: "rule",
        class_filter: ["26TOTS"],
        grade_min: 11,
        grade_max: 11,
      }],
      sample_market: { min_valid_count: 2, min_coverage_ratio: 0.6 },
      cross_player_cohort: { min_valid_count: 2, min_coverage_ratio: 0.6 },
    }));

    runMarketMetrics(db, "run");
    const blocked = db.prepare(
      `SELECT status, details_json
       FROM analysis_metric
       WHERE analysis_run_id = 'run'
         AND metric_date = '2026-10-02'
         AND scope_type = 'INSTRUMENT'
         AND scope_id = '100:1'
         AND metric_name = 'RETURN_1D'`,
    ).get() as { status: string; details_json: string };
    assert.equal(blocked.status, "NO_RESULT");
    assert.match(
      JSON.parse(blocked.details_json).reason as string,
      /^REGIME_BOUNDARY:26tots-11-test:ENTER$/,
    );

    const unaffected = db.prepare(
      `SELECT status
       FROM analysis_metric
       WHERE analysis_run_id = 'run'
         AND metric_date = '2026-10-02'
         AND scope_type = 'INSTRUMENT'
         AND scope_id = '200:1'
         AND metric_name = 'RETURN_1D'`,
    ).get() as { status: string };
    assert.equal(unaffected.status, "OK");
  } finally {
    db.close();
  }
});
