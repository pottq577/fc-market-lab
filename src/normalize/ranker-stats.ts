import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  RankerStatsArtifact,
  RankerStatsTarget,
} from "../collect/openapi-ranker-stats.ts";

interface RankerStatus {
  shoot: number;
  effectiveShoot: number;
  assist: number;
  goal: number;
  dribble: number;
  dribbleTry: number;
  dribbleSuccess: number;
  passTry: number;
  passSuccess: number;
  block: number;
  tackle: number;
  matchCount: number;
}

interface RankerRow {
  spid: string;
  position_code: number;
  status: RankerStatus;
  as_of: string;
}

export interface NormalizeRankerStatsResult {
  source_snapshots_created: number;
  usage_points_created: number;
  returned_rows: number;
  missing_targets: RankerStatsTarget[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawHash(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

function normalizeUtcTimestamp(value: string, field: string): string {
  const candidate = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  const timestamp = new Date(candidate);
  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
  return timestamp.toISOString();
}

function numericValue(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const candidate = value.trim();
    if (candidate !== "" && /^-?(?:\d+|\d*\.\d+)$/.test(candidate)) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  throw new TypeError(`${field} must be a number or numeric string`);
}

function integerField(
  record: Record<string, unknown>,
  key: string,
  context: string,
  minimum: number,
): number {
  const value = numericValue(record[key], `${context}.${key}`);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(
      `${context}.${key} must be an integer greater than or equal to ${minimum}`,
    );
  }
  return value;
}

function numberField(
  record: Record<string, unknown>,
  key: keyof RankerStatus,
  context: string,
): number {
  const value = numericValue(record[key], `${context}.${key}`);
  if (value < 0) {
    throw new TypeError(`${context}.${key} must be a non-negative number`);
  }
  return value;
}

function parseRows(artifact: RankerStatsArtifact): RankerRow[] {
  const value = JSON.parse(artifact.raw.toString("utf8")) as unknown;
  if (!Array.isArray(value)) {
    throw new TypeError("ranker stats response must be a JSON array");
  }
  const requested = new Set(
    artifact.targets.map((target) => `${target.spid}:${target.position_code}`),
  );
  const seen = new Set<string>();

  return value.map((item, index) => {
    const context = `rankerStats[${index}]`;
    if (!isRecord(item)) {
      throw new TypeError(`${context} must be an object`);
    }
    const spId = integerField(item, "spId", context, 1);
    const spPosition = integerField(item, "spPosition", context, 0);
    if (!isRecord(item.status)) {
      throw new TypeError(`${context}.status must be an object`);
    }
    if (typeof item.createDate !== "string" || item.createDate.trim() === "") {
      throw new TypeError(`${context}.createDate must be a timestamp`);
    }

    const spid = String(spId);
    const position_code = spPosition;
    const key = `${spid}:${position_code}`;
    if (!requested.has(key)) {
      throw new TypeError(`ranker stats returned unrequested target ${key}`);
    }
    if (seen.has(key)) {
      throw new TypeError(`ranker stats returned duplicate target ${key}`);
    }
    seen.add(key);

    const statusRecord = item.status;
    const status: RankerStatus = {
      shoot: numberField(statusRecord, "shoot", `${context}.status`),
      effectiveShoot: numberField(statusRecord, "effectiveShoot", `${context}.status`),
      assist: numberField(statusRecord, "assist", `${context}.status`),
      goal: numberField(statusRecord, "goal", `${context}.status`),
      dribble: numberField(statusRecord, "dribble", `${context}.status`),
      dribbleTry: numberField(statusRecord, "dribbleTry", `${context}.status`),
      dribbleSuccess: numberField(statusRecord, "dribbleSuccess", `${context}.status`),
      passTry: numberField(statusRecord, "passTry", `${context}.status`),
      passSuccess: numberField(statusRecord, "passSuccess", `${context}.status`),
      block: numberField(statusRecord, "block", `${context}.status`),
      tackle: numberField(statusRecord, "tackle", `${context}.status`),
      matchCount: numberField(statusRecord, "matchCount", `${context}.status`),
    };
    if (!Number.isInteger(status.matchCount)) {
      throw new TypeError(`${context}.status.matchCount must be an integer`);
    }

    return {
      spid,
      position_code,
      status,
      as_of: normalizeUtcTimestamp(item.createDate, `${context}.createDate`),
    };
  });
}

function sourceSnapshotId(artifact: RankerStatsArtifact): string {
  return deterministicId(
    "src",
    "nexon-open-api-ranker-stats",
    String(artifact.matchtype),
    artifact.observed_at,
    rawHash(artifact.raw),
  );
}

function insertArtifact(
  db: DatabaseSync,
  artifact: RankerStatsArtifact,
): {
  sourceSnapshotCreated: boolean;
  usagePointsCreated: number;
  rows: RankerRow[];
} {
  const rows = parseRows(artifact);
  const sourceId = sourceSnapshotId(artifact);
  const sourceTimestamp = rows.length > 0
    ? rows.map((row) => row.as_of).sort().at(-1)!
    : artifact.observed_at;
  const sourceInserted = db
    .prepare(
      `INSERT OR IGNORE INTO source_snapshot(
        source_snapshot_id, source_id, source_type, source_url,
        source_timestamp, observed_at, raw_payload, raw_hash,
        capture_method, collector_version, policy_evidence_id,
        source_ref, parse_status, parse_error
      ) VALUES (?, 'nexon-open-api-ranker-stats', 'OPEN_API_RANKER_STATS', ?, ?, ?, ?, ?, 'OFFICIAL_OPEN_API', 'openapi-ranker-stats-v1', 'nexon-open-api-current-terms', ?, 'PARSED', NULL)`,
    )
    .run(
      sourceId,
      artifact.source_url,
      sourceTimestamp,
      artifact.observed_at,
      artifact.raw,
      rawHash(artifact.raw),
      `matchtype:${artifact.matchtype}`,
    );

  let usagePointsCreated = 0;
  const insertUsage = db.prepare(
    `INSERT OR IGNORE INTO usage_point(
      usage_point_id, subject_type, spid, instrument_id, as_of,
      source_data_date, observation_type, appearances, usage_share,
      position_code, performance_metrics_json, source_snapshot_id
    ) VALUES (?, 'PLAYER_CARD', ?, NULL, ?, ?, 'OPEN_API_RANKER_STATS', ?, NULL, ?, ?, ?)`,
  );
  for (const row of rows) {
    const card = db
      .prepare("SELECT 1 AS found FROM player_card WHERE spid = ?")
      .get(row.spid);
    if (!card) {
      throw new TypeError(`player_card ${row.spid} is missing`);
    }
    const usagePointId = deterministicId(
      "usage",
      "OPEN_API_RANKER_STATS",
      row.spid,
      String(row.position_code),
      row.as_of,
    );
    const metrics = { ...row.status } as Record<string, number>;
    delete metrics.matchCount;
    const inserted = insertUsage.run(
      usagePointId,
      row.spid,
      row.as_of,
      row.as_of.slice(0, 10),
      row.status.matchCount,
      row.position_code,
      JSON.stringify(metrics),
      sourceId,
    );
    usagePointsCreated += Number(inserted.changes);
  }

  return {
    sourceSnapshotCreated: Number(sourceInserted.changes) === 1,
    usagePointsCreated,
    rows,
  };
}

export function normalizeRankerStats(
  db: DatabaseSync,
  artifacts: RankerStatsArtifact[],
): NormalizeRankerStatsResult {
  if (artifacts.length === 0) {
    throw new TypeError("ranker stats artifacts must not be empty");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    let sourceSnapshotsCreated = 0;
    let usagePointsCreated = 0;
    let returnedRows = 0;
    const requested = new Map<string, RankerStatsTarget>();
    const returned = new Set<string>();

    for (const artifact of artifacts) {
      for (const target of artifact.targets) {
        requested.set(`${target.spid}:${target.position_code}`, target);
      }
      const result = insertArtifact(db, artifact);
      sourceSnapshotsCreated += result.sourceSnapshotCreated ? 1 : 0;
      usagePointsCreated += result.usagePointsCreated;
      returnedRows += result.rows.length;
      for (const row of result.rows) {
        returned.add(`${row.spid}:${row.position_code}`);
      }
    }

    const missingTargets = [...requested.entries()]
      .filter(([key]) => !returned.has(key))
      .map(([, target]) => target);
    db.exec("COMMIT");
    return {
      source_snapshots_created: sourceSnapshotsCreated,
      usage_points_created: usagePointsCreated,
      returned_rows: returnedRows,
      missing_targets: missingTargets,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
