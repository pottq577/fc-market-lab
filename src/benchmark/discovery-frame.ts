import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const BENCHMARK_DISCOVERY_VERSION = "benchmark-discovery-v1";
export const DEFAULT_DISCOVERY_TARGET_SIZE = 1_600;
export const DEFAULT_DISCOVERY_SAMPLE_SEED = "market-benchmark-v1";
export const DEFAULT_DISCOVERY_PROBE_GRADE = 1;

interface UniversePlayerRow {
  player_id: string;
  player_name: string;
}

interface UniverseCardRow {
  player_id: string;
  spid: string;
  season_id: number | bigint;
  season_name: string;
}

interface RankedPlayer extends UniversePlayerRow {
  selection_hash: string;
}

interface RankedCard extends UniverseCardRow {
  card_selection_hash: string;
}

export interface BenchmarkDiscoveryFrameResult {
  discovery_frame_id: string;
  universe_snapshot_id: string;
  frame_version: string;
  sample_seed: string;
  target_size: number;
  population_count: number;
  probe_grade: number;
  inclusion_probability: number;
  population_weight: number;
  created: boolean;
}

export interface BenchmarkDiscoveryTarget {
  sample_rank: number;
  player_id: string;
  player_name: string;
  spid: string;
  grade: number;
}

function hash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${hash(...parts)}`;
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

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}

function probeGrade(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 13) {
    throw new TypeError("probeGrade must be an integer from 1 to 13");
  }
  return value;
}

export function buildBenchmarkDiscoveryFrame(
  db: DatabaseSync,
  input: {
    universeSnapshotId: string;
    targetSize?: number;
    sampleSeed?: string;
    probeGrade?: number;
    frameVersion?: string;
    createdAt?: string;
  },
): BenchmarkDiscoveryFrameResult {
  const universeSnapshotId = input.universeSnapshotId.trim();
  if (universeSnapshotId === "") {
    throw new TypeError("universeSnapshotId must not be empty");
  }
  const targetSize = positiveInteger(
    input.targetSize ?? DEFAULT_DISCOVERY_TARGET_SIZE,
    "targetSize",
  );
  const sampleSeed = input.sampleSeed ?? DEFAULT_DISCOVERY_SAMPLE_SEED;
  if (sampleSeed.trim() === "") {
    throw new TypeError("sampleSeed must not be empty");
  }
  const grade = probeGrade(input.probeGrade ?? DEFAULT_DISCOVERY_PROBE_GRADE);
  const frameVersion = input.frameVersion ?? BENCHMARK_DISCOVERY_VERSION;
  if (frameVersion.trim() === "") {
    throw new TypeError("frameVersion must not be empty");
  }
  const createdAt = normalizeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "createdAt",
  );

  const snapshot = db
    .prepare(
      `SELECT catalog_player_count
       FROM market_universe_snapshot
       WHERE universe_snapshot_id = ?`,
    )
    .get(universeSnapshotId) as
    | { catalog_player_count: number | bigint }
    | undefined;
  if (!snapshot) {
    throw new TypeError(`unknown universe snapshot: ${universeSnapshotId}`);
  }

  const players = db
    .prepare(
      `SELECT player_id, player_name
       FROM market_universe_member
       WHERE universe_snapshot_id = ?
       ORDER BY player_id`,
    )
    .all(universeSnapshotId) as UniversePlayerRow[];
  const populationCount = Number(snapshot.catalog_player_count);
  if (players.length !== populationCount) {
    throw new Error(
      `universe snapshot ${universeSnapshotId} has ${players.length} members, expected ${populationCount}`,
    );
  }
  if (targetSize > populationCount) {
    throw new TypeError(
      `targetSize ${targetSize} exceeds catalog population ${populationCount}`,
    );
  }

  const cards = db
    .prepare(
      `SELECT player_id, spid, season_id, season_name
       FROM market_universe_card
       WHERE universe_snapshot_id = ?
       ORDER BY player_id, spid`,
    )
    .all(universeSnapshotId) as UniverseCardRow[];
  const cardsByPlayer = new Map<string, UniverseCardRow[]>();
  for (const card of cards) {
    const values = cardsByPlayer.get(card.player_id) ?? [];
    values.push(card);
    cardsByPlayer.set(card.player_id, values);
  }

  const rankedPlayers: RankedPlayer[] = players
    .map((player) => ({
      ...player,
      selection_hash: hash(
        "discovery-player",
        universeSnapshotId,
        frameVersion,
        sampleSeed,
        player.player_id,
      ),
    }))
    .sort(
      (left, right) =>
        left.selection_hash.localeCompare(right.selection_hash) ||
        left.player_id.localeCompare(right.player_id),
    );

  const selected = rankedPlayers.slice(0, targetSize);
  const inclusionProbability = targetSize / populationCount;
  const populationWeight = populationCount / targetSize;
  const frameIdentity = JSON.stringify({
    universe_snapshot_id: universeSnapshotId,
    frame_version: frameVersion,
    sample_seed: sampleSeed,
    target_size: targetSize,
    probe_grade: grade,
  });
  const discoveryFrameId = deterministicId("discovery", frameIdentity);

  db.exec("BEGIN IMMEDIATE");
  try {
    const frameInsert = db
      .prepare(
        `INSERT OR IGNORE INTO benchmark_discovery_frame(
          discovery_frame_id, universe_snapshot_id, frame_version,
          sample_seed, target_size, population_count, probe_grade,
          inclusion_probability, population_weight, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        discoveryFrameId,
        universeSnapshotId,
        frameVersion,
        sampleSeed,
        targetSize,
        populationCount,
        grade,
        inclusionProbability,
        populationWeight,
        createdAt,
      );

    const memberInsert = db.prepare(
      `INSERT OR IGNORE INTO benchmark_discovery_member(
        discovery_frame_id, sample_rank, player_id, player_name,
        probe_spid, probe_season_id, probe_season_name, probe_grade,
        selection_hash, card_selection_hash,
        inclusion_probability, population_weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const [index, player] of selected.entries()) {
      const playerCards = cardsByPlayer.get(player.player_id) ?? [];
      if (playerCards.length === 0) {
        throw new Error(
          `universe player ${player.player_id} has no catalog cards`,
        );
      }
      const rankedCards: RankedCard[] = playerCards
        .map((card) => ({
          ...card,
          card_selection_hash: hash(
            "discovery-card",
            universeSnapshotId,
            frameVersion,
            sampleSeed,
            player.player_id,
            card.spid,
          ),
        }))
        .sort(
          (left, right) =>
            left.card_selection_hash.localeCompare(right.card_selection_hash) ||
            left.spid.localeCompare(right.spid),
        );
      const card = rankedCards[0]!;
      memberInsert.run(
        discoveryFrameId,
        index + 1,
        player.player_id,
        player.player_name,
        card.spid,
        Number(card.season_id),
        card.season_name,
        grade,
        player.selection_hash,
        card.card_selection_hash,
        inclusionProbability,
        populationWeight,
      );
    }

    const persisted = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM benchmark_discovery_member
         WHERE discovery_frame_id = ?`,
      )
      .get(discoveryFrameId) as { count: number | bigint };
    if (Number(persisted.count) !== targetSize) {
      throw new Error(
        `discovery frame ${discoveryFrameId} has ${String(persisted.count)} members, expected ${targetSize}`,
      );
    }

    db.exec("COMMIT");
    return {
      discovery_frame_id: discoveryFrameId,
      universe_snapshot_id: universeSnapshotId,
      frame_version: frameVersion,
      sample_seed: sampleSeed,
      target_size: targetSize,
      population_count: populationCount,
      probe_grade: grade,
      inclusion_probability: inclusionProbability,
      population_weight: populationWeight,
      created: Number(frameInsert.changes) === 1,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function benchmarkDiscoveryTargets(
  db: DatabaseSync,
  discoveryFrameId: string,
  input: { fromRank?: number; toRank?: number } = {},
): BenchmarkDiscoveryTarget[] {
  const frame = db
    .prepare(
      `SELECT target_size
       FROM benchmark_discovery_frame
       WHERE discovery_frame_id = ?`,
    )
    .get(discoveryFrameId) as { target_size: number | bigint } | undefined;
  if (!frame) {
    throw new TypeError(`unknown discovery frame: ${discoveryFrameId}`);
  }

  const targetSize = Number(frame.target_size);
  const fromRank = positiveInteger(input.fromRank ?? 1, "fromRank");
  const toRank = positiveInteger(input.toRank ?? targetSize, "toRank");
  if (fromRank > toRank) {
    throw new TypeError("fromRank must be <= toRank");
  }
  if (toRank > targetSize) {
    throw new TypeError(`toRank ${toRank} exceeds target size ${targetSize}`);
  }

  return db
    .prepare(
      `SELECT sample_rank, player_id, player_name,
              probe_spid AS spid, probe_grade AS grade
       FROM benchmark_discovery_member
       WHERE discovery_frame_id = ?
         AND sample_rank BETWEEN ? AND ?
       ORDER BY sample_rank`,
    )
    .all(discoveryFrameId, fromRank, toRank)
    .map((row) => ({ ...row })) as BenchmarkDiscoveryTarget[];
}
