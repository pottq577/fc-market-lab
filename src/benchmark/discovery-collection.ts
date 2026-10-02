import { createHash } from "node:crypto";

import {
  CollectionHaltedError,
  DEFAULT_COLLECTION_DELAY_MS,
  collectDatacenterPriceTarget,
  type CollectedPriceSnapshot,
  type PriceCollectionOptions,
  type PriceCollectionTarget,
} from "../collect/datacenter-price.ts";
import type {
  BenchmarkDiscoveryTarget,
  BenchmarkDiscoveryTargetDocument,
  BenchmarkGate1AResult,
} from "./gate1a.ts";

export type BenchmarkDiscoveryCollectionStatus =
  | "COLLECTED"
  | "NO_USABLE_PRICE"
  | "FAILED"
  | "HALTED";

export interface BenchmarkDiscoveryCollectionResult
  extends BenchmarkDiscoveryTarget {
  status: BenchmarkDiscoveryCollectionStatus;
  observed_at: string | null;
  raw_path: string | null;
  metadata_path: string | null;
  raw_sha256: string | null;
  point_count: number | null;
  native_granularity: string | null;
  history_span: string | null;
  error_message: string | null;
}

export interface BenchmarkDiscoveryBatchDocument {
  schema_version: 1;
  batch_id: string;
  discovery_frame_id: string;
  universe_snapshot_id: string;
  source_id: string;
  source_evidence_hash: string;
  automation_decision: string;
  rank_range: [number, number];
  started_at: string;
  completed_at: string;
  status: "COMPLETE" | "PARTIAL" | "HALTED";
  results: BenchmarkDiscoveryCollectionResult[];
}

export interface BenchmarkDiscoveryProgressEvent {
  index: number;
  total: number;
  result: BenchmarkDiscoveryCollectionResult;
}

export interface BenchmarkDiscoveryCollectionOptions {
  outputDir?: string;
  delayMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  onProgress?: (event: BenchmarkDiscoveryProgressEvent) => void;
  collectTarget?: (
    target: PriceCollectionTarget,
    options?: PriceCollectionOptions,
  ) => Promise<CollectedPriceSnapshot>;
}

function batchId(
  targets: BenchmarkDiscoveryTargetDocument,
  gate: BenchmarkGate1AResult,
  startedAt: string,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        discovery_frame_id: targets.discovery_frame_id,
        rank_range: [targets.from_rank, targets.to_rank],
        source_id: gate.source_id,
        source_evidence_hash: gate.evidence_hash,
        started_at: startedAt,
      }),
    )
    .digest("hex");
  return `discovery_batch_${digest}`;
}

function isNoUsablePriceFailure(message: string): boolean {
  return /(?:time must contain at least two (?:entries|date labels)|price graph must contain at least two points)/i.test(
    message,
  );
}

function asResult(
  target: BenchmarkDiscoveryTarget,
  collected: CollectedPriceSnapshot,
): BenchmarkDiscoveryCollectionResult {
  return {
    ...target,
    status: "COLLECTED",
    observed_at: collected.observed_at,
    raw_path: collected.raw_path,
    metadata_path: collected.metadata_path,
    raw_sha256: collected.raw_sha256,
    point_count: collected.point_count,
    native_granularity: collected.native_granularity,
    history_span: collected.history_span,
    error_message: null,
  };
}

export async function collectBenchmarkDiscoveryBatch(
  targets: BenchmarkDiscoveryTargetDocument,
  gate: BenchmarkGate1AResult,
  input: BenchmarkDiscoveryCollectionOptions = {},
): Promise<BenchmarkDiscoveryBatchDocument> {
  if (gate.status === "BLOCKED") {
    throw new TypeError(
      `Gate 1A is BLOCKED: ${gate.blockers.join("; ") || "unknown blocker"}`,
    );
  }
  if (gate.discovery_frame_id !== targets.discovery_frame_id) {
    throw new TypeError("Gate 1A result does not match discovery target document");
  }

  const delayMs = input.delayMs ?? DEFAULT_COLLECTION_DELAY_MS;
  if (!Number.isInteger(delayMs) || delayMs < 1_000) {
    throw new TypeError("delayMs must be an integer >= 1000");
  }
  const sleep =
    input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = input.now ?? (() => new Date());
  const collectTarget = input.collectTarget ?? collectDatacenterPriceTarget;
  const startedAt = now().toISOString();
  const results: BenchmarkDiscoveryCollectionResult[] = [];
  let halted = false;

  for (const [index, target] of targets.targets.entries()) {
    try {
      const collected = await collectTarget(
        { spid: target.spid, grade: target.grade },
        {
          ...(input.outputDir ? { outputDir: input.outputDir } : {}),
          delayMs,
          ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
          ...(input.maxRetries !== undefined
            ? { maxRetries: input.maxRetries }
            : {}),
          sleep,
        },
      );
      results.push(asResult(target, collected));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof CollectionHaltedError) {
        const result: BenchmarkDiscoveryCollectionResult = {
          ...target,
          status: "HALTED",
          observed_at: null,
          raw_path: null,
          metadata_path: null,
          raw_sha256: null,
          point_count: null,
          native_granularity: null,
          history_span: null,
          error_message: message,
        };
        results.push(result);
        input.onProgress?.({
          index: index + 1,
          total: targets.targets.length,
          result,
        });
        halted = true;
        break;
      }
      results.push({
        ...target,
        status: isNoUsablePriceFailure(message)
          ? "NO_USABLE_PRICE"
          : "FAILED",
        observed_at: null,
        raw_path: null,
        metadata_path: null,
        raw_sha256: null,
        point_count: null,
        native_granularity: null,
        history_span: null,
        error_message: message,
      });
    }

    input.onProgress?.({
      index: index + 1,
      total: targets.targets.length,
      result: results.at(-1)!,
    });

    if (index < targets.targets.length - 1) {
      await sleep(delayMs);
    }
  }

  const failed = results.some((result) => result.status === "FAILED");
  const completedAt = now().toISOString();
  return {
    schema_version: 1,
    batch_id: batchId(targets, gate, startedAt),
    discovery_frame_id: targets.discovery_frame_id,
    universe_snapshot_id: targets.universe_snapshot_id,
    source_id: gate.source_id,
    source_evidence_hash: gate.evidence_hash,
    automation_decision: gate.automation_decision,
    rank_range: [targets.from_rank, targets.to_rank],
    started_at: startedAt,
    completed_at: completedAt,
    status: halted ? "HALTED" : failed ? "PARTIAL" : "COMPLETE",
    results,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  context: string,
  nullable = false,
): string | null {
  const value = record[key];
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${context}.${key} must be a non-empty string`);
  }
  return value.trim();
}

function readNullableInteger(
  record: Record<string, unknown>,
  key: string,
  context: string,
): number | null {
  const value = record[key];
  if (value === null) return null;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new TypeError(`${context}.${key} must be a non-negative integer or null`);
  }
  return Number(value);
}

export function parseBenchmarkDiscoveryBatchDocument(
  value: unknown,
): BenchmarkDiscoveryBatchDocument {
  if (!isRecord(value) || value.schema_version !== 1) {
    throw new TypeError("batch.schema_version must be 1");
  }
  const status = readString(value, "status", "batch")!;
  if (!["COMPLETE", "PARTIAL", "HALTED"].includes(status)) {
    throw new TypeError("batch.status is invalid");
  }
  if (!Array.isArray(value.rank_range) || value.rank_range.length !== 2) {
    throw new TypeError("batch.rank_range must contain two integers");
  }
  const rankRange = value.rank_range.map(Number);
  if (
    !rankRange.every((item) => Number.isInteger(item) && item > 0) ||
    rankRange[0]! > rankRange[1]!
  ) {
    throw new TypeError("batch.rank_range is invalid");
  }
  if (!Array.isArray(value.results)) {
    throw new TypeError("batch.results must be an array");
  }

  const results = value.results.map((item, index) => {
    const context = `batch.results[${index}]`;
    if (!isRecord(item)) {
      throw new TypeError(`${context} must be an object`);
    }
    const resultStatus = readString(item, "status", context)!;
    if (
      !["COLLECTED", "NO_USABLE_PRICE", "FAILED", "HALTED"].includes(
        resultStatus,
      )
    ) {
      throw new TypeError(`${context}.status is invalid`);
    }
    const grade = Number(item.grade);
    const sampleRank = Number(item.sample_rank);
    if (!Number.isInteger(grade) || grade < 1 || grade > 13) {
      throw new TypeError(`${context}.grade must be 1-13`);
    }
    if (!Number.isInteger(sampleRank) || sampleRank <= 0) {
      throw new TypeError(`${context}.sample_rank must be positive`);
    }
    const result: BenchmarkDiscoveryCollectionResult = {
      sample_rank: sampleRank,
      player_id: readString(item, "player_id", context)!,
      player_name: readString(item, "player_name", context)!,
      spid: readString(item, "spid", context)!,
      grade,
      status: resultStatus as BenchmarkDiscoveryCollectionStatus,
      observed_at: readString(item, "observed_at", context, true),
      raw_path: readString(item, "raw_path", context, true),
      metadata_path: readString(item, "metadata_path", context, true),
      raw_sha256: readString(item, "raw_sha256", context, true),
      point_count: readNullableInteger(item, "point_count", context),
      native_granularity: readString(
        item,
        "native_granularity",
        context,
        true,
      ),
      history_span: readString(item, "history_span", context, true),
      error_message: readString(item, "error_message", context, true),
    };
    if (result.status === "COLLECTED") {
      for (const [field, fieldValue] of [
        ["observed_at", result.observed_at],
        ["raw_path", result.raw_path],
        ["metadata_path", result.metadata_path],
        ["raw_sha256", result.raw_sha256],
        ["native_granularity", result.native_granularity],
        ["history_span", result.history_span],
      ] as const) {
        if (fieldValue === null) {
          throw new TypeError(`${context}.${field} is required when COLLECTED`);
        }
      }
      if (result.point_count === null || result.point_count <= 0) {
        throw new TypeError(
          `${context}.point_count must be positive when COLLECTED`,
        );
      }
    }
    return result;
  });

  return {
    schema_version: 1,
    batch_id: readString(value, "batch_id", "batch")!,
    discovery_frame_id: readString(value, "discovery_frame_id", "batch")!,
    universe_snapshot_id: readString(value, "universe_snapshot_id", "batch")!,
    source_id: readString(value, "source_id", "batch")!,
    source_evidence_hash: readString(
      value,
      "source_evidence_hash",
      "batch",
    )!,
    automation_decision: readString(
      value,
      "automation_decision",
      "batch",
    )!,
    rank_range: [rankRange[0]!, rankRange[1]!],
    started_at: readString(value, "started_at", "batch")!,
    completed_at: readString(value, "completed_at", "batch")!,
    status: status as BenchmarkDiscoveryBatchDocument["status"],
    results,
  };
}
