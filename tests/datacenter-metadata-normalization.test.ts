import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseSeedCatalogDocument } from "../src/catalog/seed-catalog.ts";
import {
  buildDatacenterMetadataTemplate,
  parseDatacenterMetadataEvidenceDocument,
} from "../src/evidence/datacenter-metadata.ts";
import { openMarketDatabase } from "../src/db/market-db.ts";
import { normalizeDatacenterMetadata } from "../src/normalize/datacenter-metadata.ts";

const observedAt = "2026-09-30T06:30:00.000Z";
const raw = Buffer.from("<html><body>manual player detail capture</body></html>");
const rawHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;

async function readCatalog() {
  return parseSeedCatalogDocument(
    JSON.parse(await readFile("data/catalog/seed-catalog.json", "utf8")),
  );
}

async function tempDb() {
  const directory = await mkdtemp(join(tmpdir(), "fc-market-detail-db-"));
  return openMarketDatabase(join(directory, "market.db"));
}

function seedIdentity(
  db: ReturnType<typeof openMarketDatabase>,
  seed: Awaited<ReturnType<typeof readCatalog>>["seeds"][number],
): void {
  db.prepare("INSERT INTO player(player_id, name) VALUES (?, ?)").run(
    seed.player_key,
    seed.player_name,
  );
  db.prepare(
    "INSERT INTO player_card(spid, player_id, season) VALUES (?, ?, 'PTG')",
  ).run(seed.primary_instrument.spid, seed.player_key);
  db.prepare(
    "INSERT INTO instrument(instrument_id, spid, grade) VALUES (?, ?, ?)",
  ).run(
    `${seed.primary_instrument.spid}:${seed.primary_instrument.grade}`,
    seed.primary_instrument.spid,
    seed.primary_instrument.grade,
  );
  db.prepare(
    `INSERT INTO metadata_snapshot(
      metadata_snapshot_id, spid, observed_at, valid_from, valid_to,
      player_name, season_id, season_name, salary, positions_json, ovr,
      stats_json, traits_json, clubs_json, nations_json, team_colors_json,
      completeness
    ) VALUES ('identity', ?, '2026-09-30T06:00:00.000Z',
      '2026-09-30T06:00:00.000Z', NULL, ?, 863, 'Path to Glory',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'IDENTITY_ONLY')`,
  ).run(seed.primary_instrument.spid, seed.player_name);
}

function evidenceFor(
  catalog: Awaited<ReturnType<typeof readCatalog>>,
  overrides: Record<string, unknown> = {},
) {
  const seed = catalog.seeds[0]!;
  return {
    schema_version: 1,
    catalog_id: catalog.catalog_id,
    capture_method: "OFFICIAL_WEB_UI_MANUAL_CAPTURE",
    entries: [
      {
        spid: seed.primary_instrument.spid,
        grade: seed.primary_instrument.grade,
        player_name: seed.player_name,
        observed_at: observedAt,
        source_url:
          `https://fconline.nexon.com/DataCenter/PlayerInfo?` +
          `n1Strong=${seed.primary_instrument.grade}&spid=${seed.primary_instrument.spid}`,
        raw_sha256: rawHash,
        salary: 27,
        positions: [
          { name: "LB", ovr: 120, primary: true },
          { name: "LWB", ovr: 118, primary: false },
        ],
        ovr: 120,
        stats: { 속력: 125, 가속력: 123, 크로스: 119 },
        traits: ["스피드 드리블러"],
        clubs: ["첼시"],
        nations: ["스페인"],
        team_colors: ["스페인", "첼시", "Path to Glory"],
        ...overrides,
      },
    ],
  };
}

test("builds a 20-card manual Data Center metadata template", async () => {
  const catalog = await readCatalog();
  const template = buildDatacenterMetadataTemplate(catalog);
  assert.equal(template.entries.length, 20);
  assert.deepEqual(template.entries[0], {
    spid: "863239231",
    grade: 1,
    player_name: "마르크 쿠쿠레야",
    source_url:
      "https://fconline.nexon.com/DataCenter/PlayerInfo?n1Strong=1&spid=863239231",
    observed_at: null,
    raw_sha256: null,
    salary: null,
    positions: [],
    ovr: null,
    stats: {},
    traits: [],
    clubs: [],
    nations: [],
    team_colors: [],
  });
});

test("normalizes manual detail evidence into a FULL metadata snapshot", async () => {
  const catalog = await readCatalog();
  const seed = catalog.seeds[0]!;
  const document = parseDatacenterMetadataEvidenceDocument(evidenceFor(catalog));
  const db = await tempDb();
  try {
    seedIdentity(db, seed);
    const rawByHash = new Map([
      [rawHash, { path: "capture.html", raw, raw_sha256: rawHash }],
    ]);
    const first = normalizeDatacenterMetadata(db, {
      catalog,
      document,
      rawByHash,
    });
    const second = normalizeDatacenterMetadata(db, {
      catalog,
      document,
      rawByHash,
    });

    assert.deepEqual(first, {
      source_snapshots_created: 1,
      metadata_snapshots_created: 1,
      metadata_snapshot_sources_created: 1,
      entries_processed: 1,
    });
    assert.deepEqual(second, {
      source_snapshots_created: 0,
      metadata_snapshots_created: 0,
      metadata_snapshot_sources_created: 0,
      entries_processed: 1,
    });

    const full = db
      .prepare(
        `SELECT salary, positions_json, ovr, stats_json, traits_json,
                clubs_json, nations_json, team_colors_json, completeness, valid_to
         FROM metadata_snapshot
         WHERE spid = ? AND completeness = 'FULL'`,
      )
      .get(seed.primary_instrument.spid) as Record<string, unknown>;
    assert.equal(full.salary, 27);
    assert.equal(full.ovr, 120);
    assert.equal(full.completeness, "FULL");
    assert.equal(full.valid_to, null);
    assert.deepEqual(JSON.parse(full.positions_json as string), [
      { name: "LB", ovr: 120, primary: true },
      { name: "LWB", ovr: 118, primary: false },
    ]);
    assert.deepEqual(JSON.parse(full.stats_json as string), {
      속력: 125,
      가속력: 123,
      크로스: 119,
    });

    const identity = db
      .prepare("SELECT valid_to FROM metadata_snapshot WHERE metadata_snapshot_id = 'identity'")
      .get() as { valid_to: string };
    assert.equal(identity.valid_to, observedAt);

    const source = db
      .prepare(
        `SELECT raw_hash, capture_method, source_type
         FROM source_snapshot WHERE source_id = 'fconline-datacenter-player-info'`,
      )
      .get();
    assert.deepEqual({ ...source }, {
      raw_hash: rawHash,
      capture_method: "OFFICIAL_WEB_UI_MANUAL_CAPTURE",
      source_type: "OFFICIAL_WEB_UI_MANUAL_CAPTURE",
    });
  } finally {
    db.close();
  }
});

test("rejects detail evidence when the raw capture hash is unavailable", async () => {
  const catalog = await readCatalog();
  const seed = catalog.seeds[0]!;
  const document = parseDatacenterMetadataEvidenceDocument(evidenceFor(catalog));
  const db = await tempDb();
  try {
    seedIdentity(db, seed);
    assert.throws(
      () =>
        normalizeDatacenterMetadata(db, {
          catalog,
          document,
          rawByHash: new Map(),
        }),
      /raw metadata capture .* was not found/,
    );
    const count = db
      .prepare("SELECT COUNT(*) AS count FROM source_snapshot")
      .get() as { count: number };
    assert.equal(Number(count.count), 0);
  } finally {
    db.close();
  }
});

test("rejects detail evidence with more than one primary position", async () => {
  const catalog = await readCatalog();
  assert.throws(
    () =>
      parseDatacenterMetadataEvidenceDocument(
        evidenceFor(catalog, {
          positions: [
            { name: "GK", ovr: 120, primary: true },
            { name: "SW", ovr: 120, primary: true },
          ],
        }),
      ),
    /exactly one primary position/,
  );
});
