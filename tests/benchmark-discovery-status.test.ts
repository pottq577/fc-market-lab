import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  benchmarkDiscoveryStatus,
  nextBenchmarkDiscoveryTargetDocument,
} from "../src/benchmark/discovery-status.ts";

function fixtureDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE market_universe_snapshot (
      universe_snapshot_id TEXT PRIMARY KEY,
      as_of TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_discovery_frame (
      discovery_frame_id TEXT PRIMARY KEY,
      universe_snapshot_id TEXT NOT NULL,
      target_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_discovery_member (
      discovery_frame_id TEXT NOT NULL,
      sample_rank INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      probe_spid TEXT NOT NULL,
      probe_grade INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE instrument (
      instrument_id TEXT PRIMARY KEY,
      spid TEXT NOT NULL,
      grade INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE source_snapshot (
      source_snapshot_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      capture_method TEXT NOT NULL,
      parse_status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE price_point (
      source_snapshot_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_discovery_outcome (
      discovery_frame_id TEXT NOT NULL,
      sample_rank INTEGER NOT NULL,
      outcome TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare(
    "INSERT INTO market_universe_snapshot VALUES ('universe-1', '2026-10-01T00:00:00.000Z')",
  ).run();
  db.prepare(
    "INSERT INTO benchmark_discovery_frame VALUES ('frame-1', 'universe-1', 6, '2026-10-02T00:00:00.000Z')",
  ).run();
  for (let rank = 1; rank <= 6; rank += 1) {
    db.prepare(
      "INSERT INTO benchmark_discovery_member VALUES ('frame-1', ?, ?, ?, ?, 1)",
    ).run(
      rank,
      `pid:${String(rank).padStart(6, "0")}`,
      `선수 ${rank}`,
      `851${String(rank).padStart(6, "0")}`,
    );
  }
  return db;
}

function markIngested(db: DatabaseSync, rank: number): void {
  const spid = `851${String(rank).padStart(6, "0")}`;
  const instrumentId = `${spid}:1`;
  const sourceId = `source-${rank}`;
  db.prepare("INSERT INTO instrument VALUES (?, ?, 1)").run(instrumentId, spid);
  db.prepare(
    `INSERT INTO source_snapshot VALUES (
      ?, 'fconline-datacenter-price-history', ?,
      'OFFICIAL_WEB_UI_OPERATOR_BATCH', 'PARSED'
    )`,
  ).run(sourceId, instrumentId);
  db.prepare("INSERT INTO price_point VALUES (?, ?)").run(sourceId, instrumentId);
}

function markTerminal(
  db: DatabaseSync,
  rank: number,
  outcome: "NO_USABLE_PRICE" | "FETCH_FAILED",
): void {
  db.prepare(
    "INSERT INTO benchmark_discovery_outcome VALUES ('frame-1', ?, ?)",
  ).run(rank, outcome);
}

test("status plans the next contiguous pending range without recollecting ingested ranks", () => {
  const db = fixtureDb();
  try {
    markIngested(db, 1);
    markIngested(db, 2);
    markIngested(db, 4);

    const first = benchmarkDiscoveryStatus(db, "frame-1", { batchSize: 2 });
    assert.equal(first.ingested_count, 3);
    assert.equal(first.contiguous_completed_rank, 2);
    assert.deepEqual(first.next_rank_range, [3, 3]);

    markIngested(db, 3);
    const second = benchmarkDiscoveryStatus(db, "frame-1", { batchSize: 2 });
    assert.equal(second.contiguous_completed_rank, 4);
    assert.deepEqual(second.next_rank_range, [5, 6]);

    const next = nextBenchmarkDiscoveryTargetDocument(db, "frame-1", {
      batchSize: 2,
    });
    assert.deepEqual(
      next?.targets.map((target) => target.sample_rank),
      [5, 6],
    );
    assert.equal(next?.universe_as_of, "2026-10-01T00:00:00.000Z");
  } finally {
    db.close();
  }
});


test("terminal nonresponses advance discovery without inflating response coverage", () => {
  const db = fixtureDb();
  try {
    markIngested(db, 1);
    markIngested(db, 2);
    markIngested(db, 4);
    markTerminal(db, 3, "NO_USABLE_PRICE");
    markTerminal(db, 5, "FETCH_FAILED");

    const status = benchmarkDiscoveryStatus(db, "frame-1", { batchSize: 2 });
    assert.equal(status.attempted_count, 5);
    assert.equal(status.observed_count, 3);
    assert.equal(status.no_usable_price_count, 1);
    assert.equal(status.failed_count, 1);
    assert.equal(status.pending_count, 1);
    assert.equal(status.completion_ratio, 0.833333);
    assert.equal(status.response_coverage, 0.5);
    assert.equal(status.readiness, "IN_PROGRESS");
    assert.equal(status.contiguous_completed_rank, 5);
    assert.deepEqual(status.next_rank_range, [6, 6]);

    markIngested(db, 6);
    const complete = benchmarkDiscoveryStatus(db, "frame-1", { batchSize: 2 });
    assert.equal(complete.attempted_count, 6);
    assert.equal(complete.pending_count, 0);
    assert.equal(complete.response_coverage, 0.666667);
    assert.equal(complete.readiness, "INSUFFICIENT_DISCOVERY_COVERAGE");
    assert.equal(complete.next_rank_range, null);
  } finally {
    db.close();
  }
});
