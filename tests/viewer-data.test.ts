import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { listViewerRuns, loadViewerPayload } from "../src/viewer/data.ts";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE dataset_snapshot (
      dataset_snapshot_id TEXT PRIMARY KEY,
      analysis_cutoff TEXT NOT NULL
    ) STRICT;
    CREATE TABLE analysis_run (
      analysis_run_id TEXT PRIMARY KEY,
      dataset_snapshot_id TEXT NOT NULL,
      analysis_version TEXT NOT NULL,
      code_commit TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE analysis_metric (
      analysis_run_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL,
      status TEXT NOT NULL,
      coverage_ratio REAL NOT NULL
    ) STRICT;
    CREATE TABLE dataset_snapshot_cohort_definition (
      dataset_snapshot_id TEXT NOT NULL,
      cohort_id TEXT NOT NULL,
      name TEXT NOT NULL,
      aggregation_level TEXT NOT NULL
    ) STRICT;
    CREATE TABLE event (
      event_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      event_type TEXT NOT NULL
    ) STRICT;
    CREATE TABLE event_replay_anchor (
      analysis_run_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      anchor_type TEXT NOT NULL,
      anchor_at TEXT NOT NULL,
      anchor_date TEXT NOT NULL
    ) STRICT;
    CREATE TABLE event_replay_metric (
      analysis_run_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      anchor_type TEXT NOT NULL,
      offset_days INTEGER NOT NULL,
      metric_date TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL,
      status TEXT NOT NULL,
      reason TEXT
    ) STRICT;
    CREATE TABLE shock_candidate (
      analysis_run_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      value REAL NOT NULL,
      robust_z REAL NOT NULL,
      severity REAL NOT NULL,
      detector_version TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare("INSERT INTO dataset_snapshot VALUES ('ds1', '2026-10-01T00:00:00Z')").run();
  db.prepare("INSERT INTO analysis_run VALUES ('run1', 'ds1', 'v1', 'abc', '2026-10-01T01:00:00Z', 'SUCCEEDED')").run();
  db.prepare("INSERT INTO dataset_snapshot_cohort_definition VALUES ('ds1', 'SAMPLE_MARKET:x', 'SAMPLE_MARKET', 'PLAYER')").run();
  db.prepare("INSERT INTO analysis_metric VALUES ('run1', '2026-09-30', 'COHORT', 'SAMPLE_MARKET:x', 'INDEX', 101.2, 'OK', 1)").run();
  db.prepare("INSERT INTO event VALUES ('e1', '테스트 이벤트', 'UPDATE_NOTICE')").run();
  db.prepare("INSERT INTO event_replay_anchor VALUES ('run1', 'e1', 'ANNOUNCED', '2026-09-30T09:00:00Z', '2026-09-30')").run();
  db.prepare("INSERT INTO event_replay_metric VALUES ('run1', 'e1', 'ANNOUNCED', 0, '2026-09-30', 'SAMPLE_MARKET:x', 'INDEX', 101.2, 'OK', NULL)").run();
  db.prepare("INSERT INTO shock_candidate VALUES ('run1', '2026-09-30', 'SAMPLE_MARKET:x', 0.12, 4.2, 4.2, 'robust-z-v1')").run();
  return db;
}

test("loads a complete viewer payload from a successful analysis run", () => {
  const db = fixture();
  try {
    assert.equal(listViewerRuns(db).length, 1);
    const payload = loadViewerPayload(db);
    assert.equal(payload.run.analysis_run_id, "run1");
    assert.deepEqual({ ...payload.cohorts[0] }, {
      cohort_id: "SAMPLE_MARKET:x",
      name: "SAMPLE_MARKET",
      aggregation_level: "PLAYER",
    });
    assert.equal(payload.metrics.length, 1);
    assert.equal(payload.events[0]?.title, "테스트 이벤트");
    assert.equal(payload.replay.length, 1);
    assert.equal(payload.shocks[0]?.robust_z, 4.2);
  } finally {
    db.close();
  }
});

test("rejects an unknown requested run", () => {
  const db = fixture();
  try {
    assert.throws(() => loadViewerPayload(db, "missing"), /not available for viewing/);
  } finally {
    db.close();
  }
});
