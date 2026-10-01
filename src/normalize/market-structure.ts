import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface StructureSeedCatalog {
  catalog_id: string;
  frozen_at: string;
  seeds: Array<{
    player_key: string;
    primary_instrument: {
      spid: string;
      grade: number;
    };
  }>;
}

interface CardState {
  instrument_id: string;
  spid: string;
  player_id: string;
  metadata_snapshot_id: string;
  valid_from: string;
  valid_to: string | null;
  season_name: string;
  salary: number | null;
  ovr: number | null;
  primary_positions: string[];
  team_colors: string[];
  stats: Record<string, number>;
}

export interface BuildMarketStructureResult {
  as_of: string;
  relations_created: number;
  relation_snapshots_created: number;
  cohort_definitions_created: number;
  cohort_memberships_created: number;
}

const RELATION_DEFINITION_VERSION = "full-metadata-v1";
const SAMPLE_MARKET_RULE_VERSION = "frozen-seed-v1";

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
  return parsed.toISOString();
}

function parseArray(value: string | null, field: string): unknown[] {
  if (value === null) {
    throw new TypeError(`${field} is missing`);
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new TypeError(`${field} must be a JSON array`);
  }
  return parsed;
}

function parsePrimaryPositions(value: string | null, spid: string): string[] {
  const positions = parseArray(value, `metadata positions for spid=${spid}`);
  const primary = positions.flatMap((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new TypeError(`positions[${index}] for spid=${spid} must be an object`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || record.name.trim() === "") {
      throw new TypeError(`positions[${index}].name for spid=${spid} is invalid`);
    }
    return record.primary === true ? [record.name.trim()] : [];
  });
  if (primary.length === 0) {
    throw new TypeError(`FULL metadata has no primary position for spid=${spid}`);
  }
  return [...new Set(primary)].sort();
}

function parseStringArray(value: string | null, field: string): string[] {
  return [...new Set(parseArray(value, field).map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new TypeError(`${field}[${index}] must be a non-empty string`);
    }
    return item.trim();
  }))].sort();
}

function parseStats(value: string | null, spid: string): Record<string, number> {
  if (value === null) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`metadata stats for spid=${spid} must be a JSON object`);
  }
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      result[key] = raw;
    }
  }
  return result;
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).sort();
}

function earliestNullable(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => value !== null).sort();
  return present[0] ?? null;
}

function statDistance(left: Record<string, number>, right: Record<string, number>): number | null {
  const keys = Object.keys(left).filter((key) => right[key] !== undefined);
  if (keys.length === 0) {
    return null;
  }
  const meanSquare = keys.reduce((sum, key) => {
    const delta = left[key]! - right[key]!;
    return sum + delta * delta;
  }, 0) / keys.length;
  return Number(Math.sqrt(meanSquare).toFixed(6));
}

function latestPrice(db: DatabaseSync, instrumentId: string, asOf: string): number | null {
  const row = db
    .prepare(
      `SELECT value
       FROM price_point
       WHERE instrument_id = ?
         AND source_timestamp <= ?
         AND quality_status IN ('VALID', 'UNCHANGED_RUN')
         AND value IS NOT NULL
       ORDER BY source_timestamp DESC, observed_at DESC
       LIMIT 1`,
    )
    .get(instrumentId, asOf) as { value: number | bigint } | undefined;
  return row ? Number(row.value) : null;
}

function latestUsageShare(db: DatabaseSync, spid: string, asOf: string): number | null {
  const row = db
    .prepare(
      `SELECT usage_share
       FROM usage_point
       WHERE subject_type = 'PLAYER_CARD'
         AND spid = ?
         AND as_of <= ?
         AND usage_share IS NOT NULL
       ORDER BY as_of DESC, usage_point_id DESC
       LIMIT 1`,
    )
    .get(spid, asOf) as { usage_share: number } | undefined;
  return row?.usage_share ?? null;
}

function resolveAsOf(
  db: DatabaseSync,
  catalog: StructureSeedCatalog,
  requestedAsOf?: string,
): string {
  if (requestedAsOf) {
    return timestamp(requestedAsOf, "asOf");
  }
  const latest: string[] = [];
  for (const seed of catalog.seeds) {
    const row = db
      .prepare(
        `SELECT observed_at
         FROM metadata_snapshot
         WHERE spid = ? AND completeness = 'FULL'
         ORDER BY observed_at DESC, metadata_snapshot_id DESC
         LIMIT 1`,
      )
      .get(seed.primary_instrument.spid) as { observed_at: string } | undefined;
    if (!row) {
      throw new TypeError(
        `FULL metadata for spid=${seed.primary_instrument.spid} is missing; run sync:market first`,
      );
    }
    latest.push(row.observed_at);
  }
  if (latest.length === 0) {
    throw new TypeError("seed catalog must not be empty");
  }
  return latest.sort()[0]!;
}

function cardStateForInstrument(
  db: DatabaseSync,
  input: {
    instrumentId: string;
    expectedPlayerId?: string;
  },
  asOf: string,
): CardState | null {
  const instrument = db
    .prepare(
      `SELECT i.spid, pc.player_id
       FROM instrument i
       JOIN player_card pc ON pc.spid = i.spid
       WHERE i.instrument_id = ?`,
    )
    .get(input.instrumentId) as { spid: string; player_id: string } | undefined;
  if (!instrument) {
    return null;
  }
  if (input.expectedPlayerId && instrument.player_id !== input.expectedPlayerId) {
    throw new TypeError(`instrument ${input.instrumentId} has a player identity conflict`);
  }

  const metadata = db
    .prepare(
      `SELECT metadata_snapshot_id, valid_from, valid_to, season_name, salary,
              positions_json, ovr, stats_json, team_colors_json
       FROM metadata_snapshot
       WHERE spid = ?
         AND completeness = 'FULL'
         AND valid_from <= ?
         AND (valid_to IS NULL OR ? < valid_to)
       ORDER BY valid_from DESC, metadata_snapshot_id DESC
       LIMIT 1`,
    )
    .get(instrument.spid, asOf, asOf) as
    | {
        metadata_snapshot_id: string;
        valid_from: string;
        valid_to: string | null;
        season_name: string;
        salary: number | null;
        positions_json: string | null;
        ovr: number | null;
        stats_json: string | null;
        team_colors_json: string | null;
      }
    | undefined;
  if (!metadata) {
    return null;
  }

  const teamColors = parseStringArray(
    metadata.team_colors_json,
    `metadata team_colors for spid=${instrument.spid}`,
  ).filter((value) => value !== metadata.season_name);

  return {
    instrument_id: input.instrumentId,
    spid: instrument.spid,
    player_id: instrument.player_id,
    metadata_snapshot_id: metadata.metadata_snapshot_id,
    valid_from: metadata.valid_from,
    valid_to: metadata.valid_to,
    season_name: metadata.season_name,
    salary: metadata.salary,
    ovr: metadata.ovr,
    primary_positions: parsePrimaryPositions(metadata.positions_json, instrument.spid),
    team_colors: teamColors,
    stats: parseStats(metadata.stats_json, instrument.spid),
  };
}

function primaryStateAt(
  db: DatabaseSync,
  seed: StructureSeedCatalog["seeds"][number],
  asOf: string,
): CardState {
  const instrumentId = `${seed.primary_instrument.spid}:${seed.primary_instrument.grade}`;
  const state = cardStateForInstrument(
    db,
    { instrumentId, expectedPlayerId: seed.player_key },
    asOf,
  );
  if (!state || state.spid !== seed.primary_instrument.spid) {
    throw new TypeError(
      `seed instrument ${instrumentId} with FULL metadata is unavailable at ${asOf}`,
    );
  }
  return state;
}

function relationStatesAt(
  db: DatabaseSync,
  catalog: StructureSeedCatalog,
  asOf: string,
  primaryStates: CardState[],
): CardState[] {
  const states = new Map(primaryStates.map((state) => [state.instrument_id, state]));
  const seedPlayers = new Set(catalog.seeds.map((seed) => seed.player_key));
  const instruments = db
    .prepare(
      `SELECT i.instrument_id, pc.player_id
       FROM instrument i
       JOIN player_card pc ON pc.spid = i.spid
       ORDER BY i.instrument_id`,
    )
    .all() as Array<{ instrument_id: string; player_id: string }>;
  for (const instrument of instruments) {
    if (!seedPlayers.has(instrument.player_id) || states.has(instrument.instrument_id)) {
      continue;
    }
    const state = cardStateForInstrument(
      db,
      { instrumentId: instrument.instrument_id, expectedPlayerId: instrument.player_id },
      asOf,
    );
    if (state) {
      states.set(state.instrument_id, state);
    }
  }
  return [...states.values()].sort((left, right) =>
    left.instrument_id.localeCompare(right.instrument_id),
  );
}

function insertCohortDefinition(
  db: DatabaseSync,
  input: {
    cohortId: string;
    name: string;
    aggregationLevel: "PLAYER" | "INSTRUMENT";
    ruleVersion: string;
    ruleParamsJson: string;
  },
): boolean {
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO cohort_definition(
        cohort_id, name, aggregation_level, rule_version, rule_params_json
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.cohortId,
      input.name,
      input.aggregationLevel,
      input.ruleVersion,
      input.ruleParamsJson,
    );
  const row = db
    .prepare(
      `SELECT name, aggregation_level, rule_version, rule_params_json
       FROM cohort_definition WHERE cohort_id = ?`,
    )
    .get(input.cohortId) as Record<string, unknown> | undefined;
  if (
    !row ||
    row.name !== input.name ||
    row.aggregation_level !== input.aggregationLevel ||
    row.rule_version !== input.ruleVersion ||
    row.rule_params_json !== input.ruleParamsJson
  ) {
    throw new TypeError(`cohort definition ${input.cohortId} conflicts with existing data`);
  }
  return Number(inserted.changes) === 1;
}

export function buildMarketStructure(
  db: DatabaseSync,
  catalog: StructureSeedCatalog,
  options: { asOf?: string } = {},
): BuildMarketStructureResult {
  if (catalog.seeds.length === 0) {
    throw new TypeError("seed catalog must not be empty");
  }
  const asOf = resolveAsOf(db, catalog, options.asOf);
  const primaryStates = catalog.seeds.map((seed) => primaryStateAt(db, seed, asOf));
  const states = relationStatesAt(db, catalog, asOf, primaryStates);

  db.exec("BEGIN IMMEDIATE");
  try {
    let relationsCreated = 0;
    let relationSnapshotsCreated = 0;
    let cohortDefinitionsCreated = 0;
    let cohortMembershipsCreated = 0;

    const sampleCohortId = `SAMPLE_MARKET:${catalog.catalog_id}`;
    const sampleParams = JSON.stringify({
      catalog_id: catalog.catalog_id,
      frozen_at: timestamp(catalog.frozen_at, "catalog.frozen_at"),
    });
    cohortDefinitionsCreated += insertCohortDefinition(db, {
      cohortId: sampleCohortId,
      name: "SAMPLE_MARKET",
      aggregationLevel: "PLAYER",
      ruleVersion: SAMPLE_MARKET_RULE_VERSION,
      ruleParamsJson: sampleParams,
    }) ? 1 : 0;

    for (const state of primaryStates) {
      const membership = db
        .prepare(
          `INSERT OR IGNORE INTO cohort_membership(
            cohort_id, instrument_id, valid_from, valid_to,
            membership_source, confidence
          ) VALUES (?, ?, ?, NULL, 'FROZEN_SEED_CATALOG', 1)`,
        )
        .run(sampleCohortId, state.instrument_id, timestamp(catalog.frozen_at, "catalog.frozen_at"));
      cohortMembershipsCreated += Number(membership.changes);
    }

    cohortDefinitionsCreated += insertCohortDefinition(db, {
      cohortId: "PACK_EXPOSED",
      name: "PACK_EXPOSED",
      aggregationLevel: "PLAYER",
      ruleVersion: "direct-exposure-v1",
      ruleParamsJson: JSON.stringify({ exposure_type: "DIRECT" }),
    }) ? 1 : 0;

    for (let leftIndex = 0; leftIndex < states.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < states.length; rightIndex += 1) {
        let left = states[leftIndex]!;
        let right = states[rightIndex]!;
        if (left.instrument_id > right.instrument_id) {
          [left, right] = [right, left];
        }
        const samePlayer = left.player_id === right.player_id;
        const sharedPositions = intersection(left.primary_positions, right.primary_positions);
        const samePosition = sharedPositions.length > 0;
        const sharedTeamColors = intersection(left.team_colors, right.team_colors);
        if (!samePlayer && !(samePosition && sharedTeamColors.length > 0)) {
          continue;
        }

        const validFrom = [left.valid_from, right.valid_from].sort().at(-1)!;
        const validTo = earliestNullable([left.valid_to, right.valid_to]);
        const relationId = deterministicId(
          "rel",
          left.instrument_id,
          right.instrument_id,
          left.metadata_snapshot_id,
          right.metadata_snapshot_id,
          RELATION_DEFINITION_VERSION,
        );
        const relationSource = samePlayer
          ? "SAME_PLAYER_FULL_METADATA"
          : "TEAM_COLOR_POSITION_FULL_METADATA";
        const relationInsert = db
          .prepare(
            `INSERT OR IGNORE INTO card_relation(
              relation_id, source_instrument, target_instrument,
              same_player, same_position, relation_source, valid_from, valid_to
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            relationId,
            left.instrument_id,
            right.instrument_id,
            samePlayer ? 1 : 0,
            samePosition ? 1 : 0,
            relationSource,
            validFrom,
            validTo,
          );
        relationsCreated += Number(relationInsert.changes);

        const leftPrice = latestPrice(db, left.instrument_id, asOf);
        const rightPrice = latestPrice(db, right.instrument_id, asOf);
        const leftUsage = latestUsageShare(db, left.spid, asOf);
        const rightUsage = latestUsageShare(db, right.spid, asOf);
        const snapshotInsert = db
          .prepare(
            `INSERT OR IGNORE INTO relation_snapshot(
              relation_id, as_of, shared_team_colors_json,
              salary_diff, ovr_diff, stat_distance, price_ratio,
              usage_distance, movement_similarity, definition_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          )
          .run(
            relationId,
            asOf,
            JSON.stringify(sharedTeamColors),
            left.salary === null || right.salary === null ? null : right.salary - left.salary,
            left.ovr === null || right.ovr === null ? null : right.ovr - left.ovr,
            statDistance(left.stats, right.stats),
            leftPrice === null || rightPrice === null ? null : Number((rightPrice / leftPrice).toFixed(8)),
            leftUsage === null || rightUsage === null ? null : Number(Math.abs(rightUsage - leftUsage).toFixed(8)),
            RELATION_DEFINITION_VERSION,
          );
        relationSnapshotsCreated += Number(snapshotInsert.changes);
      }
    }

    const directExposures = db
      .prepare(
        `SELECT exposure_id, instrument_id, valid_from, valid_to, confidence
         FROM exposure
         WHERE exposure_type = 'DIRECT'
           AND valid_from <= ?`,
      )
      .all(asOf) as Array<{
        exposure_id: string;
        instrument_id: string;
        valid_from: string;
        valid_to: string | null;
        confidence: number;
      }>;
    for (const exposure of directExposures) {
      const membership = db
        .prepare(
          `INSERT OR IGNORE INTO cohort_membership(
            cohort_id, instrument_id, valid_from, valid_to,
            membership_source, confidence
          ) VALUES ('PACK_EXPOSED', ?, ?, ?, ?, ?)`,
        )
        .run(
          exposure.instrument_id,
          exposure.valid_from,
          exposure.valid_to,
          `DIRECT_EXPOSURE:${exposure.exposure_id}`,
          exposure.confidence,
        );
      cohortMembershipsCreated += Number(membership.changes);
    }

    db.exec("COMMIT");
    return {
      as_of: asOf,
      relations_created: relationsCreated,
      relation_snapshots_created: relationSnapshotsCreated,
      cohort_definitions_created: cohortDefinitionsCreated,
      cohort_memberships_created: cohortMembershipsCreated,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
