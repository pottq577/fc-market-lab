import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runShockDetection } from "../src/analysis/shock-detection.ts";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE dataset_snapshot (
      dataset_snapshot_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE analysis_run (
      analysis_run_id TEXT PRIMARY KEY,
      dataset_snapshot_id TEXT NOT NULL,
      parameters_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE analysis_metric (
      analysis_run_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL,
      status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE shock_score (
      analysis_run_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL,
      robust_z REAL,
      status TEXT NOT NULL,
      baseline_count INTEGER NOT NULL,
      baseline_median REAL,
      baseline_mad REAL,
      reason TEXT,
      is_candidate INTEGER NOT NULL,
      details_json TEXT NOT NULL,
      PRIMARY KEY (analysis_run_id, metric_date, scope_id, metric_name)
    ) STRICT;
    CREATE TABLE shock_candidate (
      shock_candidate_id TEXT PRIMARY KEY,
      analysis_run_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL NOT NULL,
      robust_z REAL NOT NULL,
      severity REAL NOT NULL,
      detector_version TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare("INSERT INTO dataset_snapshot VALUES ('ds', 8)").run();
  db.prepare("INSERT INTO analysis_run VALUES ('run', 'ds', ?)").run(JSON.stringify({
    shock_detection: {
      baseline_window: 30,
      min_baseline_count: 20,
      robust_z_threshold: 3.5,
    },
  }));
  return db;
}

function date(day: number): string {
  return `2026-01-${String(day).padStart(2, "0")}`;
}

test("detects robust-z Shock candidates without using the current observation in baseline", () => {
  const db = fixture();
  try {
    const insert = db.prepare(
      "INSERT INTO analysis_metric VALUES ('run', ?, 'COHORT', ?, 'RETURN_1D', ?, 'OK')",
    );
    for (let day = 1; day <= 30; day += 1) {
      insert.run(date(day), "SAMPLE_MARKET:test", (day - 15) / 1000);
    }
    insert.run("2026-01-31", "SAMPLE_MARKET:test", 0.2);

    for (let day = 1; day <= 21; day += 1) {
      insert.run(date(day), "CORE:test", day === 21 ? 0.2 : 0.01);
    }

    const first = runShockDetection(db, "run");
    const second = runShockDetection(db, "run");
    assert.equal(first.result_hash, second.result_hash);
    assert.equal(first.candidate_rows, 1);

    const candidate = db.prepare(
      "SELECT scope_id, metric_date, robust_z, severity FROM shock_candidate",
    ).get() as Record<string, unknown>;
    assert.equal(candidate.scope_id, "SAMPLE_MARKET:test");
    assert.equal(candidate.metric_date, "2026-01-31");
    assert.ok(Number(candidate.robust_z) > 3.5);
    assert.equal(candidate.severity, Math.abs(Number(candidate.robust_z)));

    const zeroMad = db.prepare(
      `SELECT status, reason, baseline_count, baseline_mad
       FROM shock_score
       WHERE scope_id = 'CORE:test' AND metric_date = '2026-01-21'`,
    ).get();
    assert.deepEqual({ ...zeroMad }, {
      status: "NO_RESULT",
      reason: "ZERO_MAD",
      baseline_count: 20,
      baseline_mad: 0,
    });

    const early = db.prepare(
      `SELECT status, reason, baseline_count
       FROM shock_score
       WHERE scope_id = 'SAMPLE_MARKET:test' AND metric_date = '2026-01-20'`,
    ).get();
    assert.deepEqual({ ...early }, {
      status: "NO_RESULT",
      reason: "INSUFFICIENT_BASELINE",
      baseline_count: 19,
    });
  } finally {
    db.close();
  }
});
