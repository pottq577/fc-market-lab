import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runEventReplay } from "../src/analysis/event-replay.ts";
function fixture(): DatabaseSync {
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
    CREATE TABLE event (
      event_id TEXT PRIMARY KEY,
      announced_at TEXT,
      effective_at TEXT,
      first_observed_at TEXT
    ) STRICT;
    CREATE TABLE dataset_snapshot_event (
      dataset_snapshot_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      PRIMARY KEY (dataset_snapshot_id, event_id)
    ) STRICT;
    CREATE TABLE dataset_snapshot_cohort_definition (
      dataset_snapshot_id TEXT NOT NULL,
      cohort_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (dataset_snapshot_id, cohort_id)
    ) STRICT;
    CREATE TABLE analysis_metric (
      analysis_run_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      value REAL,
      status TEXT NOT NULL,
      PRIMARY KEY (analysis_run_id, metric_date, scope_type, scope_id, metric_name)
    ) STRICT;
    CREATE TABLE dataset_snapshot_relation_history (
      dataset_snapshot_id TEXT NOT NULL,
      relation_id TEXT NOT NULL,
      relation_as_of TEXT NOT NULL,
      relation_valid_from TEXT NOT NULL,
      relation_valid_to TEXT,
      PRIMARY KEY (dataset_snapshot_id, relation_id, relation_as_of)
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
    CREATE TABLE dataset_snapshot_usage_history (
      dataset_snapshot_id TEXT NOT NULL,
      usage_point_id TEXT NOT NULL,
      spid TEXT,
      instrument_id TEXT,
      usage_as_of TEXT NOT NULL,
      PRIMARY KEY (dataset_snapshot_id, usage_point_id)
    ) STRICT;
    CREATE TABLE event_replay_run (
      analysis_run_id TEXT PRIMARY KEY,
      replay_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      result_hash TEXT NOT NULL
    ) STRICT;
    CREATE TABLE event_replay_anchor (
      analysis_run_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      anchor_type TEXT NOT NULL,
      anchor_at TEXT NOT NULL,
      anchor_date TEXT NOT NULL,
      details_json TEXT NOT NULL,
      PRIMARY KEY (analysis_run_id, event_id, anchor_type)
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
      reason TEXT,
      PRIMARY KEY (analysis_run_id, event_id, anchor_type, offset_days, scope_id, metric_name)
    ) STRICT;
  `);
  db.prepare("INSERT INTO dataset_snapshot VALUES ('ds', '2026-10-03T00:00:00.000Z', 7)").run();
  db.prepare("INSERT INTO analysis_run VALUES ('run', 'ds', ?, 'SUCCEEDED', 'sha256:metrics')")
    .run(JSON.stringify({
      timezone: "Asia/Seoul",
      price_semantics: "MARKET_REFERENCE_PRICE",
      sample_market: { min_valid_count: 2, min_coverage_ratio: 0.6 },
      cross_player_cohort: { min_valid_count: 2, min_coverage_ratio: 0.6 },
    }));
  db.prepare("INSERT INTO dataset_snapshot_cohort_definition VALUES ('ds', 'SAMPLE_MARKET:test', 'SAMPLE_MARKET')").run();
  db.prepare("INSERT INTO dataset_snapshot_cohort_definition VALUES ('ds', 'META:test', 'META')").run();
  db.prepare(
    `INSERT INTO event VALUES (
      'event-1', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z', NULL
    )`,
  ).run();
  db.prepare("INSERT INTO dataset_snapshot_event VALUES ('ds', 'event-1')").run();
  for (const date of ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]) {
    db.prepare(
      `INSERT INTO analysis_metric VALUES (
        'run', ?, 'COHORT', 'SAMPLE_MARKET:test', 'RETURN_1D', 0.01, 'OK'
      )`,
    ).run(date);
  }
  db.prepare(
    "INSERT INTO dataset_snapshot_relation_history VALUES ('ds', 'rel-old', '2026-09-30T00:00:00.000Z', '2026-09-01T00:00:00.000Z', NULL)",
  ).run();
  db.prepare(
    "INSERT INTO dataset_snapshot_relation_history VALUES ('ds', 'rel-future', '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z', NULL)",
  ).run();
  db.prepare(
    `INSERT INTO dataset_snapshot_cohort_membership VALUES (
      'ds', 'META:test', '100:1', '2026-09-30T00:00:00.000Z', NULL, 'old', 1
    )`,
  ).run();
  db.prepare(
    `INSERT INTO dataset_snapshot_cohort_membership VALUES (
      'ds', 'META:test', '200:1', '2026-10-02T00:00:00.000Z', NULL, 'future', 1
    )`,
  ).run();
  db.prepare(
    `INSERT INTO dataset_snapshot_usage_history VALUES (
      'ds', 'usage-old', '100', NULL, '2026-09-30T00:00:00.000Z'
    )`,
  ).run();
  db.prepare(
    `INSERT INTO dataset_snapshot_usage_history VALUES (
      'ds', 'usage-future', '100', NULL, '2026-10-02T00:00:00.000Z'
    )`,
  ).run();
  return db;
}
test("separates announced/effective anchors and blocks future replay context", () => {
  const db = fixture();
  try {
    const first = runEventReplay(db, "run");
    const second = runEventReplay(db, "run");
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.result_hash, second.result_hash);
    assert.equal(first.anchors, 2);
    const announced = db.prepare(
      `SELECT details_json FROM event_replay_anchor
       WHERE analysis_run_id = 'run' AND event_id = 'event-1' AND anchor_type = 'ANNOUNCED'`,
    ).get() as { details_json: string };
    const details = JSON.parse(announced.details_json) as {
      relation_keys: string[];
      cohort_membership_keys: string[];
      usage_point_ids: string[];
    };
    assert.deepEqual(details.relation_keys, ["rel-old:2026-09-30T00:00:00.000Z"]);
    assert.deepEqual(details.cohort_membership_keys, ["META:test:100:1:2026-09-30T00:00:00.000Z"]);
    assert.deepEqual(details.usage_point_ids, ["usage-old"]);
    const cutoff = db.prepare(
      `SELECT status, reason FROM event_replay_metric
       WHERE analysis_run_id = 'run'
         AND event_id = 'event-1'
         AND anchor_type = 'ANNOUNCED'
         AND offset_days = 7
         AND scope_id = 'SAMPLE_MARKET:test'
         AND metric_name = 'RETURN_1D'`,
    ).get();
    assert.deepEqual({ ...cutoff }, { status: "NO_RESULT", reason: "ANALYSIS_CUTOFF" });
  } finally {
    db.close();
  }
});
