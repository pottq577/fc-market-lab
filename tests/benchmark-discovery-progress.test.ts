import assert from "node:assert/strict";
import test from "node:test";

import { collectBenchmarkDiscoveryBatch } from "../src/benchmark/discovery-collection.ts";
import type {
  BenchmarkDiscoveryTargetDocument,
  BenchmarkGate1AResult,
} from "../src/benchmark/gate1a.ts";

const targets: BenchmarkDiscoveryTargetDocument = {
  schema_version: 1,
  discovery_frame_id: "frame-1",
  universe_snapshot_id: "universe-1",
  universe_as_of: "2026-10-01T00:00:00.000Z",
  from_rank: 101,
  to_rank: 102,
  targets: [101, 102].map((rank) => ({
    sample_rank: rank,
    player_id: `pid:${rank}`,
    player_name: `선수 ${rank}`,
    spid: `851000${rank}`,
    grade: 1,
  })),
};

const gate: BenchmarkGate1AResult = {
  status: "READY_OPERATOR_BATCH",
  discovery_frame_id: "frame-1",
  universe_snapshot_id: "universe-1",
  batch_size: 2,
  rank_range: [101, 102],
  source_id: "fconline-datacenter-price-history",
  automation_decision: "MANUAL_ONLY",
  price_semantics: "MARKET_REFERENCE_PRICE",
  native_granularity: "P1D",
  policy_checked_at: "2026-09-29T07:20:00.000Z",
  policy_age_days: 2,
  evidence_hash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  blockers: [],
};

test("discovery collection emits progress after each target", async () => {
  const progress: Array<[number, number, string]> = [];
  await collectBenchmarkDiscoveryBatch(targets, gate, {
    delayMs: 1000,
    sleep: async () => undefined,
    collectTarget: async (target) => ({
      target,
      observed_at: "2026-10-02T00:00:00.000Z",
      raw_path: `/raw/${target.spid}.html`,
      metadata_path: `/raw/${target.spid}.json`,
      raw_sha256:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      point_count: 365,
      native_granularity: "P1D",
      history_span: "365_POINTS_364D_SPAN",
    }),
    onProgress: ({ index, total, result }) => {
      progress.push([index, total, result.status]);
    },
  });

  assert.deepEqual(progress, [
    [1, 2, "COLLECTED"],
    [2, 2, "COLLECTED"],
  ]);
});
