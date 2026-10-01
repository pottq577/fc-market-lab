import type { DatabaseSync } from "node:sqlite";

import type { SourceViabilityDocument } from "../gates/source-viability.ts";

export const BENCHMARK_GATE_1A_SOURCE_ID =
  "fconline-datacenter-price-history";
export const BENCHMARK_GATE_1A_MAX_BATCH_SIZE = 100;
export const BENCHMARK_GATE_1A_MAX_POLICY_AGE_DAYS = 30;

export type BenchmarkGate1AStatus =
  | "READY_OPERATOR_BATCH"
  | "READY_AUTOMATION"
  | "BLOCKED";

export interface BenchmarkDiscoveryTarget {
  sample_rank: number;
  player_id: string;
  player_name: string;
  spid: string;
  grade: number;
}

export interface BenchmarkDiscoveryTargetDocument {
  schema_version: 1;
  discovery_frame_id: string;
  universe_snapshot_id: string;
  universe_as_of: string;
  from_rank: number;
  to_rank: number;
  targets: BenchmarkDiscoveryTarget[];
}

export interface BenchmarkGate1AResult {
  status: BenchmarkGate1AStatus;
  discovery_frame_id: string;
  universe_snapshot_id: string;
  batch_size: number;
  rank_range: [number, number];
  source_id: string;
  automation_decision: string;
  price_semantics: string;
  native_granularity: string;
  policy_checked_at: string;
  policy_age_days: number | null;
  evidence_hash: string;
  blockers: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN = "UNKNOWN";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${context}.${key} must be a non-empty string`);
  }
  return value.trim();
}

function positiveInteger(
  record: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = record[key];
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${context}.${key} must be a positive integer`);
  }
  return Number(value);
}

function explicitTimestamp(value: string, field: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${field} must include an explicit timezone`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
  return parsed.toISOString();
}

function parseTarget(value: unknown, index: number): BenchmarkDiscoveryTarget {
  const context = `document.targets[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const grade = positiveInteger(value, "grade", context);
  if (grade > 13) {
    throw new TypeError(`${context}.grade must be an integer from 1 to 13`);
  }
  const spid = requiredString(value, "spid", context);
  if (!/^\d{9}$/.test(spid)) {
    throw new TypeError(`${context}.spid must contain exactly 9 digits`);
  }
  return {
    sample_rank: positiveInteger(value, "sample_rank", context),
    player_id: requiredString(value, "player_id", context),
    player_name: requiredString(value, "player_name", context),
    spid,
    grade,
  };
}

export function parseBenchmarkDiscoveryTargetDocument(
  value: unknown,
): BenchmarkDiscoveryTargetDocument {
  if (!isRecord(value) || value.schema_version !== 1) {
    throw new TypeError("document.schema_version must be 1");
  }
  const discoveryFrameId = requiredString(
    value,
    "discovery_frame_id",
    "document",
  );
  const universeSnapshotId = requiredString(
    value,
    "universe_snapshot_id",
    "document",
  );
  const universeAsOf = explicitTimestamp(
    requiredString(value, "universe_as_of", "document"),
    "document.universe_as_of",
  );
  const fromRank = positiveInteger(value, "from_rank", "document");
  const toRank = positiveInteger(value, "to_rank", "document");
  if (fromRank > toRank) {
    throw new TypeError("document.from_rank must be <= document.to_rank");
  }
  if (!Array.isArray(value.targets) || value.targets.length === 0) {
    throw new TypeError("document.targets must be a non-empty array");
  }
  const targets = value.targets.map(parseTarget);
  if (targets.length !== toRank - fromRank + 1) {
    throw new TypeError(
      "document.targets length must match the inclusive rank range",
    );
  }
  for (const [index, target] of targets.entries()) {
    const expectedRank = fromRank + index;
    if (target.sample_rank !== expectedRank) {
      throw new TypeError(
        `document.targets[${index}].sample_rank must be ${expectedRank}`,
      );
    }
  }
  return {
    schema_version: 1,
    discovery_frame_id: discoveryFrameId,
    universe_snapshot_id: universeSnapshotId,
    universe_as_of: universeAsOf,
    from_rank: fromRank,
    to_rank: toRank,
    targets,
  };
}

function validateTargetsAgainstFrame(
  db: DatabaseSync,
  document: BenchmarkDiscoveryTargetDocument,
): void {
  const frame = db
    .prepare(
      `SELECT universe_snapshot_id, target_size, probe_grade
       FROM benchmark_discovery_frame
       WHERE discovery_frame_id = ?`,
    )
    .get(document.discovery_frame_id) as
    | {
        universe_snapshot_id: string;
        target_size: number | bigint;
        probe_grade: number | bigint;
      }
    | undefined;
  if (!frame) {
    throw new TypeError(
      `unknown discovery frame: ${document.discovery_frame_id}`,
    );
  }
  if (frame.universe_snapshot_id !== document.universe_snapshot_id) {
    throw new TypeError(
      `discovery frame universe ${frame.universe_snapshot_id} does not match target document ${document.universe_snapshot_id}`,
    );
  }
  if (document.to_rank > Number(frame.target_size)) {
    throw new TypeError(
      `target rank ${document.to_rank} exceeds discovery frame size ${String(frame.target_size)}`,
    );
  }

  const rows = db
    .prepare(
      `SELECT sample_rank, player_id, player_name,
              probe_spid, probe_grade
       FROM benchmark_discovery_member
       WHERE discovery_frame_id = ?
         AND sample_rank BETWEEN ? AND ?
       ORDER BY sample_rank`,
    )
    .all(
      document.discovery_frame_id,
      document.from_rank,
      document.to_rank,
    ) as Array<{
    sample_rank: number | bigint;
    player_id: string;
    player_name: string;
    probe_spid: string;
    probe_grade: number | bigint;
  }>;
  if (rows.length !== document.targets.length) {
    throw new TypeError(
      `discovery frame rank range resolved to ${rows.length} members, expected ${document.targets.length}`,
    );
  }

  for (const [index, target] of document.targets.entries()) {
    const row = rows[index]!;
    if (
      Number(row.sample_rank) !== target.sample_rank ||
      row.player_id !== target.player_id ||
      row.player_name !== target.player_name ||
      row.probe_spid !== target.spid ||
      Number(row.probe_grade) !== target.grade ||
      target.grade !== Number(frame.probe_grade)
    ) {
      throw new TypeError(
        `target rank ${target.sample_rank} does not match frozen discovery frame membership`,
      );
    }
  }
}

export function evaluateBenchmarkGate1A(
  db: DatabaseSync,
  targets: BenchmarkDiscoveryTargetDocument,
  sourceDocument: SourceViabilityDocument,
  input: {
    asOf?: string;
    maxBatchSize?: number;
    maxPolicyAgeDays?: number;
  } = {},
): BenchmarkGate1AResult {
  validateTargetsAgainstFrame(db, targets);

  const maxBatchSize =
    input.maxBatchSize ?? BENCHMARK_GATE_1A_MAX_BATCH_SIZE;
  if (!Number.isInteger(maxBatchSize) || maxBatchSize <= 0) {
    throw new TypeError("maxBatchSize must be a positive integer");
  }
  const maxPolicyAgeDays =
    input.maxPolicyAgeDays ?? BENCHMARK_GATE_1A_MAX_POLICY_AGE_DAYS;
  if (!Number.isInteger(maxPolicyAgeDays) || maxPolicyAgeDays <= 0) {
    throw new TypeError("maxPolicyAgeDays must be a positive integer");
  }
  const asOf = explicitTimestamp(
    input.asOf ?? new Date().toISOString(),
    "asOf",
  );
  const source = sourceDocument.evidence.find(
    (item) => item.source_id === BENCHMARK_GATE_1A_SOURCE_ID,
  );
  if (!source) {
    throw new TypeError(
      `source viability evidence is missing ${BENCHMARK_GATE_1A_SOURCE_ID}`,
    );
  }

  const blockers: string[] = [];
  if (targets.targets.length > maxBatchSize) {
    blockers.push(
      `batch size ${targets.targets.length} exceeds Gate 1A maximum ${maxBatchSize}`,
    );
  }
  if (source.purpose !== "PRICE_HISTORY") {
    blockers.push(`purpose=${source.purpose} is not PRICE_HISTORY`);
  }
  if (source.price_semantics !== "MARKET_REFERENCE_PRICE") {
    blockers.push(
      `price_semantics=${source.price_semantics} is not MARKET_REFERENCE_PRICE`,
    );
  }
  if (source.native_granularity !== "P1D") {
    blockers.push(
      `native_granularity=${source.native_granularity} is not P1D`,
    );
  }
  for (const [field, value] of [
    ["source_url", source.source_url],
    ["policy_url", source.policy_url],
    ["access_method", source.access_method],
    ["history_span", source.history_span],
    ["evidence_hash", source.evidence_hash],
  ] as const) {
    if (value === UNKNOWN) {
      blockers.push(`${field}=UNKNOWN`);
    }
  }

  const checkedAtMs = Date.parse(source.policy_checked_at);
  const asOfMs = Date.parse(asOf);
  let policyAgeDays: number | null = null;
  if (Number.isNaN(checkedAtMs)) {
    blockers.push("policy_checked_at is invalid");
  } else if (checkedAtMs > asOfMs) {
    blockers.push("policy_checked_at is after Gate 1A asOf");
  } else {
    policyAgeDays = (asOfMs - checkedAtMs) / DAY_MS;
    if (policyAgeDays > maxPolicyAgeDays) {
      blockers.push(
        `policy evidence age ${policyAgeDays.toFixed(2)}d exceeds ${maxPolicyAgeDays}d`,
      );
    }
  }

  if (
    source.automation_decision !== "MANUAL_ONLY" &&
    source.automation_decision !== "ALLOWED"
  ) {
    blockers.push(
      `automation_decision=${source.automation_decision} is not executable for an operator batch`,
    );
  }

  let status: BenchmarkGate1AStatus = "BLOCKED";
  if (blockers.length === 0) {
    status =
      source.automation_decision === "ALLOWED"
        ? "READY_AUTOMATION"
        : "READY_OPERATOR_BATCH";
  }

  return {
    status,
    discovery_frame_id: targets.discovery_frame_id,
    universe_snapshot_id: targets.universe_snapshot_id,
    batch_size: targets.targets.length,
    rank_range: [targets.from_rank, targets.to_rank],
    source_id: source.source_id,
    automation_decision: source.automation_decision,
    price_semantics: source.price_semantics,
    native_granularity: source.native_granularity,
    policy_checked_at: source.policy_checked_at,
    policy_age_days:
      policyAgeDays === null ? null : Number(policyAgeDays.toFixed(6)),
    evidence_hash: source.evidence_hash,
    blockers,
  };
}
