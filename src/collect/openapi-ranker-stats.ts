import type { DatabaseSync } from "node:sqlite";

import type { SeedCatalogDocument } from "../catalog/seed-catalog.ts";
import { normalizeNexonOpenApiKey } from "./openapi-key.ts";

export const OPENAPI_RANKER_STATS_URL =
  "https://open.api.nexon.com/fconline/v1/ranker-stats";
export const DEFAULT_RANKER_MATCHTYPE = 50;
export const MAX_RANKER_TARGETS_PER_REQUEST = 50;

export interface RankerStatsTarget {
  spid: string;
  position_code: number;
}

export interface RankerStatsArtifact {
  source_url: string;
  observed_at: string;
  matchtype: number;
  targets: RankerStatsTarget[];
  raw: Buffer;
}

interface StoredPosition {
  name: string;
  ovr: number;
  primary: boolean;
}

function parseStoredPositions(value: string, spid: string): StoredPosition[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new TypeError(`FULL metadata positions are missing for spid=${spid}`);
  }
  return parsed.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new TypeError(`positions_json[${index}] for spid=${spid} must be an object`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || record.name.trim() === "") {
      throw new TypeError(`positions_json[${index}].name for spid=${spid} is invalid`);
    }
    if (!Number.isInteger(record.ovr) || (record.ovr as number) <= 0) {
      throw new TypeError(`positions_json[${index}].ovr for spid=${spid} is invalid`);
    }
    if (typeof record.primary !== "boolean") {
      throw new TypeError(`positions_json[${index}].primary for spid=${spid} is invalid`);
    }
    return {
      name: record.name.trim(),
      ovr: record.ovr as number,
      primary: record.primary,
    };
  });
}

function positionCodesByName(db: DatabaseSync): Map<string, number> {
  const row = db
    .prepare(
      `SELECT raw_payload
       FROM source_snapshot
       WHERE source_id = 'nexon-open-api-position-metadata'
         AND parse_status = 'PARSED'
       ORDER BY observed_at DESC, source_snapshot_id DESC
       LIMIT 1`,
    )
    .get() as { raw_payload: Uint8Array } | undefined;
  if (!row) {
    throw new TypeError(
      "Open API position metadata is missing; run ingest:metadata-usage first",
    );
  }
  const parsed = JSON.parse(Buffer.from(row.raw_payload).toString("utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new TypeError("Open API position metadata must be a JSON array");
  }
  const result = new Map<string, number>();
  for (const [index, item] of parsed.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new TypeError(`position metadata[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    if (!Number.isInteger(record.spposition) || (record.spposition as number) < 0) {
      throw new TypeError(`position metadata[${index}].spposition is invalid`);
    }
    if (typeof record.desc !== "string" || record.desc.trim() === "") {
      throw new TypeError(`position metadata[${index}].desc is invalid`);
    }
    result.set(record.desc.trim(), record.spposition as number);
  }
  return result;
}

export function rankerStatsTargetsFromDatabase(
  db: DatabaseSync,
  catalog: SeedCatalogDocument,
): RankerStatsTarget[] {
  const positionCodes = positionCodesByName(db);
  return catalog.seeds.map((seed) => {
    const spid = seed.primary_instrument.spid;
    const row = db
      .prepare(
        `SELECT positions_json
         FROM metadata_snapshot
         WHERE spid = ? AND completeness = 'FULL'
         ORDER BY observed_at DESC, metadata_snapshot_id DESC
         LIMIT 1`,
      )
      .get(spid) as { positions_json: string | null } | undefined;
    if (!row?.positions_json) {
      throw new TypeError(
        `FULL metadata for spid=${spid} is missing; run ingest:metadata-detail first`,
      );
    }
    const positions = parseStoredPositions(row.positions_json, spid);
    const primary = positions.filter((position) => position.primary);
    if (primary.length !== 1) {
      throw new TypeError(`spid=${spid} must have exactly one primary position`);
    }
    const positionCode = positionCodes.get(primary[0]!.name);
    if (positionCode === undefined) {
      throw new TypeError(
        `Open API position metadata has no code for ${primary[0]!.name}`,
      );
    }
    return { spid, position_code: positionCode };
  });
}

function validateTargets(targets: RankerStatsTarget[]): void {
  if (targets.length === 0) {
    throw new TypeError("ranker stats targets must not be empty");
  }
  const seen = new Set<string>();
  for (const target of targets) {
    if (!/^\d+$/.test(target.spid)) {
      throw new TypeError("ranker stats target spid must contain digits only");
    }
    if (!Number.isInteger(target.position_code) || target.position_code < 0) {
      throw new TypeError("ranker stats target position_code must be a non-negative integer");
    }
    const key = `${target.spid}:${target.position_code}`;
    if (seen.has(key)) {
      throw new TypeError(`duplicate ranker stats target: ${key}`);
    }
    seen.add(key);
  }
}

export async function collectOpenApiRankerStats(
  targets: RankerStatsTarget[],
  options: {
    apiKey: string;
    matchtype?: number;
    observedAt?: string;
    chunkSize?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<RankerStatsArtifact[]> {
  validateTargets(targets);
  const apiKey = normalizeNexonOpenApiKey(options.apiKey);
  const matchtype = options.matchtype ?? DEFAULT_RANKER_MATCHTYPE;
  if (!Number.isInteger(matchtype) || matchtype <= 0) {
    throw new TypeError("matchtype must be a positive integer");
  }
  const observedAt = options.observedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(observedAt))) {
    throw new TypeError("observedAt must be an ISO-8601-compatible timestamp");
  }
  const chunkSize = options.chunkSize ?? MAX_RANKER_TARGETS_PER_REQUEST;
  if (
    !Number.isInteger(chunkSize) ||
    chunkSize <= 0 ||
    chunkSize > MAX_RANKER_TARGETS_PER_REQUEST
  ) {
    throw new TypeError(
      `chunkSize must be between 1 and ${MAX_RANKER_TARGETS_PER_REQUEST}`,
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const artifacts: RankerStatsArtifact[] = [];

  for (let offset = 0; offset < targets.length; offset += chunkSize) {
    const chunk = targets.slice(offset, offset + chunkSize);
    const url = new URL(OPENAPI_RANKER_STATS_URL);
    url.searchParams.set("matchtype", String(matchtype));
    url.searchParams.set(
      "players",
      JSON.stringify(
        chunk.map((target) => ({
          id: Number(target.spid),
          po: target.position_code,
        })),
      ),
    );
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "x-nxopen-api-key": apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Open API ranker stats request failed: ${response.status} ${response.statusText}`,
      );
    }
    artifacts.push({
      source_url: url.toString(),
      observed_at: observedAt,
      matchtype,
      targets: chunk,
      raw: Buffer.from(await response.arrayBuffer()),
    });
  }

  return artifacts;
}
