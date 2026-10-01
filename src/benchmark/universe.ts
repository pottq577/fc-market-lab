import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { OpenApiMetadataArtifact } from "../collect/openapi-metadata.ts";
import { parseOpenApiMetadataArtifacts } from "../normalize/openapi-metadata.ts";

export const MARKET_UNIVERSE_RULE_VERSION = "market-universe-v1";
export const DEFAULT_PRICE_MAX_AGE_DAYS = 7;
export const DEFAULT_UNIVERSE_PRICE_SEMANTICS = "MARKET_REFERENCE_PRICE";

export type UniversePriceSemantics =
  | "MARKET_REFERENCE_PRICE"
  | "TRADE_PRICE"
  | "UNKNOWN";

interface UniverseCard {
  player_id: string;
  player_name: string;
  spid: string;
  season_id: number;
  season_name: string;
}

interface UniverseInstrument {
  player_id: string;
  instrument_id: string;
  spid: string;
  grade: number;
  latest_price: number | bigint | null;
  latest_source_timestamp: string | null;
  latest_observed_at: string | null;
  latest_price_semantics: string | null;
  latest_quality_status: string | null;
  valid_history_count: number;
  price_eligible: boolean;
}

interface SourceProvenance {
  source_snapshot_id: string;
  raw_hash: string;
  observed_at: string;
}

export interface MarketUniverseSnapshotResult {
  universe_snapshot_id: string;
  as_of: string;
  rule_version: string;
  source_hash: string;
  price_semantics: UniversePriceSemantics;
  price_max_age_days: number;
  catalog_player_count: number;
  catalog_card_count: number;
  observed_instrument_count: number;
  price_eligible_player_count: number;
  price_eligible_instrument_count: number;
  created: boolean;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeTimestamp(value: string, field: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${field} must include an explicit timezone`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
  return parsed.toISOString();
}

function artifactByKind(
  artifacts: OpenApiMetadataArtifact[],
  kind: "spid" | "season",
): OpenApiMetadataArtifact {
  const matches = artifacts.filter((artifact) => artifact.kind === kind);
  if (matches.length !== 1) {
    throw new TypeError(`exactly one ${kind} metadata artifact is required`);
  }
  return matches[0]!;
}

function sourceProvenance(
  db: DatabaseSync,
  artifact: OpenApiMetadataArtifact,
): SourceProvenance {
  const rawHash = sha256(artifact.raw);
  const sourceId = `nexon-open-api-${artifact.kind}-metadata`;
  const rows = db
    .prepare(
      `SELECT source_snapshot_id, raw_hash, observed_at
       FROM source_snapshot
       WHERE source_id = ?
         AND source_url = ?
         AND raw_hash = ?
         AND observed_at = ?
         AND parse_status = 'PARSED'
       ORDER BY source_snapshot_id`,
    )
    .all(sourceId, artifact.source_url, rawHash, artifact.observed_at) as SourceProvenance[];
  if (rows.length !== 1) {
    throw new TypeError(
      `Open API ${artifact.kind} source snapshot is unavailable; run ingest:metadata-usage for this manifest first`,
    );
  }
  return rows[0]!;
}

function officialIdentity(spidNumber: number): {
  spid: string;
  player_id: string;
  season_id: number;
} {
  const spid = String(spidNumber);
  if (!/^\d{9}$/.test(spid)) {
    throw new TypeError(`Open API spid ${spid} must contain 9 digits`);
  }
  const seasonId = Number(spid.slice(0, 3));
  const pid = spid.slice(3);
  return {
    spid,
    player_id: `pid:${pid}`,
    season_id: seasonId,
  };
}

function choosePlayerName(cards: UniverseCard[]): string {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.player_name, (counts.get(card.player_name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || leftName.localeCompare(rightName),
    )[0]![0];
}

function loadObservedInstruments(
  db: DatabaseSync,
  input: {
    asOf: string;
    priceSemantics: UniversePriceSemantics;
    priceMaxAgeDays: number;
    playerBySpid: Map<string, string>;
  },
): UniverseInstrument[] {
  const rows = db
    .prepare(
      `WITH ranked AS (
         SELECT i.instrument_id, i.spid, i.grade,
                pp.value, pp.source_timestamp, pp.observed_at,
                pp.price_semantics, pp.quality_status,
                ROW_NUMBER() OVER (
                  PARTITION BY i.instrument_id
                  ORDER BY pp.source_timestamp DESC,
                           pp.observed_at DESC,
                           pp.source_snapshot_id DESC
                ) AS row_num,
                SUM(CASE
                  WHEN pp.price_semantics = ?
                   AND pp.quality_status IN ('VALID', 'UNCHANGED_RUN')
                   AND pp.value IS NOT NULL
                   AND pp.value > 0
                  THEN 1 ELSE 0
                END) OVER (PARTITION BY i.instrument_id) AS valid_history_count
         FROM instrument i
         JOIN price_point pp ON pp.instrument_id = i.instrument_id
         WHERE pp.source_timestamp <= ?
           AND pp.observed_at <= ?
       )
       SELECT instrument_id, spid, grade, value, source_timestamp, observed_at,
              price_semantics, quality_status, valid_history_count
       FROM ranked
       WHERE row_num = 1
       ORDER BY instrument_id`,
    )
    .all(input.priceSemantics, input.asOf, input.asOf) as Array<{
      instrument_id: string;
      spid: string;
      grade: number | bigint;
      value: number | bigint | null;
      source_timestamp: string;
      observed_at: string;
      price_semantics: string;
      quality_status: string;
      valid_history_count: number | bigint;
    }>;

  const oldestEligibleMs =
    Date.parse(input.asOf) - input.priceMaxAgeDays * 24 * 60 * 60 * 1000;
  const instruments: UniverseInstrument[] = [];
  for (const row of rows) {
    const playerId = input.playerBySpid.get(row.spid);
    if (!playerId) continue;

    const sourceTimestampMs = Date.parse(row.source_timestamp);
    if (Number.isNaN(sourceTimestampMs)) {
      throw new TypeError(
        `price point ${row.instrument_id} has invalid source_timestamp ${row.source_timestamp}`,
      );
    }
    const qualityValid =
      row.quality_status === "VALID" || row.quality_status === "UNCHANGED_RUN";
    const valuePositive =
      row.value !== null &&
      (typeof row.value === "bigint" ? row.value > 0n : row.value > 0);
    const priceEligible =
      row.price_semantics === input.priceSemantics &&
      qualityValid &&
      valuePositive &&
      sourceTimestampMs >= oldestEligibleMs;

    instruments.push({
      player_id: playerId,
      instrument_id: row.instrument_id,
      spid: row.spid,
      grade: Number(row.grade),
      latest_price: valuePositive ? row.value : null,
      latest_source_timestamp: row.source_timestamp,
      latest_observed_at: row.observed_at,
      latest_price_semantics: row.price_semantics,
      latest_quality_status: row.quality_status,
      valid_history_count: Number(row.valid_history_count),
      price_eligible: priceEligible,
    });
  }
  return instruments;
}

function anchorInstrument(instruments: UniverseInstrument[]): UniverseInstrument | null {
  const eligible = instruments.filter((instrument) => instrument.price_eligible);
  eligible.sort((left, right) =>
    right.latest_source_timestamp!.localeCompare(left.latest_source_timestamp!) ||
    right.valid_history_count - left.valid_history_count ||
    left.instrument_id.localeCompare(right.instrument_id),
  );
  return eligible[0] ?? null;
}

export function buildMarketUniverseSnapshot(
  db: DatabaseSync,
  input: {
    artifacts: OpenApiMetadataArtifact[];
    asOf: string;
    createdAt?: string;
    ruleVersion?: string;
    priceSemantics?: UniversePriceSemantics;
    priceMaxAgeDays?: number;
  },
): MarketUniverseSnapshotResult {
  const asOf = normalizeTimestamp(input.asOf, "asOf");
  const createdAt = normalizeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "createdAt",
  );
  const ruleVersion = input.ruleVersion ?? MARKET_UNIVERSE_RULE_VERSION;
  if (ruleVersion.trim() === "") {
    throw new TypeError("ruleVersion must not be empty");
  }
  const priceSemantics =
    input.priceSemantics ?? DEFAULT_UNIVERSE_PRICE_SEMANTICS;
  if (
    !["MARKET_REFERENCE_PRICE", "TRADE_PRICE", "UNKNOWN"].includes(priceSemantics)
  ) {
    throw new TypeError("priceSemantics is invalid");
  }
  const priceMaxAgeDays = input.priceMaxAgeDays ?? DEFAULT_PRICE_MAX_AGE_DAYS;
  if (!Number.isInteger(priceMaxAgeDays) || priceMaxAgeDays <= 0) {
    throw new TypeError("priceMaxAgeDays must be a positive integer");
  }

  const parsed = parseOpenApiMetadataArtifacts(input.artifacts);
  const spidArtifact = artifactByKind(input.artifacts, "spid");
  const seasonArtifact = artifactByKind(input.artifacts, "season");
  const spidObservedAt = normalizeTimestamp(spidArtifact.observed_at, "spid observed_at");
  const seasonObservedAt = normalizeTimestamp(
    seasonArtifact.observed_at,
    "season observed_at",
  );
  if (spidObservedAt !== seasonObservedAt) {
    throw new TypeError("spid and season metadata must share the same observed_at");
  }
  if (spidObservedAt > asOf) {
    throw new TypeError("metadata observed_at must not be after the universe asOf");
  }

  const spidSource = sourceProvenance(db, spidArtifact);
  const seasonSource = sourceProvenance(db, seasonArtifact);
  const sourceHash = sha256(
    JSON.stringify([
      ["SEASON_META", seasonSource.source_snapshot_id, seasonSource.raw_hash],
      ["SPID_META", spidSource.source_snapshot_id, spidSource.raw_hash],
    ]),
  );

  const seasonById = new Map(
    parsed.seasons.map((season) => [season.seasonId, season.className]),
  );
  const cards: UniverseCard[] = parsed.spids.map((entry) => {
    const identity = officialIdentity(entry.id);
    const seasonName = seasonById.get(identity.season_id);
    if (!seasonName) {
      throw new TypeError(
        `Open API season metadata is missing seasonId=${identity.season_id} for spid=${identity.spid}`,
      );
    }
    return {
      player_id: identity.player_id,
      player_name: entry.name,
      spid: identity.spid,
      season_id: identity.season_id,
      season_name: seasonName,
    };
  });
  cards.sort((left, right) => left.spid.localeCompare(right.spid));

  const cardsByPlayer = new Map<string, UniverseCard[]>();
  const playerBySpid = new Map<string, string>();
  for (const card of cards) {
    const playerCards = cardsByPlayer.get(card.player_id) ?? [];
    playerCards.push(card);
    cardsByPlayer.set(card.player_id, playerCards);
    playerBySpid.set(card.spid, card.player_id);
  }

  const instruments = loadObservedInstruments(db, {
    asOf,
    priceSemantics,
    priceMaxAgeDays,
    playerBySpid,
  });
  const instrumentsByPlayer = new Map<string, UniverseInstrument[]>();
  for (const instrument of instruments) {
    const playerInstruments = instrumentsByPlayer.get(instrument.player_id) ?? [];
    playerInstruments.push(instrument);
    instrumentsByPlayer.set(instrument.player_id, playerInstruments);
  }

  const playerIds = [...cardsByPlayer.keys()].sort();
  const priceEligibleInstrumentCount = instruments.filter(
    (instrument) => instrument.price_eligible,
  ).length;
  const priceEligiblePlayerCount = playerIds.filter((playerId) =>
    (instrumentsByPlayer.get(playerId) ?? []).some(
      (instrument) => instrument.price_eligible,
    ),
  ).length;

  const snapshotIdentity = JSON.stringify({
    as_of: asOf,
    rule_version: ruleVersion,
    source_hash: sourceHash,
    price_semantics: priceSemantics,
    price_max_age_days: priceMaxAgeDays,
  });
  const universeSnapshotId = deterministicId("universe", snapshotIdentity);

  db.exec("BEGIN IMMEDIATE");
  try {
    const snapshotInsert = db
      .prepare(
        `INSERT OR IGNORE INTO market_universe_snapshot(
          universe_snapshot_id, as_of, rule_version, source_hash,
          price_semantics, price_max_age_days, catalog_player_count,
          catalog_card_count, price_eligible_player_count,
          price_eligible_instrument_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        universeSnapshotId,
        asOf,
        ruleVersion,
        sourceHash,
        priceSemantics,
        priceMaxAgeDays,
        playerIds.length,
        cards.length,
        priceEligiblePlayerCount,
        priceEligibleInstrumentCount,
        createdAt,
      );

    const sourceInsert = db.prepare(
      `INSERT OR IGNORE INTO market_universe_source(
        universe_snapshot_id, source_snapshot_id, source_role
      ) VALUES (?, ?, ?)`,
    );
    sourceInsert.run(universeSnapshotId, spidSource.source_snapshot_id, "SPID_META");
    sourceInsert.run(
      universeSnapshotId,
      seasonSource.source_snapshot_id,
      "SEASON_META",
    );

    const cardInsert = db.prepare(
      `INSERT OR IGNORE INTO market_universe_card(
        universe_snapshot_id, player_id, spid, player_name, season_id, season_name
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const card of cards) {
      cardInsert.run(
        universeSnapshotId,
        card.player_id,
        card.spid,
        card.player_name,
        card.season_id,
        card.season_name,
      );
    }

    const instrumentInsert = db.prepare(
      `INSERT OR IGNORE INTO market_universe_instrument(
        universe_snapshot_id, player_id, instrument_id, spid, grade,
        latest_price, latest_source_timestamp, latest_observed_at,
        latest_price_semantics, latest_quality_status, valid_history_count,
        price_eligible
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const instrument of instruments) {
      instrumentInsert.run(
        universeSnapshotId,
        instrument.player_id,
        instrument.instrument_id,
        instrument.spid,
        instrument.grade,
        instrument.latest_price,
        instrument.latest_source_timestamp,
        instrument.latest_observed_at,
        instrument.latest_price_semantics,
        instrument.latest_quality_status,
        instrument.valid_history_count,
        instrument.price_eligible ? 1 : 0,
      );
    }

    const memberInsert = db.prepare(
      `INSERT OR IGNORE INTO market_universe_member(
        universe_snapshot_id, player_id, player_name, catalog_card_count,
        observed_instrument_count, eligible_instrument_count, price_eligible,
        anchor_instrument_id, anchor_price, anchor_source_timestamp,
        anchor_history_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const playerId of playerIds) {
      const playerCards = cardsByPlayer.get(playerId)!;
      const playerInstruments = instrumentsByPlayer.get(playerId) ?? [];
      const eligibleCount = playerInstruments.filter(
        (instrument) => instrument.price_eligible,
      ).length;
      const anchor = anchorInstrument(playerInstruments);
      memberInsert.run(
        universeSnapshotId,
        playerId,
        choosePlayerName(playerCards),
        playerCards.length,
        playerInstruments.length,
        eligibleCount,
        anchor ? 1 : 0,
        anchor?.instrument_id ?? null,
        anchor?.latest_price ?? null,
        anchor?.latest_source_timestamp ?? null,
        anchor?.valid_history_count ?? null,
      );
    }

    const persisted = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM market_universe_member WHERE universe_snapshot_id = ?) AS members,
          (SELECT COUNT(*) FROM market_universe_card WHERE universe_snapshot_id = ?) AS cards,
          (SELECT COUNT(*) FROM market_universe_instrument WHERE universe_snapshot_id = ?) AS instruments,
          (SELECT COUNT(*) FROM market_universe_source WHERE universe_snapshot_id = ?) AS sources`,
      )
      .get(
        universeSnapshotId,
        universeSnapshotId,
        universeSnapshotId,
        universeSnapshotId,
      ) as {
      members: number | bigint;
      cards: number | bigint;
      instruments: number | bigint;
      sources: number | bigint;
    };
    if (
      Number(persisted.members) !== playerIds.length ||
      Number(persisted.cards) !== cards.length ||
      Number(persisted.instruments) !== instruments.length ||
      Number(persisted.sources) !== 2
    ) {
      throw new Error(`market universe snapshot ${universeSnapshotId} is incomplete`);
    }

    db.exec("COMMIT");
    return {
      universe_snapshot_id: universeSnapshotId,
      as_of: asOf,
      rule_version: ruleVersion,
      source_hash: sourceHash,
      price_semantics: priceSemantics,
      price_max_age_days: priceMaxAgeDays,
      catalog_player_count: playerIds.length,
      catalog_card_count: cards.length,
      observed_instrument_count: instruments.length,
      price_eligible_player_count: priceEligiblePlayerCount,
      price_eligible_instrument_count: priceEligibleInstrumentCount,
      created: Number(snapshotInsert.changes) === 1,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
