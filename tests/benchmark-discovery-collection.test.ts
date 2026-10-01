import assert from "node:assert/strict";
import test from "node:test";

import {
  collectBenchmarkDiscoveryBatch,
} from "../src/benchmark/discovery-collection.ts";
import type {
  BenchmarkDiscoveryTargetDocument,
  BenchmarkGate1AResult,
} from "../src/benchmark/gate1a.ts";
import { CollectionHaltedError } from "../src/collect/datacenter-price.ts";

const document: BenchmarkDiscoveryTargetDocument = {
  schema_version: 1,
  discovery_frame_id: "frame-1",
  universe_snapshot_id: "universe-1",
  universe_as_of: "2026-10-01T00:00:00.000Z",
  from_rank: 1,
  to_rank: 3,
  targets: [1, 2, 3].map((rank) => ({
    sample_rank: rank,
    player_id: `pid:${String(rank).padStart(6, "0")}`,
    player_name: `선수 ${rank}`,
    spid: `851${String(rank).padStart(6, "0")}`,
    grade: 1,
  })),
};

const gate: BenchmarkGate1AResult = {
  status: "READY_OPERATOR_BATCH",
  discovery_frame_id: "frame-1",
  universe_snapshot_id: "universe-1",
  batch_size: 3,
  rank_range: [1, 3],
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

function collected(spid: string) {
  return {
    target: { spid, grade: 1 },
    observed_at: "2026-10-02T00:00:00.000Z",
    raw_path: `/raw/${spid}.html`,
    metadata_path: `/raw/${spid}.json`,
    raw_sha256:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    point_count: 365,
    native_granularity: "P1D",
    history_span: "365_POINTS_364D_SPAN",
  };
}

test("discovery collection continues after an ordinary target failure", async () => {
  const calls: string[] = [];
  const batch = await collectBenchmarkDiscoveryBatch(document, gate, {
    delayMs: 1000,
    sleep: async () => undefined,
    collectTarget: async (target) => {
      calls.push(target.spid);
      if (target.spid === "851000002") throw new Error("parse failed");
      return collected(target.spid);
    },
  });

  assert.deepEqual(calls, ["851000001", "851000002", "851000003"]);
  assert.equal(batch.status, "PARTIAL");
  assert.deepEqual(
    batch.results.map((item) => item.status),
    ["COLLECTED", "FAILED", "COLLECTED"],
  );
});

test("discovery collection stops immediately on 403/429 style halt", async () => {
  const calls: string[] = [];
  const batch = await collectBenchmarkDiscoveryBatch(document, gate, {
    delayMs: 1000,
    sleep: async () => undefined,
    collectTarget: async (target) => {
      calls.push(target.spid);
      if (target.spid === "851000002") {
        throw new CollectionHaltedError(429, "rate limited");
      }
      return collected(target.spid);
    },
  });

  assert.deepEqual(calls, ["851000001", "851000002"]);
  assert.equal(batch.status, "HALTED");
  assert.deepEqual(
    batch.results.map((item) => item.status),
    ["COLLECTED", "HALTED"],
  );
});
