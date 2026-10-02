import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { publishBenchmarkRun } from "../src/benchmark/publication.ts";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE dataset_snapshot (
      dataset_snapshot_id TEXT PRIMARY KEY,
      catalog_id TEXT NOT NULL,
      analysis_cutoff TEXT NOT NULL,
      created_at TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      catalog_hash TEXT NOT NULL,
      input_hash TEXT NOT NULL UNIQUE
    ) STRICT;
    CREATE TABLE dataset_snapshot_source (
      dataset_snapshot_id TEXT NOT NULL,
      source_snapshot_id TEXT NOT NULL,
      source_role TEXT NOT NULL,
      PRIMARY KEY (dataset_snapshot_id, source_snapshot_id, source_role)
    ) STRICT;
    CREATE TABLE dataset_snapshot_price_point (
      dataset_snapshot_id TEXT NOT NULL,
      source_snapshot_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      source_timestamp TEXT NOT NULL,
      PRIMARY KEY (dataset_snapshot_id, source_snapshot_id, instrument_id, source_timestamp)
    ) STRICT;
    CREATE TABLE analysis_run (
      analysis_run_id TEXT PRIMARY KEY,
      dataset_snapshot_id TEXT NOT NULL,
      analysis_version TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      parameter_hash TEXT NOT NULL,
      code_commit TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL,
      result_hash TEXT,
      UNIQUE (dataset_snapshot_id, analysis_version, parameter_hash, code_commit)
    ) STRICT;
    CREATE TABLE dataset_snapshot_benchmark (
      dataset_snapshot_id TEXT PRIMARY KEY,
      benchmark_convergence_run_id TEXT NOT NULL UNIQUE,
      benchmark_uncertainty_run_id TEXT NOT NULL,
      benchmark_metric_run_id TEXT NOT NULL,
      panel_family_id TEXT NOT NULL,
      universe_snapshot_id TEXT NOT NULL,
      display_panel_id TEXT NOT NULL,
      display_role TEXT NOT NULL,
      benchmark_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_convergence_run (
      benchmark_convergence_run_id TEXT PRIMARY KEY,
      benchmark_uncertainty_run_id TEXT NOT NULL,
      benchmark_metric_run_id TEXT NOT NULL,
      panel_family_id TEXT NOT NULL,
      benchmark_status TEXT NOT NULL,
      selected_panel_id TEXT,
      input_hash TEXT NOT NULL,
      result_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_metric_run (
      benchmark_metric_run_id TEXT PRIMARY KEY,
      analysis_cutoff TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      result_hash TEXT NOT NULL,
      status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_panel_family (
      panel_family_id TEXT PRIMARY KEY,
      universe_snapshot_id TEXT NOT NULL,
      panel_version TEXT NOT NULL,
      sample_seed TEXT NOT NULL,
      effective_from TEXT NOT NULL
    ) STRICT;
    CREATE TABLE market_universe_snapshot (
      universe_snapshot_id TEXT PRIMARY KEY,
      source_hash TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_panel (
      panel_id TEXT PRIMARY KEY,
      panel_family_id TEXT NOT NULL,
      panel_label TEXT NOT NULL,
      panel_size INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_panel_member (
      panel_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      anchor_instrument_id TEXT NOT NULL,
      stratum_id TEXT NOT NULL,
      population_weight REAL NOT NULL,
      admission_rank INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_metric_input_price (
      benchmark_metric_run_id TEXT NOT NULL,
      source_snapshot_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      source_timestamp TEXT NOT NULL
    ) STRICT;
    CREATE TABLE market_universe_source (
      universe_snapshot_id TEXT NOT NULL,
      source_snapshot_id TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare("INSERT INTO benchmark_convergence_run VALUES ('conv','unc','metric','family','UNSTABLE',NULL,'sha256:conv-input','sha256:conv-result','SUCCEEDED','2026-10-02T02:10:00.000Z')").run();
  db.prepare("INSERT INTO benchmark_metric_run VALUES ('metric','2026-10-02T02:00:00.000Z','sha256:metric-input','sha256:metric-result','SUCCEEDED')").run();
  db.prepare("INSERT INTO benchmark_panel_family VALUES ('family','universe','panel-v1','seed','2026-10-02T00:00:00.000Z')").run();
  db.prepare("INSERT INTO market_universe_snapshot VALUES ('universe','sha256:universe')").run();
  db.prepare("INSERT INTO benchmark_panel VALUES ('p100','family','P100',100)").run();
  db.prepare("INSERT INTO benchmark_panel VALUES ('p800','family','P800',800)").run();
  db.prepare("INSERT INTO benchmark_panel_member VALUES ('p100','a','a:1','P00_50',1,1)").run();
  db.prepare("INSERT INTO benchmark_panel_member VALUES ('p800','a','a:1','P00_50',1,1)").run();
  db.prepare("INSERT INTO benchmark_metric_input_price VALUES ('metric','price-source','a:1','2026-10-01T00:00:00.000Z')").run();
  db.prepare("INSERT INTO market_universe_source VALUES ('universe','meta-source')").run();
  return db;
}

test("publishes a deterministic benchmark dataset and analysis run", () => {
  const db = fixture();
  try {
    const first = publishBenchmarkRun(db, {
      benchmarkConvergenceRunId: "conv",
      codeCommit: "57cfd37fc9446a39a156412fdbf598e8db29b27b",
      schemaVersion: 17,
      createdAt: "2026-10-02T02:20:00.000Z",
    });
    const second = publishBenchmarkRun(db, {
      benchmarkConvergenceRunId: "conv",
      codeCommit: "57cfd37fc9446a39a156412fdbf598e8db29b27b",
      schemaVersion: 17,
      createdAt: "2026-10-02T02:21:00.000Z",
    });
    assert.equal(first.dataset_snapshot_id, second.dataset_snapshot_id);
    assert.equal(first.analysis_run_id, second.analysis_run_id);
    assert.equal(first.dataset_created, true);
    assert.equal(first.analysis_run_created, true);
    assert.equal(first.publication_created, true);
    assert.equal(second.dataset_created, false);
    assert.equal(second.analysis_run_created, false);
    assert.equal(second.publication_created, false);
    const third = publishBenchmarkRun(db, {
      benchmarkConvergenceRunId: "conv",
      codeCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      schemaVersion: 17,
      createdAt: "2026-10-02T02:22:00.000Z",
    });
    assert.equal(third.dataset_snapshot_id, first.dataset_snapshot_id);
    assert.notEqual(third.analysis_run_id, first.analysis_run_id);
    assert.equal(third.dataset_created, false);
    assert.equal(third.analysis_run_created, true);
    assert.equal(third.publication_created, false);
    assert.equal(
      Number((db.prepare("SELECT COUNT(*) AS count FROM analysis_run").get() as {count:number|bigint}).count),
      2,
    );
    assert.equal(first.display_panel_id, "p800");
    assert.equal(first.display_role, "DIAGNOSTIC_LARGEST");
    assert.equal(first.frozen_price_points, 1);
    assert.equal(
      Number((db.prepare("SELECT COUNT(*) AS count FROM dataset_snapshot_price_point").get() as {count:number|bigint}).count),
      1,
    );
  } finally {
    db.close();
  }
});
