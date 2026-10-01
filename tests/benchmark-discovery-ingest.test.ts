import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { BenchmarkDiscoveryBatchDocument } from "../src/benchmark/discovery-collection.ts";
import { ingestBenchmarkDiscoveryBatch } from "../src/benchmark/discovery-ingest.ts";
import { openMarketDatabase } from "../src/db/market-db.ts";

const raw = Buffer.from(`
<script>
var json1 = {
  "time": ["10.1", "10.2",],
  "value": ["1000000", "1100000",],
}
</script>
`);
const rawHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;

function fixtureDb() {
  const db = openMarketDatabase(":memory:");
  db.prepare(
    `INSERT INTO benchmark_discovery_frame(
      discovery_frame_id, universe_snapshot_id, frame_version,
      sample_seed, target_size, population_count, probe_grade,
      inclusion_probability, population_weight, created_at
    ) VALUES ('frame-1', 'universe-1', 'v1', 'seed', 2, 10, 1,
      0.2, 5, '2026-10-01T00:00:00.000Z')`,
  ).run();
  for (const rank of [1, 2]) {
    db.prepare(
      `INSERT INTO benchmark_discovery_member(
        discovery_frame_id, sample_rank, player_id, player_name,
        probe_spid, probe_season_id, probe_season_name, probe_grade,
        selection_hash, card_selection_hash,
        inclusion_probability, population_weight
      ) VALUES ('frame-1', ?, ?, ?, ?, 851, '26TOTS', 1,
        ?, ?, 0.2, 5)`,
    ).run(
      rank,
      `pid:${String(rank).padStart(6, "0")}`,
      `선수 ${rank}`,
      `851${String(rank).padStart(6, "0")}`,
      `player-hash-${rank}`,
      `card-hash-${rank}`,
    );
  }

  db.prepare("INSERT INTO player VALUES ('legacy-player', '선수 1')").run();
  db.prepare(
    "INSERT INTO player_card VALUES ('851000001', 'legacy-player', '26TOTS')",
  ).run();
  return db;
}

function batch(): BenchmarkDiscoveryBatchDocument {
  return {
    schema_version: 1,
    batch_id: "batch-1",
    discovery_frame_id: "frame-1",
    universe_snapshot_id: "universe-1",
    source_id: "fconline-datacenter-price-history",
    source_evidence_hash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    automation_decision: "MANUAL_ONLY",
    rank_range: [1, 2],
    started_at: "2026-10-02T08:00:00.000Z",
    completed_at: "2026-10-02T08:01:00.000Z",
    status: "PARTIAL",
    results: [
      {
        sample_rank: 1,
        player_id: "pid:000001",
        player_name: "선수 1",
        spid: "851000001",
        grade: 1,
        status: "COLLECTED",
        observed_at: "2026-10-02T08:00:00.000Z",
        raw_path: "memory://rank-1",
        metadata_path: "memory://rank-1-meta",
        raw_sha256: rawHash,
        point_count: 2,
        native_granularity: "P1D",
        history_span: "2_POINTS_1D_SPAN",
        error_message: null,
      },
      {
        sample_rank: 2,
        player_id: "pid:000002",
        player_name: "선수 2",
        spid: "851000002",
        grade: 1,
        status: "FAILED",
        observed_at: null,
        raw_path: null,
        metadata_path: null,
        raw_sha256: null,
        point_count: null,
        native_granularity: null,
        history_span: null,
        error_message: "fixture failure",
      },
    ],
  };
}

test("ingests collected probes idempotently and preserves existing player identity", async () => {
  const db = fixtureDb();
  try {
    const readRaw = async (path: string) => {
      assert.equal(path, "memory://rank-1");
      return raw;
    };
    const first = await ingestBenchmarkDiscoveryBatch(db, batch(), { readRaw });
    const second = await ingestBenchmarkDiscoveryBatch(db, batch(), { readRaw });

    assert.equal(first.collected_results, 1);
    assert.equal(first.failed_results, 1);
    assert.equal(first.source_snapshots_created, 1);
    assert.equal(first.price_points_inserted, 2);
    assert.equal(second.source_snapshots_created, 0);
    assert.equal(second.price_points_inserted, 0);

    const card = db
      .prepare("SELECT player_id FROM player_card WHERE spid = '851000001'")
      .get() as { player_id: string };
    assert.equal(card.player_id, "legacy-player");
    assert.ok(
      db
        .prepare("SELECT 1 FROM instrument WHERE instrument_id = '851000001:1'")
        .get(),
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS count FROM price_point WHERE instrument_id = '851000001:1'")
        .get()!.count,
      2,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) AS count FROM instrument WHERE instrument_id = '851000002:1'")
        .get()!.count,
      0,
    );
  } finally {
    db.close();
  }
});
