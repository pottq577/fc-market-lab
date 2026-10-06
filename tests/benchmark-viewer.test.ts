import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { loadBenchmarkViewerPayload } from "../src/viewer/benchmark-data.ts";
import { benchmarkViewerPage } from "../src/viewer/benchmark-page.ts";

function fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE dataset_snapshot_benchmark (
      dataset_snapshot_id TEXT PRIMARY KEY,
      benchmark_convergence_run_id TEXT NOT NULL,
      display_panel_id TEXT NOT NULL,
      display_role TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE analysis_run (
      analysis_run_id TEXT PRIMARY KEY,
      dataset_snapshot_id TEXT NOT NULL,
      analysis_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_convergence_run (
      benchmark_convergence_run_id TEXT PRIMARY KEY,
      benchmark_uncertainty_run_id TEXT NOT NULL,
      benchmark_metric_run_id TEXT NOT NULL,
      panel_family_id TEXT NOT NULL,
      convergence_version TEXT NOT NULL,
      benchmark_status TEXT NOT NULL,
      selected_panel_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_metric_run (
      benchmark_metric_run_id TEXT PRIMARY KEY,
      metric_version TEXT NOT NULL,
      analysis_cutoff TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_panel_family (
      panel_family_id TEXT PRIMARY KEY,
      universe_snapshot_id TEXT NOT NULL,
      panel_version TEXT NOT NULL,
      effective_from TEXT NOT NULL
    ) STRICT;
    CREATE TABLE market_universe_snapshot (
      universe_snapshot_id TEXT PRIMARY KEY,
      as_of TEXT NOT NULL,
      price_eligible_player_count INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_panel (
      panel_id TEXT PRIMARY KEY,
      panel_family_id TEXT NOT NULL,
      panel_label TEXT NOT NULL,
      panel_size INTEGER NOT NULL
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
      weighted_coverage REAL NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_metric_uncertainty (
      benchmark_uncertainty_run_id TEXT NOT NULL,
      panel_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      lower_value REAL,
      upper_value REAL,
      status TEXT NOT NULL,
      valid_replicates INTEGER NOT NULL,
      total_replicates INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE panel_convergence (
      benchmark_convergence_run_id TEXT NOT NULL,
      smaller_panel_id TEXT NOT NULL,
      larger_panel_id TEXT NOT NULL,
      smaller_panel_size INTEGER NOT NULL,
      larger_panel_size INTEGER NOT NULL,
      common_valid_return_days INTEGER NOT NULL,
      common_valid_breadth_days INTEGER NOT NULL,
      direction_compared_days INTEGER NOT NULL,
      return_median_abs_diff REAL,
      return_p95_abs_diff REAL,
      return_direction_match_ratio REAL,
      breadth_median_abs_diff REAL,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare("INSERT INTO dataset_snapshot_benchmark VALUES ('ds','conv','p800','DIAGNOSTIC_LARGEST','2026-10-02T03:00:00Z')").run();
  db.prepare("INSERT INTO analysis_run VALUES ('run','ds','market-benchmark-v1','2026-10-02T03:00:00Z','SUCCEEDED')").run();
  db.prepare("INSERT INTO benchmark_convergence_run VALUES ('conv','unc','metric','family','market-benchmark-convergence-v1','UNSTABLE',NULL,'SUCCEEDED','2026-10-02T02:30:00Z')").run();
  db.prepare("INSERT INTO benchmark_metric_run VALUES ('metric','market-benchmark-metrics-v1','2026-10-02T02:00:00Z')").run();
  db.prepare("INSERT INTO benchmark_panel_family VALUES ('family','universe','panel-v2','2026-10-02T00:00:00Z')").run();
  db.prepare("INSERT INTO market_universe_snapshot VALUES ('universe','2026-10-02T00:00:00Z',1200)").run();
  db.prepare("INSERT INTO benchmark_panel VALUES ('p400','family','P400',400)").run();
  db.prepare("INSERT INTO benchmark_panel VALUES ('p800','family','P800',800)").run();
  for (const [name, value] of [["RETURN_1D",0],["INDEX",100],["BREADTH",0.51],["IQR",0.02],["MAD",0.01]] as const) {
    db.prepare("INSERT INTO benchmark_metric VALUES ('metric','p800','2026-10-01','FIXED_PANEL_BACKCAST',?,?, 'OK',790,800,0.9875)").run(name,value);
    db.prepare("INSERT INTO benchmark_metric_uncertainty VALUES ('unc','p800','2026-10-01',?,?,?,'OK',1000,1000)").run(name, value - 0.001, value + 0.001);
  }
  db.prepare("INSERT INTO panel_convergence VALUES ('conv','p400','p800',400,800,364,364,0,0,0,NULL,0.00001,'INSUFFICIENT','{\"reasons\":[\"DIRECTION_COMPARABLE_DAYS\"]}')").run();
  return db;
}

test("loads published benchmark viewer data with reliability metadata", () => {
  const db = fixture();
  try {
    const payload = loadBenchmarkViewerPayload(db, "run");
    assert.ok(payload);
    assert.equal(payload.analysis_version, "market-benchmark-v1");
    assert.equal(payload.metric_version, "market-benchmark-metrics-v1");
    assert.equal(payload.return_aggregation, "WEIGHTED_MEDIAN_PLAYER_RETURN");
    assert.equal(payload.benchmark_status, "UNSTABLE");
    assert.equal(payload.display_panel_label, "P800");
    assert.equal(payload.display_role, "DIAGNOSTIC_LARGEST");
    assert.equal(payload.latest_metrics.length, 5);
    assert.equal(payload.latest_metrics[0]?.metric_name, "RETURN_1D");
    assert.equal(payload.latest_metrics[0]?.weighted_coverage, 0.9875);
    assert.equal(payload.history_metrics.length, 3);
    assert.deepEqual(
      payload.history_metrics.map((metric) => metric.metric_name),
      ["RETURN_1D", "INDEX", "BREADTH"],
    );
    assert.deepEqual(payload.convergence_pairs[0]?.reasons, ["DIRECTION_COMPARABLE_DAYS"]);
  } finally {
    db.close();
  }
});

test("default benchmark viewer prefers a published v2 run over a newer v1 run", () => {
  const db = fixture();
  try {
    db.prepare("INSERT INTO dataset_snapshot_benchmark VALUES ('ds-v2','conv','p800','DIAGNOSTIC_LARGEST','2026-10-02T04:00:00Z')").run();
    db.prepare("INSERT INTO analysis_run VALUES ('run-v2','ds-v2','market-benchmark-v2','2026-10-02T04:00:00Z','SUCCEEDED')").run();
    db.prepare("INSERT INTO dataset_snapshot_benchmark VALUES ('ds-v1-newer','conv','p800','DIAGNOSTIC_LARGEST','2026-10-02T05:00:00Z')").run();
    db.prepare("INSERT INTO analysis_run VALUES ('run-v1-newer','ds-v1-newer','market-benchmark-v1','2026-10-02T05:00:00Z','SUCCEEDED')").run();

    const payload = loadBenchmarkViewerPayload(db);
    assert.ok(payload);
    assert.equal(payload.analysis_run_id, "run-v2");
    assert.equal(payload.analysis_version, "market-benchmark-v2");
  } finally {
    db.close();
  }
});

test("benchmark page explains reliability in plain language and has valid inline JavaScript", () => {
  const html = benchmarkViewerPage();
  assert.match(html, /시장 대표지표/);
  assert.match(html, /대표값 확정 전/);
  assert.match(html, /현재 표본으로 과거 재계산/);
  assert.match(html, /시장 규모 가중 중앙값/);
  assert.match(html, /표본을 더 늘려도 같은 결론이 나오는가/);
  assert.doesNotMatch(html, /고급 지표/);
  assert.doesNotMatch(html, /legacy=1/);
  assert.doesNotMatch(html, /Nested panel convergence/);
  assert.doesNotMatch(html, /return aggregation/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
