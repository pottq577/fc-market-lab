import type { DatabaseSync } from "node:sqlite";

import { benchmarkDiscoveryTargets } from "./discovery-frame.ts";
import {
  BENCHMARK_GATE_1A_MAX_BATCH_SIZE,
  BENCHMARK_GATE_1A_SOURCE_ID,
  type BenchmarkDiscoveryTargetDocument,
} from "./gate1a.ts";

const OPERATOR_BATCH_CAPTURE_METHOD = "OFFICIAL_WEB_UI_OPERATOR_BATCH";
export const MIN_DISCOVERY_RESPONSE_COVERAGE = 0.8;

export type BenchmarkDiscoveryReadiness =
  | "IN_PROGRESS"
  | "READY_FOR_PANEL"
  | "INSUFFICIENT_DISCOVERY_COVERAGE";

export interface BenchmarkDiscoveryStatus {
  discovery_frame_id: string;
  universe_snapshot_id: string;
  target_size: number;
  attempted_count: number;
  observed_count: number;
  ingested_count: number;
  no_usable_price_count: number;
  failed_count: number;
  pending_count: number;
  completion_ratio: number;
  response_coverage: number;
  minimum_response_coverage: number;
  readiness: BenchmarkDiscoveryReadiness;
  contiguous_completed_rank: number;
  next_rank_range: [number, number] | null;
  minimum_panel_capacity: {
    p100: boolean;
    p200: boolean;
    p400: boolean;
    p800: boolean;
  };
}

interface FrameRow {
  discovery_frame_id: string;
  universe_snapshot_id: string;
  target_size: number | bigint;
}

interface OutcomeRow {
  sample_rank: number | bigint;
  outcome: "OBSERVED" | "NO_USABLE_PRICE" | "FETCH_FAILED";
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}

export function resolveBenchmarkDiscoveryFrameId(
  db: DatabaseSync,
  requested?: string,
): string {
  if (requested !== undefined) {
    const value = requested.trim();
    if (value === "") {
      throw new TypeError("discoveryFrameId must not be empty");
    }
    const row = db
      .prepare(
        `SELECT discovery_frame_id
         FROM benchmark_discovery_frame
         WHERE discovery_frame_id = ?`,
      )
      .get(value) as { discovery_frame_id: string } | undefined;
    if (!row) {
      throw new TypeError(`unknown discovery frame: ${value}`);
    }
    return row.discovery_frame_id;
  }

  const latest = db
    .prepare(
      `SELECT discovery_frame_id
       FROM benchmark_discovery_frame
       ORDER BY created_at DESC, discovery_frame_id DESC
       LIMIT 1`,
    )
    .get() as { discovery_frame_id: string } | undefined;
  if (!latest) {
    throw new TypeError("no benchmark discovery frame exists");
  }
  return latest.discovery_frame_id;
}

function frameRow(db: DatabaseSync, discoveryFrameId: string): FrameRow {
  const frame = db
    .prepare(
      `SELECT discovery_frame_id, universe_snapshot_id, target_size
       FROM benchmark_discovery_frame
       WHERE discovery_frame_id = ?`,
    )
    .get(discoveryFrameId) as FrameRow | undefined;
  if (!frame) {
    throw new TypeError(`unknown discovery frame: ${discoveryFrameId}`);
  }
  return frame;
}

function observedRanks(db: DatabaseSync, discoveryFrameId: string): Set<number> {
  const rows = db
    .prepare(
      `SELECT bdm.sample_rank
       FROM benchmark_discovery_member bdm
       WHERE bdm.discovery_frame_id = ?
         AND EXISTS (
           SELECT 1
           FROM instrument i
           JOIN source_snapshot ss
             ON ss.source_ref = i.instrument_id
           JOIN price_point pp
             ON pp.source_snapshot_id = ss.source_snapshot_id
            AND pp.instrument_id = i.instrument_id
           WHERE i.spid = bdm.probe_spid
             AND i.grade = bdm.probe_grade
             AND ss.source_id = ?
             AND ss.capture_method = ?
             AND ss.parse_status = 'PARSED'
         )
       ORDER BY bdm.sample_rank`,
    )
    .all(
      discoveryFrameId,
      BENCHMARK_GATE_1A_SOURCE_ID,
      OPERATOR_BATCH_CAPTURE_METHOD,
    ) as Array<{ sample_rank: number | bigint }>;
  return new Set(rows.map((row) => Number(row.sample_rank)));
}

function storedOutcomes(
  db: DatabaseSync,
  discoveryFrameId: string,
): OutcomeRow[] {
  return db
    .prepare(
      `SELECT sample_rank, outcome
       FROM benchmark_discovery_outcome
       WHERE discovery_frame_id = ?
       ORDER BY sample_rank`,
    )
    .all(discoveryFrameId) as OutcomeRow[];
}

function nextPendingRange(
  targetSize: number,
  terminal: Set<number>,
  batchSize: number,
): [number, number] | null {
  let start = 1;
  while (start <= targetSize && terminal.has(start)) start += 1;
  if (start > targetSize) return null;

  let end = start;
  while (
    end < targetSize &&
    end - start + 1 < batchSize &&
    !terminal.has(end + 1)
  ) {
    end += 1;
  }
  return [start, end];
}

function ratio(numerator: number, denominator: number): number {
  return Number((numerator / denominator).toFixed(6));
}

export function benchmarkDiscoveryStatus(
  db: DatabaseSync,
  discoveryFrameId: string,
  input: { batchSize?: number } = {},
): BenchmarkDiscoveryStatus {
  const batchSize = positiveInteger(
    input.batchSize ?? BENCHMARK_GATE_1A_MAX_BATCH_SIZE,
    "batchSize",
  );
  if (batchSize > BENCHMARK_GATE_1A_MAX_BATCH_SIZE) {
    throw new TypeError(
      `batchSize ${batchSize} exceeds Gate 1A maximum ${BENCHMARK_GATE_1A_MAX_BATCH_SIZE}`,
    );
  }

  const frame = frameRow(db, discoveryFrameId);
  const targetSize = Number(frame.target_size);
  const observed = observedRanks(db, discoveryFrameId);
  const noUsablePrice = new Set<number>();
  const failed = new Set<number>();

  for (const row of storedOutcomes(db, discoveryFrameId)) {
    const rank = Number(row.sample_rank);
    if (row.outcome === "OBSERVED") {
      observed.add(rank);
    } else if (row.outcome === "NO_USABLE_PRICE") {
      if (!observed.has(rank)) noUsablePrice.add(rank);
    } else if (!observed.has(rank)) {
      failed.add(rank);
    }
  }

  const terminal = new Set<number>([
    ...observed,
    ...noUsablePrice,
    ...failed,
  ]);
  let contiguousCompletedRank = 0;
  while (
    contiguousCompletedRank < targetSize &&
    terminal.has(contiguousCompletedRank + 1)
  ) {
    contiguousCompletedRank += 1;
  }

  const observedCount = observed.size;
  const attemptedCount = terminal.size;
  const completionRatio = ratio(attemptedCount, targetSize);
  const responseCoverage = ratio(observedCount, targetSize);
  const readiness: BenchmarkDiscoveryReadiness =
    attemptedCount < targetSize
      ? "IN_PROGRESS"
      : responseCoverage >= MIN_DISCOVERY_RESPONSE_COVERAGE
        ? "READY_FOR_PANEL"
        : "INSUFFICIENT_DISCOVERY_COVERAGE";

  return {
    discovery_frame_id: discoveryFrameId,
    universe_snapshot_id: frame.universe_snapshot_id,
    target_size: targetSize,
    attempted_count: attemptedCount,
    observed_count: observedCount,
    ingested_count: observedCount,
    no_usable_price_count: noUsablePrice.size,
    failed_count: failed.size,
    pending_count: targetSize - attemptedCount,
    completion_ratio: completionRatio,
    response_coverage: responseCoverage,
    minimum_response_coverage: MIN_DISCOVERY_RESPONSE_COVERAGE,
    readiness,
    contiguous_completed_rank: contiguousCompletedRank,
    next_rank_range: nextPendingRange(targetSize, terminal, batchSize),
    minimum_panel_capacity: {
      p100: observedCount >= 100,
      p200: observedCount >= 200,
      p400: observedCount >= 400,
      p800: observedCount >= 800,
    },
  };
}

export function nextBenchmarkDiscoveryTargetDocument(
  db: DatabaseSync,
  discoveryFrameId: string,
  input: { batchSize?: number } = {},
): BenchmarkDiscoveryTargetDocument | null {
  const status = benchmarkDiscoveryStatus(db, discoveryFrameId, input);
  if (!status.next_rank_range) return null;

  const universe = db
    .prepare(
      `SELECT as_of
       FROM market_universe_snapshot
       WHERE universe_snapshot_id = ?`,
    )
    .get(status.universe_snapshot_id) as { as_of: string } | undefined;
  if (!universe) {
    throw new Error(
      `discovery frame ${discoveryFrameId} references missing universe ${status.universe_snapshot_id}`,
    );
  }

  const [fromRank, toRank] = status.next_rank_range;
  return {
    schema_version: 1,
    discovery_frame_id: status.discovery_frame_id,
    universe_snapshot_id: status.universe_snapshot_id,
    universe_as_of: universe.as_of,
    from_rank: fromRank,
    to_rank: toRank,
    targets: benchmarkDiscoveryTargets(db, discoveryFrameId, {
      fromRank,
      toRank,
    }),
  };
}
