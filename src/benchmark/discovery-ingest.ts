import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";

import type { SeedPlayer } from "../catalog/seed-catalog.ts";
import { buildDatacenterPriceCaptureEvidence } from "../evidence/datacenter-price-history.ts";
import { normalizePriceHistorySnapshot } from "../normalize/price-history.ts";
import type {
  BenchmarkDiscoveryBatchDocument,
  BenchmarkDiscoveryCollectionResult,
} from "./discovery-collection.ts";

export interface IngestBenchmarkDiscoveryResult {
  discovery_frame_id: string;
  batch_id: string;
  collected_results: number;
  no_usable_price_results: number;
  failed_results: number;
  halted_results: number;
  terminal_outcomes_recorded: number;
  source_snapshots_created: number;
  price_points_inserted: number;
  instruments_processed: number;
}

interface DiscoveryMemberRow {
  sample_rank: number | bigint;
  player_id: string;
  player_name: string;
  probe_spid: string;
  probe_season_name: string;
  probe_grade: number | bigint;
}

type TerminalOutcome = "OBSERVED" | "NO_USABLE_PRICE" | "FETCH_FAILED";

function sha256(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function seedFor(
  member: DiscoveryMemberRow,
  storagePlayerId: string,
): SeedPlayer {
  return {
    player_key: storagePlayerId,
    player_name: member.player_name,
    primary_instrument: {
      spid: member.probe_spid,
      grade: Number(member.probe_grade),
    },
    selection_observation: {
      section: "CLASS_USAGE",
      ranker_squad_count: 1,
      displayed_share_percent: 1,
    },
    selection_reason: "benchmark discovery probe",
  };
}

function discoveryMember(
  db: DatabaseSync,
  batch: BenchmarkDiscoveryBatchDocument,
  result: BenchmarkDiscoveryCollectionResult,
): DiscoveryMemberRow {
  const member = db
    .prepare(
      `SELECT sample_rank, player_id, player_name,
              probe_spid, probe_season_name, probe_grade
       FROM benchmark_discovery_member
       WHERE discovery_frame_id = ? AND sample_rank = ?`,
    )
    .get(batch.discovery_frame_id, result.sample_rank) as
    | DiscoveryMemberRow
    | undefined;
  if (!member) {
    throw new TypeError(
      `discovery member rank ${result.sample_rank} is missing from ${batch.discovery_frame_id}`,
    );
  }
  if (
    member.player_id !== result.player_id ||
    member.player_name !== result.player_name ||
    member.probe_spid !== result.spid ||
    Number(member.probe_grade) !== result.grade
  ) {
    throw new TypeError(
      `batch result rank ${result.sample_rank} does not match frozen discovery member`,
    );
  }
  return member;
}

function recordTerminalOutcome(
  db: DatabaseSync,
  batch: BenchmarkDiscoveryBatchDocument,
  member: DiscoveryMemberRow,
  outcome: TerminalOutcome,
  errorMessage: string | null,
): boolean {
  const existing = db
    .prepare(
      `SELECT player_id, spid, grade, outcome, error_message
       FROM benchmark_discovery_outcome
       WHERE discovery_frame_id = ? AND sample_rank = ?`,
    )
    .get(batch.discovery_frame_id, Number(member.sample_rank)) as
    | {
        player_id: string;
        spid: string;
        grade: number | bigint;
        outcome: TerminalOutcome;
        error_message: string | null;
      }
    | undefined;

  if (existing) {
    if (
      existing.player_id !== member.player_id ||
      existing.spid !== member.probe_spid ||
      Number(existing.grade) !== Number(member.probe_grade) ||
      existing.outcome !== outcome ||
      existing.error_message !== errorMessage
    ) {
      throw new TypeError(
        `terminal outcome conflict for discovery rank ${String(member.sample_rank)}`,
      );
    }
    return false;
  }

  const inserted = db
    .prepare(
      `INSERT INTO benchmark_discovery_outcome(
        discovery_frame_id, sample_rank, player_id, spid, grade,
        outcome, batch_id, source_id, completed_at, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      batch.discovery_frame_id,
      Number(member.sample_rank),
      member.player_id,
      member.probe_spid,
      Number(member.probe_grade),
      outcome,
      batch.batch_id,
      batch.source_id,
      batch.completed_at,
      errorMessage,
    );
  return Number(inserted.changes) === 1;
}

export async function ingestBenchmarkDiscoveryBatch(
  db: DatabaseSync,
  batch: BenchmarkDiscoveryBatchDocument,
  input: {
    readRaw?: (path: string) => Promise<Buffer>;
  } = {},
): Promise<IngestBenchmarkDiscoveryResult> {
  const frame = db
    .prepare(
      `SELECT universe_snapshot_id
       FROM benchmark_discovery_frame
       WHERE discovery_frame_id = ?`,
    )
    .get(batch.discovery_frame_id) as
    | { universe_snapshot_id: string }
    | undefined;
  if (!frame) {
    throw new TypeError(`unknown discovery frame: ${batch.discovery_frame_id}`);
  }
  if (frame.universe_snapshot_id !== batch.universe_snapshot_id) {
    throw new TypeError(
      `batch universe ${batch.universe_snapshot_id} does not match discovery frame ${frame.universe_snapshot_id}`,
    );
  }

  const readRaw = input.readRaw ?? ((path: string) => readFile(path));
  let sourceSnapshotsCreated = 0;
  let pricePointsInserted = 0;
  let instrumentsProcessed = 0;
  let terminalOutcomesRecorded = 0;
  let collectedResults = 0;
  let noUsablePriceResults = 0;
  let failedResults = 0;
  let haltedResults = 0;

  for (const result of batch.results) {
    if (result.status === "HALTED") {
      haltedResults += 1;
      continue;
    }

    const member = discoveryMember(db, batch, result);
    if (result.status === "NO_USABLE_PRICE") {
      noUsablePriceResults += 1;
      const message = result.error_message ?? "price history is unavailable";
      terminalOutcomesRecorded += recordTerminalOutcome(
        db,
        batch,
        member,
        "NO_USABLE_PRICE",
        message,
      )
        ? 1
        : 0;
      continue;
    }
    if (result.status === "FAILED") {
      failedResults += 1;
      const message = result.error_message ?? "price collection failed";
      terminalOutcomesRecorded += recordTerminalOutcome(
        db,
        batch,
        member,
        "FETCH_FAILED",
        message,
      )
        ? 1
        : 0;
      continue;
    }

    collectedResults += 1;
    if (
      result.raw_path === null ||
      result.raw_sha256 === null ||
      result.observed_at === null
    ) {
      throw new TypeError(
        `COLLECTED result rank ${result.sample_rank} is missing raw provenance`,
      );
    }

    const raw = await readRaw(result.raw_path);
    const rawHash = sha256(raw);
    if (rawHash !== result.raw_sha256) {
      throw new TypeError(
        `raw hash mismatch for discovery rank ${result.sample_rank}: ${rawHash} != ${result.raw_sha256}`,
      );
    }
    const evidence = buildDatacenterPriceCaptureEvidence({
      raw: raw.toString("utf8"),
      spid: result.spid,
      grade: result.grade,
      observed_at: result.observed_at,
    });
    if (
      evidence.raw_sha256 !== result.raw_sha256 ||
      evidence.point_count !== result.point_count
    ) {
      throw new TypeError(
        `parsed evidence does not match collection manifest for discovery rank ${result.sample_rank}`,
      );
    }

    const existingCard = db
      .prepare(
        `SELECT player_id, season
         FROM player_card
         WHERE spid = ?`,
      )
      .get(result.spid) as
      | { player_id: string; season: string }
      | undefined;
    if (
      existingCard &&
      existingCard.season !== member.probe_season_name
    ) {
      throw new TypeError(
        `existing player_card ${result.spid} season=${existingCard.season} conflicts with discovery season=${member.probe_season_name}`,
      );
    }
    const storagePlayerId = existingCard?.player_id ?? member.player_id;
    const normalized = normalizePriceHistorySnapshot(db, {
      seed: seedFor(member, storagePlayerId),
      expected: {
        spid: result.spid,
        grade: result.grade,
        class_code: member.probe_season_name,
        observed_at: result.observed_at,
        raw_sha256: result.raw_sha256,
        point_count: evidence.point_count,
        first_source_date: evidence.first_source_date,
        last_source_date: evidence.last_source_date,
        observed_span_days: evidence.observed_span_days,
        native_granularity: evidence.native_granularity,
      },
      raw,
      source_id: batch.source_id,
      capture_method: "OFFICIAL_WEB_UI_OPERATOR_BATCH",
    });
    sourceSnapshotsCreated += normalized.source_snapshot_created ? 1 : 0;
    pricePointsInserted += normalized.price_points_inserted;
    instrumentsProcessed += 1;
    terminalOutcomesRecorded += recordTerminalOutcome(
      db,
      batch,
      member,
      "OBSERVED",
      null,
    )
      ? 1
      : 0;
  }

  return {
    discovery_frame_id: batch.discovery_frame_id,
    batch_id: batch.batch_id,
    collected_results: collectedResults,
    no_usable_price_results: noUsablePriceResults,
    failed_results: failedResults,
    halted_results: haltedResults,
    terminal_outcomes_recorded: terminalOutcomesRecorded,
    source_snapshots_created: sourceSnapshotsCreated,
    price_points_inserted: pricePointsInserted,
    instruments_processed: instrumentsProcessed,
  };
}
