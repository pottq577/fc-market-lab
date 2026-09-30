import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseSeedCatalogDocument } from "../src/catalog/seed-catalog.ts";
import {
  collectOpenApiMetadata,
  OPENAPI_METADATA_URLS,
  type OpenApiMetadataArtifact,
} from "../src/collect/openapi-metadata.ts";
import {
  countMetadataUsageDatabase,
  openMarketDatabase,
} from "../src/db/market-db.ts";
import { normalizeOpenApiMetadata } from "../src/normalize/openapi-metadata.ts";
import { normalizeSeedUsage } from "../src/normalize/seed-usage.ts";

const observedAt = "2026-09-30T06:00:00.000Z";

async function readCatalog() {
  const raw = await readFile("data/catalog/seed-catalog.json");
  return {
    raw,
    document: parseSeedCatalogDocument(JSON.parse(raw.toString("utf8"))),
  };
}

function artifactsFor(
  catalog: Awaited<ReturnType<typeof readCatalog>>["document"],
): OpenApiMetadataArtifact[] {
  const spids = catalog.seeds.map((seed) => ({
    id: Number(seed.primary_instrument.spid),
    name: seed.player_name,
  }));
  const seasons = [
    { seasonId: 856, className: "25UCL" },
    { seasonId: 863, className: "Path to Glory" },
    { seasonId: 868, className: "26FSL" },
  ];
  const positions = [
    { spposition: 0, desc: "GK" },
    { spposition: 18, desc: "ST" },
  ];

  return [
    ["spid", spids],
    ["season", seasons],
    ["position", positions],
  ].map(([kind, value]) => ({
    kind: kind as "spid" | "season" | "position",
    source_url: OPENAPI_METADATA_URLS[kind as keyof typeof OPENAPI_METADATA_URLS],
    observed_at: observedAt,
    raw: Buffer.from(JSON.stringify(value)),
  }));
}

async function tempDb() {
  const directory = await mkdtemp(join(tmpdir(), "fc-market-metadata-db-"));
  return openMarketDatabase(join(directory, "market.db"));
}

function seedPriceIdentities(
  db: ReturnType<typeof openMarketDatabase>,
  catalog: Awaited<ReturnType<typeof readCatalog>>["document"],
): void {
  const seasonCode = new Map([
    ["856", "25UCL"],
    ["863", "PTG"],
    ["868", "26FSL"],
  ]);
  for (const seed of catalog.seeds) {
    const spid = seed.primary_instrument.spid;
    db.prepare("INSERT INTO player(player_id, name) VALUES (?, ?)").run(
      seed.player_key,
      seed.player_name,
    );
    db.prepare(
      "INSERT INTO player_card(spid, player_id, season) VALUES (?, ?, ?)",
    ).run(spid, seed.player_key, seasonCode.get(spid.slice(0, 3))!);
    db.prepare(
      "INSERT INTO instrument(instrument_id, spid, grade) VALUES (?, ?, ?)",
    ).run(`${spid}:${seed.primary_instrument.grade}`, spid, seed.primary_instrument.grade);
  }
}

test("collects the three official static metadata surfaces", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const artifacts = await collectOpenApiMetadata({ observedAt, fetchImpl });
  assert.deepEqual(
    artifacts.map((artifact) => artifact.kind),
    ["spid", "season", "position"],
  );
  assert.deepEqual(calls, Object.values(OPENAPI_METADATA_URLS));
});

test("normalizes identity metadata with two-source provenance", async () => {
  const { document: catalog } = await readCatalog();
  const db = await tempDb();
  try {
    seedPriceIdentities(db, catalog);
    const first = normalizeOpenApiMetadata(db, {
      catalog,
      artifacts: artifactsFor(catalog),
    });
    const second = normalizeOpenApiMetadata(db, {
      catalog,
      artifacts: artifactsFor(catalog),
    });

    assert.deepEqual(first, {
      source_snapshots_created: 3,
      metadata_snapshots_created: 20,
      metadata_snapshot_sources_created: 40,
    });
    assert.deepEqual(second, {
      source_snapshots_created: 0,
      metadata_snapshots_created: 0,
      metadata_snapshot_sources_created: 0,
    });
    assert.deepEqual(countMetadataUsageDatabase(db), {
      metadata_snapshots: 20,
      metadata_snapshot_sources: 40,
      usage_points: 0,
    });

    const row = db
      .prepare(
        `SELECT spid, player_name, season_id, season_name, completeness,
                salary, ovr, stats_json, traits_json, team_colors_json
         FROM metadata_snapshot WHERE spid = ?`,
      )
      .get(catalog.seeds[0]!.primary_instrument.spid);
    assert.deepEqual({ ...row }, {
      spid: "863239231",
      player_name: "마르크 쿠쿠레야",
      season_id: 863,
      season_name: "Path to Glory",
      completeness: "IDENTITY_ONLY",
      salary: null,
      ovr: null,
      stats_json: null,
      traits_json: null,
      team_colors_json: null,
    });
  } finally {
    db.close();
  }
});

test("normalizes frozen Daily Chart usage at player-card granularity", async () => {
  const { raw, document: catalog } = await readCatalog();
  const db = await tempDb();
  try {
    seedPriceIdentities(db, catalog);
    const first = normalizeSeedUsage(db, { catalog, catalogRaw: raw });
    const second = normalizeSeedUsage(db, { catalog, catalogRaw: raw });

    assert.deepEqual(first, {
      source_snapshot_created: true,
      usage_points_created: 20,
    });
    assert.deepEqual(second, {
      source_snapshot_created: false,
      usage_points_created: 0,
    });

    const row = db
      .prepare(
        `SELECT subject_type, spid, instrument_id, appearances, usage_share,
                observation_type, source_data_date
         FROM usage_point WHERE spid = ?`,
      )
      .get("863239231");
    assert.deepEqual({ ...row }, {
      subject_type: "PLAYER_CARD",
      spid: "863239231",
      instrument_id: null,
      appearances: 404,
      usage_share: 0.211,
      observation_type: "DAILY_CHART_CLASS_USAGE",
      source_data_date: "2026-09-29",
    });
  } finally {
    db.close();
  }
});

test("metadata ingestion refuses to invent a missing Open API card", async () => {
  const { document: catalog } = await readCatalog();
  const db = await tempDb();
  try {
    seedPriceIdentities(db, catalog);
    const artifacts = artifactsFor(catalog);
    const spidArtifact = artifacts.find((artifact) => artifact.kind === "spid")!;
    const values = JSON.parse(spidArtifact.raw.toString("utf8")) as unknown[];
    spidArtifact.raw = Buffer.from(JSON.stringify(values.slice(1)));

    assert.throws(
      () => normalizeOpenApiMetadata(db, { catalog, artifacts }),
      /Open API spid metadata is missing/,
    );
    assert.deepEqual(countMetadataUsageDatabase(db), {
      metadata_snapshots: 0,
      metadata_snapshot_sources: 0,
      usage_points: 0,
    });
  } finally {
    db.close();
  }
});
