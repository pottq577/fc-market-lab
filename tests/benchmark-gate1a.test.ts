import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  evaluateBenchmarkGate1A,
  parseBenchmarkDiscoveryTargetDocument,
} from "../src/benchmark/gate1a.ts";
import type { SourceViabilityDocument } from "../src/gates/source-viability.ts";

function fixtureDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE benchmark_discovery_frame (
      discovery_frame_id TEXT PRIMARY KEY,
      universe_snapshot_id TEXT NOT NULL,
      target_size INTEGER NOT NULL,
      probe_grade INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_discovery_member (
      discovery_frame_id TEXT NOT NULL,
      sample_rank INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      probe_spid TEXT NOT NULL,
      probe_grade INTEGER NOT NULL
    ) STRICT;
  `);
  db.prepare(
    `INSERT INTO benchmark_discovery_frame
      VALUES ('frame-1', 'universe-1', 1600, 1)`,
  ).run();
  for (let rank = 1; rank <= 2; rank += 1) {
    db.prepare(
      `INSERT INTO benchmark_discovery_member
       VALUES ('frame-1', ?, ?, ?, ?, 1)`,
    ).run(
      rank,
      `pid:${String(rank).padStart(6, "0")}`,
      `선수 ${rank}`,
      `851${String(rank).padStart(6, "0")}`,
    );
  }
  return db;
}

function targets() {
  return parseBenchmarkDiscoveryTargetDocument({
    schema_version: 1,
    discovery_frame_id: "frame-1",
    universe_snapshot_id: "universe-1",
    universe_as_of: "2026-10-01T00:00:00.000Z",
    from_rank: 1,
    to_rank: 2,
    targets: [
      {
        sample_rank: 1,
        player_id: "pid:000001",
        player_name: "선수 1",
        spid: "851000001",
        grade: 1,
      },
      {
        sample_rank: 2,
        player_id: "pid:000002",
        player_name: "선수 2",
        spid: "851000002",
        grade: 1,
      },
    ],
  });
}

function evidence(
  checkedAt = "2026-09-29T16:20:00+09:00",
): SourceViabilityDocument {
  return {
    schema_version: 1,
    evidence: [
      {
        source_id: "fconline-datacenter-price-history",
        purpose: "PRICE_HISTORY",
        source_url: "https://fconline.nexon.com/DataCenter/PlayerInfo",
        policy_url: "https://member.nexon.com/policy/policywrapper.aspx?policyType=12",
        policy_checked_at: checkedAt,
        access_method: "OFFICIAL_WEB_UI_MANUAL_CAPTURE",
        native_granularity: "P1D",
        history_span: "365_POINTS_364D_SPAN",
        price_semantics: "MARKET_REFERENCE_PRICE",
        automation_decision: "MANUAL_ONLY",
        decision_reason: "fixture",
        evidence_hash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
  };
}

test("Gate 1A preserves MANUAL_ONLY while allowing an operator batch", () => {
  const db = fixtureDb();
  try {
    const result = evaluateBenchmarkGate1A(db, targets(), evidence(), {
      asOf: "2026-10-02T00:00:00.000Z",
    });
    assert.equal(result.status, "READY_OPERATOR_BATCH");
    assert.equal(result.automation_decision, "MANUAL_ONLY");
    assert.equal(result.batch_size, 2);
    assert.deepEqual(result.blockers, []);
  } finally {
    db.close();
  }
});

test("Gate 1A blocks stale policy evidence", () => {
  const db = fixtureDb();
  try {
    const result = evaluateBenchmarkGate1A(
      db,
      targets(),
      evidence("2026-08-01T00:00:00+09:00"),
      { asOf: "2026-10-02T00:00:00.000Z" },
    );
    assert.equal(result.status, "BLOCKED");
    assert.match(result.blockers.join("\n"), /policy evidence age/);
  } finally {
    db.close();
  }
});

test("Gate 1A rejects a target manifest that drifts from the frozen frame", () => {
  const db = fixtureDb();
  try {
    const document = targets();
    document.targets[0]!.spid = "851999999";
    assert.throws(
      () =>
        evaluateBenchmarkGate1A(db, document, evidence(), {
          asOf: "2026-10-02T00:00:00.000Z",
        }),
      /does not match frozen discovery frame membership/,
    );
  } finally {
    db.close();
  }
});
