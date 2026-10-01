import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openMarketDatabase } from "../src/db/market-db.ts";
import {
  buildMarketStructure,
  type StructureSeedCatalog,
} from "../src/normalize/market-structure.ts";

async function tempDb() {
  const directory = await mkdtemp(join(tmpdir(), "fc-market-structure-asof-"));
  return openMarketDatabase(join(directory, "market.db"));
}

const catalog: StructureSeedCatalog = {
  catalog_id: "staggered-metadata",
  frozen_at: "2026-09-29T00:00:00.000Z",
  seeds: [
    {
      player_key: "p1",
      primary_instrument: { spid: "100", grade: 1 },
      selection_observation: {
        ranker_squad_count: 100,
        displayed_share_percent: 10,
      },
    },
    {
      player_key: "p2",
      primary_instrument: { spid: "200", grade: 1 },
      selection_observation: {
        ranker_squad_count: 90,
        displayed_share_percent: 9,
      },
    },
  ],
};

function seedIdentity(
  db: ReturnType<typeof openMarketDatabase>,
  playerId: string,
  spid: string,
): void {
  db.prepare("INSERT INTO player(player_id, name) VALUES (?, ?)").run(
    playerId,
    playerId,
  );
  db.prepare(
    "INSERT INTO player_card(spid, player_id, season) VALUES (?, ?, 'PTG')",
  ).run(spid, playerId);
  db.prepare(
    "INSERT INTO instrument(instrument_id, spid, grade) VALUES (?, ?, 1)",
  ).run(`${spid}:1`, spid);
}

function insertFullMetadata(
  db: ReturnType<typeof openMarketDatabase>,
  input: {
    id: string;
    spid: string;
    validFrom: string;
    validTo: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO metadata_snapshot(
      metadata_snapshot_id, spid, observed_at, valid_from, valid_to,
      player_name, season_id, season_name, salary, positions_json, ovr,
      stats_json, traits_json, clubs_json, nations_json, team_colors_json,
      completeness
    ) VALUES (?, ?, ?, ?, ?, ?, 863, 'PTG', 20, ?, 120, '{}',
      '[]', '[]', '[]', ?, 'FULL')`,
  ).run(
    input.id,
    input.spid,
    input.validFrom,
    input.validFrom,
    input.validTo,
    input.spid,
    JSON.stringify([{ name: "RB", ovr: 120, primary: true }]),
    JSON.stringify(["Chelsea", "PTG"]),
  );
}

test("default structure as_of waits until every seed has current FULL metadata", async () => {
  const db = await tempDb();
  try {
    seedIdentity(db, "p1", "100");
    seedIdentity(db, "p2", "200");

    insertFullMetadata(db, {
      id: "meta-100-current",
      spid: "100",
      validFrom: "2026-10-01T00:00:00.000Z",
      validTo: null,
    });
    insertFullMetadata(db, {
      id: "meta-200-previous",
      spid: "200",
      validFrom: "2026-09-30T23:00:00.000Z",
      validTo: "2026-10-01T00:01:00.000Z",
    });
    insertFullMetadata(db, {
      id: "meta-200-current",
      spid: "200",
      validFrom: "2026-10-01T00:01:00.000Z",
      validTo: null,
    });

    const result = buildMarketStructure(db, catalog);
    assert.equal(result.as_of, "2026-10-01T00:01:00.000Z");
    assert.equal(result.relations_created, 1);
    assert.equal(result.relation_snapshots_created, 1);

    const relation = db
      .prepare(
        `SELECT valid_from, valid_to
         FROM card_relation
         WHERE relation_source = 'TEAM_COLOR_POSITION_FULL_METADATA'`,
      )
      .get() as { valid_from: string; valid_to: string | null };
    assert.deepEqual({ ...relation }, {
      valid_from: "2026-10-01T00:01:00.000Z",
      valid_to: null,
    });
  } finally {
    db.close();
  }
});
