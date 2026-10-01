import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { seedAcceptanceTargets } from "../src/acceptance/target-seeding.ts";
import type { ResolvedAcceptanceTargetDocument } from "../src/catalog/acceptance-targets.ts";

function dbFixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE player_card (
      spid TEXT PRIMARY KEY,
      player_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE instrument (
      instrument_id TEXT PRIMARY KEY,
      spid TEXT NOT NULL,
      grade INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE card_relation (
      relation_id TEXT PRIMARY KEY,
      source_instrument TEXT NOT NULL,
      target_instrument TEXT NOT NULL,
      same_player INTEGER NOT NULL,
      same_position INTEGER NOT NULL,
      relation_source TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT
    ) STRICT;
    CREATE TABLE relation_snapshot (
      relation_id TEXT NOT NULL,
      as_of TEXT NOT NULL,
      shared_team_colors_json TEXT NOT NULL,
      salary_diff INTEGER,
      ovr_diff INTEGER,
      stat_distance REAL,
      price_ratio REAL,
      usage_distance REAL,
      movement_similarity REAL,
      definition_version TEXT NOT NULL,
      PRIMARY KEY (relation_id, as_of)
    ) STRICT;
    CREATE TABLE cohort_definition (
      cohort_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      aggregation_level TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      rule_params_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE cohort_membership (
      cohort_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      membership_source TEXT NOT NULL,
      confidence REAL NOT NULL,
      PRIMARY KEY (cohort_id, instrument_id, valid_from)
    ) STRICT;
    CREATE TABLE product (
      product_id TEXT PRIMARY KEY,
      sale_start TEXT NOT NULL,
      sale_end TEXT
    ) STRICT;
    CREATE TABLE exposure (
      exposure_id TEXT PRIMARY KEY,
      event_id TEXT,
      product_id TEXT,
      instrument_id TEXT NOT NULL,
      exposure_type TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      source TEXT NOT NULL,
      confidence REAL NOT NULL
    ) STRICT;
  `);
  db.prepare("INSERT INTO product VALUES (?, ?, ?)").run(
    "sss-mortar-top-price-730-pre-fix",
    "2026-09-17T02:15:00.000Z",
    "2026-09-17T03:33:00.000Z",
  );
  db.prepare("INSERT INTO product VALUES (?, ?, ?)").run(
    "sss-mortar-top-price-730-post-fix",
    "2026-09-17T04:07:00.000Z",
    "2026-09-17T15:00:00.000Z",
  );
  return db;
}

const targets: ResolvedAcceptanceTargetDocument = {
  schema_version: 1,
  catalog_id: "acceptance-test",
  resolved_at: "2026-10-01T05:00:00.000Z",
  targets: [
    {
      target_id: "pack-a",
      player_key: "a",
      player_name: "A",
      season: "26FSL",
      grade: 11,
      spid: "868000001",
      valid_from: "2026-09-17T11:15:00+09:00",
      roles: ["PACK_EXPOSED", "PREMIUM_SCARCE"],
      evidence_urls: ["https://example.com/a"],
    },
    {
      target_id: "regime-b",
      player_key: "b",
      player_name: "B",
      season: "26TOTS",
      grade: 11,
      spid: "900000002",
      valid_from: "2026-09-10T15:30:00+09:00",
      roles: ["SAME_PLAYER", "REGIME_TARGET", "PREMIUM_SCARCE"],
      evidence_urls: ["https://example.com/b"],
    },
  ],
};

test("seeds premium membership and direct SSS exposure idempotently", () => {
  const db = dbFixture();
  try {
    for (const target of targets.targets) {
      db.prepare("INSERT INTO player_card VALUES (?, ?)").run(target.spid, target.player_key);
      db.prepare("INSERT INTO instrument VALUES (?, ?, ?)").run(
        `${target.spid}:${target.grade}`,
        target.spid,
        target.grade,
      );
    }
    db.prepare("INSERT INTO player_card VALUES ('800000002', 'b')").run();
    db.prepare("INSERT INTO instrument VALUES ('800000002:1', '800000002', 1)").run();
    const first = seedAcceptanceTargets(db, targets);
    const second = seedAcceptanceTargets(db, targets);
    assert.deepEqual(first, {
      premium_memberships_created: 2,
      direct_exposures_created: 2,
      same_player_relations_created: 1,
      relation_snapshots_created: 1,
    });
    assert.deepEqual(second, {
      premium_memberships_created: 0,
      direct_exposures_created: 0,
      same_player_relations_created: 0,
      relation_snapshots_created: 0,
    });
    assert.equal(
      Number((db.prepare("SELECT COUNT(*) AS count FROM cohort_membership").get() as { count: number }).count),
      2,
    );
    assert.equal(
      Number((db.prepare("SELECT COUNT(*) AS count FROM exposure").get() as { count: number }).count),
      2,
    );
    assert.equal(
      Number((db.prepare("SELECT COUNT(*) AS count FROM card_relation").get() as { count: number }).count),
      1,
    );
  } finally {
    db.close();
  }
});
