import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  collectOpenApiRankerStats,
  OPENAPI_RANKER_STATS_URL,
  rankerStatsTargetsFromDatabase,
  type RankerStatsArtifact,
} from "../src/collect/openapi-ranker-stats.ts";
import { openMarketDatabase } from "../src/db/market-db.ts";
import { normalizeRankerStats } from "../src/normalize/ranker-stats.ts";

const observedAt = "2026-09-30T07:00:00.000Z";

async function tempDb() {
  const directory = await mkdtemp(join(tmpdir(), "fc-market-ranker-db-"));
  return openMarketDatabase(join(directory, "market.db"));
}

function seedCard(db: ReturnType<typeof openMarketDatabase>, spid = "863239231") {
  db.prepare("INSERT INTO player(player_id, name) VALUES ('p1', '선수')").run();
  db.prepare(
    "INSERT INTO player_card(spid, player_id, season) VALUES (?, 'p1', 'PTG')",
  ).run(spid);
  db.prepare(
    `INSERT INTO metadata_snapshot(
      metadata_snapshot_id, spid, observed_at, valid_from, valid_to,
      player_name, season_id, season_name, salary, positions_json, ovr,
      stats_json, traits_json, clubs_json, nations_json, team_colors_json,
      completeness
    ) VALUES ('full1', ?, ?, ?, NULL, '선수', 863, 'Path to Glory', 27, ?,
      120, '{}', '[]', '[]', '[]', '[]', 'FULL')`,
  ).run(
    spid,
    observedAt,
    observedAt,
    JSON.stringify([{ name: "LB", ovr: 120, primary: true }]),
  );
  db.prepare(
    `INSERT INTO source_snapshot(
      source_snapshot_id, source_id, source_type, source_url, source_timestamp,
      observed_at, raw_payload, raw_hash, capture_method, collector_version,
      policy_evidence_id, source_ref, parse_status, parse_error
    ) VALUES ('position-meta', 'nexon-open-api-position-metadata',
      'OPEN_API_STATIC_METADATA', 'https://open.api.nexon.com/static/fconline/meta/spposition.json',
      ?, ?, ?, ?, 'OFFICIAL_OPEN_API_STATIC', 'test', 'test', 'position', 'PARSED', NULL)`,
  ).run(
    observedAt,
    observedAt,
    Buffer.from(JSON.stringify([{ spposition: 3, desc: "LB" }])),
    `sha256:${"0".repeat(64)}`,
  );
}

function responseRow(spid = 863239231, position = 3) {
  return {
    spid,
    spPosition: position,
    status: {
      shoot: 0.2,
      effectiveShoot: 0.1,
      assist: 0.05,
      goal: 0.01,
      dribble: 80.5,
      dribbleTry: 5.4,
      dribbleSuccess: 4.8,
      passTry: 14.2,
      passSuccess: 12.1,
      block: 1.3,
      tackle: 2.4,
      matchCount: 137,
    },
    createDate: "2026-09-30T05:00:00",
  };
}

test("collects ranker stats with the official request contract", async () => {
  let capturedUrl = "";
  let capturedKey = "";
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedKey = new Headers(init?.headers).get("x-nxopen-api-key") ?? "";
    return new Response(JSON.stringify([responseRow()]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const artifacts = await collectOpenApiRankerStats(
    [{ spid: "863239231", position_code: 3 }],
    { apiKey: "test-key", matchtype: 50, observedAt, fetchImpl },
  );

  const url = new URL(capturedUrl);
  assert.equal(`${url.origin}${url.pathname}`, OPENAPI_RANKER_STATS_URL);
  assert.equal(url.searchParams.get("matchtype"), "50");
  assert.deepEqual(JSON.parse(url.searchParams.get("players")!), [
    { id: 863239231, po: 3 },
  ]);
  assert.equal(capturedKey, "test-key");
  assert.equal(artifacts.length, 1);
});

test("derives ranker targets from the latest FULL metadata primary position", async () => {
  const db = await tempDb();
  try {
    seedCard(db);
    const catalog = {
      schema_version: 1 as const,
      catalog_id: "test",
      status: "FROZEN" as const,
      frozen_at: observedAt,
      selection_source: {
        source_id: "test",
        source_url: "https://example.com",
        data_date: "2026-09-30",
        observed_at: observedAt,
        method: "test",
        ranker_scope: "test",
      },
      seeds: [
        {
          player_key: "p1",
          player_name: "선수",
          primary_instrument: { spid: "863239231", grade: 1 },
          selection_observation: {
            section: "CLASS_USAGE" as const,
            ranker_squad_count: 1,
            displayed_share_percent: 1,
          },
          selection_reason: "test",
        },
      ],
    };
    assert.deepEqual(rankerStatsTargetsFromDatabase(db, catalog), [
      { spid: "863239231", position_code: 3 },
    ]);
  } finally {
    db.close();
  }
});

test("normalizes ranker stats as card-level observations and is idempotent", async () => {
  const db = await tempDb();
  try {
    seedCard(db);
    const artifact: RankerStatsArtifact = {
      source_url:
        "https://open.api.nexon.com/fconline/v1/ranker-stats?matchtype=50",
      observed_at: observedAt,
      matchtype: 50,
      targets: [{ spid: "863239231", position_code: 3 }],
      raw: Buffer.from(JSON.stringify([responseRow()])),
    };
    const first = normalizeRankerStats(db, [artifact]);
    const second = normalizeRankerStats(db, [artifact]);

    assert.deepEqual(first, {
      source_snapshots_created: 1,
      usage_points_created: 1,
      returned_rows: 1,
      missing_targets: [],
    });
    assert.deepEqual(second, {
      source_snapshots_created: 0,
      usage_points_created: 0,
      returned_rows: 1,
      missing_targets: [],
    });

    const row = db
      .prepare(
        `SELECT subject_type, spid, instrument_id, as_of, source_data_date,
                observation_type, appearances, usage_share, position_code,
                performance_metrics_json
         FROM usage_point WHERE observation_type = 'OPEN_API_RANKER_STATS'`,
      )
      .get() as Record<string, unknown>;
    assert.equal(row.subject_type, "PLAYER_CARD");
    assert.equal(row.spid, "863239231");
    assert.equal(row.instrument_id, null);
    assert.equal(row.as_of, "2026-09-30T05:00:00.000Z");
    assert.equal(row.source_data_date, "2026-09-30");
    assert.equal(row.appearances, 137);
    assert.equal(row.usage_share, null);
    assert.equal(row.position_code, 3);
    assert.deepEqual(JSON.parse(row.performance_metrics_json as string), {
      shoot: 0.2,
      effectiveShoot: 0.1,
      assist: 0.05,
      goal: 0.01,
      dribble: 80.5,
      dribbleTry: 5.4,
      dribbleSuccess: 4.8,
      passTry: 14.2,
      passSuccess: 12.1,
      block: 1.3,
      tackle: 2.4,
    });
  } finally {
    db.close();
  }
});

test("normalizes numeric-string ranker fields at the API boundary", async () => {
  const db = await tempDb();
  try {
    seedCard(db);
    const row = responseRow();
    const artifact: RankerStatsArtifact = {
      source_url: "https://open.api.nexon.com/fconline/v1/ranker-stats",
      observed_at: observedAt,
      matchtype: 50,
      targets: [{ spid: "863239231", position_code: 3 }],
      raw: Buffer.from(
        JSON.stringify([
          {
            ...row,
            spid: String(row.spid),
            spPosition: String(row.spPosition),
            status: Object.fromEntries(
              Object.entries(row.status).map(([key, value]) => [key, String(value)]),
            ),
          },
        ]),
      ),
    };

    const result = normalizeRankerStats(db, [artifact]);
    assert.deepEqual(result, {
      source_snapshots_created: 1,
      usage_points_created: 1,
      returned_rows: 1,
      missing_targets: [],
    });

    const stored = db
      .prepare(
        `SELECT spid, appearances, position_code, performance_metrics_json
         FROM usage_point WHERE observation_type = 'OPEN_API_RANKER_STATS'`,
      )
      .get() as Record<string, unknown>;
    assert.equal(stored.spid, "863239231");
    assert.equal(stored.appearances, 137);
    assert.equal(stored.position_code, 3);
    assert.equal(
      (JSON.parse(stored.performance_metrics_json as string) as { dribble: number }).dribble,
      80.5,
    );
  } finally {
    db.close();
  }
});

test("reports a requested card missing from the ranker response without inventing a row", async () => {
  const db = await tempDb();
  try {
    seedCard(db);
    const artifact: RankerStatsArtifact = {
      source_url: "https://open.api.nexon.com/fconline/v1/ranker-stats",
      observed_at: observedAt,
      matchtype: 50,
      targets: [
        { spid: "863239231", position_code: 3 },
        { spid: "863238074", position_code: 12 },
      ],
      raw: Buffer.from(JSON.stringify([responseRow()])),
    };
    const result = normalizeRankerStats(db, [artifact]);
    assert.deepEqual(result.missing_targets, [
      { spid: "863238074", position_code: 12 },
    ]);
    const count = db
      .prepare(
        "SELECT COUNT(*) AS count FROM usage_point WHERE observation_type = 'OPEN_API_RANKER_STATS'",
      )
      .get() as { count: number | bigint };
    assert.equal(Number(count.count), 1);
  } finally {
    db.close();
  }
});
