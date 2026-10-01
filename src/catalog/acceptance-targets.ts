export const ACCEPTANCE_TARGET_ROLES = [
  "SAME_PLAYER",
  "PACK_EXPOSED",
  "PREMIUM_SCARCE",
  "REGIME_TARGET",
] as const;

export type AcceptanceTargetRole = (typeof ACCEPTANCE_TARGET_ROLES)[number];

export interface AcceptanceTarget {
  target_id: string;
  player_key: string;
  player_name: string;
  season: string;
  grade: number;
  valid_from: string;
  roles: AcceptanceTargetRole[];
  evidence_urls: string[];
}

export interface AcceptanceTargetDocument {
  schema_version: 1;
  catalog_id: string;
  targets: AcceptanceTarget[];
}

export interface ResolvedAcceptanceTarget extends AcceptanceTarget {
  spid: string;
}

export interface ResolvedAcceptanceTargetDocument {
  schema_version: 1;
  catalog_id: string;
  resolved_at: string;
  targets: ResolvedAcceptanceTarget[];
}

const SEASON_META_URL = "https://open.api.nexon.com/static/fconline/meta/seasonid.json";
const SPID_META_URL = "https://open.api.nexon.com/static/fconline/meta/spid.json";

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string, context: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim() === "") {
    throw new TypeError(`${context}.${key} must be a non-empty string`);
  }
  return field.trim();
}

function timestampField(value: Record<string, unknown>, key: string, context: string): string {
  const field = stringField(value, key, context);
  if (Number.isNaN(Date.parse(field)) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(field)) {
    throw new TypeError(`${context}.${key} must be an ISO-8601 timestamp with timezone`);
  }
  return field;
}

function httpUrl(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${context} must be a non-empty URL`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${context} must be an absolute HTTP(S) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`${context} must be an absolute HTTP(S) URL`);
  }
  return value;
}

function parseTarget(value: unknown, index: number): AcceptanceTarget {
  const context = `document.targets[${index}]`;
  const item = record(value, context);
  const grade = Number(item.grade);
  if (!Number.isInteger(grade) || grade < 1 || grade > 13) {
    throw new TypeError(`${context}.grade must be an integer between 1 and 13`);
  }
  if (!Array.isArray(item.roles) || item.roles.length === 0) {
    throw new TypeError(`${context}.roles must be a non-empty array`);
  }
  const roles = [...new Set(item.roles.map((role, roleIndex) => {
    if (typeof role !== "string" || !ACCEPTANCE_TARGET_ROLES.includes(role as AcceptanceTargetRole)) {
      throw new TypeError(`${context}.roles[${roleIndex}] is unsupported`);
    }
    return role as AcceptanceTargetRole;
  }))];
  if (!Array.isArray(item.evidence_urls) || item.evidence_urls.length === 0) {
    throw new TypeError(`${context}.evidence_urls must be a non-empty array`);
  }
  return {
    target_id: stringField(item, "target_id", context),
    player_key: stringField(item, "player_key", context),
    player_name: stringField(item, "player_name", context),
    season: stringField(item, "season", context),
    grade,
    valid_from: timestampField(item, "valid_from", context),
    roles,
    evidence_urls: item.evidence_urls.map((url, urlIndex) =>
      httpUrl(url, `${context}.evidence_urls[${urlIndex}]`)),
  };
}

export function parseAcceptanceTargetDocument(value: unknown): AcceptanceTargetDocument {
  const document = record(value, "document");
  if (document.schema_version !== 1) {
    throw new TypeError("document.schema_version must be 1");
  }
  if (!Array.isArray(document.targets) || document.targets.length === 0) {
    throw new TypeError("document.targets must be a non-empty array");
  }
  const targets = document.targets.map(parseTarget);
  const ids = new Set<string>();
  for (const target of targets) {
    if (ids.has(target.target_id)) throw new TypeError(`duplicate target_id: ${target.target_id}`);
    ids.add(target.target_id);
  }
  return {
    schema_version: 1,
    catalog_id: stringField(document, "catalog_id", "document"),
    targets,
  };
}

export function parseResolvedAcceptanceTargetDocument(
  value: unknown,
): ResolvedAcceptanceTargetDocument {
  const document = record(value, "document");
  const base = parseAcceptanceTargetDocument(value);
  const rawTargets = document.targets as unknown[];
  const targets = base.targets.map((target, index) => {
    const raw = record(rawTargets[index], `document.targets[${index}]`);
    const spidValue = raw.spid;
    const spid = typeof spidValue === "number" ? String(spidValue) : String(spidValue ?? "");
    if (!/^\d+$/.test(spid)) {
      throw new TypeError(`document.targets[${index}].spid must contain digits only`);
    }
    return { ...target, spid };
  });
  return {
    schema_version: 1,
    catalog_id: base.catalog_id,
    resolved_at: timestampField(document, "resolved_at", "document"),
    targets,
  };
}

function seasonId(value: unknown, season: string): number {
  if (!Array.isArray(value)) throw new TypeError("season metadata must be an array");
  const matches = value.flatMap((item) => {
    const row = record(item, "season metadata entry");
    const id = Number(row.seasonId);
    return Number.isInteger(id) && row.className === season ? [id] : [];
  });
  if (matches.length !== 1) {
    throw new TypeError(`season ${season} resolved to ${matches.length} metadata rows`);
  }
  return matches[0]!;
}

function resolveSpid(value: unknown, target: AcceptanceTarget, targetSeasonId: number): string {
  if (!Array.isArray(value)) throw new TypeError("spid metadata must be an array");
  const matches = value.flatMap((item) => {
    const row = record(item, "spid metadata entry");
    const rawId = row.id;
    const id = typeof rawId === "number" ? String(rawId) : String(rawId ?? "");
    if (!/^\d+$/.test(id) || row.name !== target.player_name) return [];
    return Math.floor(Number(id) / 1_000_000) === targetSeasonId ? [id] : [];
  });
  if (matches.length !== 1) {
    throw new TypeError(
      `${target.target_id} (${target.player_name}/${target.season}) resolved to ${matches.length} spid rows`,
    );
  }
  return matches[0]!;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`metadata request failed: ${response.status} ${url}`);
  return response.json() as Promise<unknown>;
}

export async function resolveAcceptanceTargets(
  document: AcceptanceTargetDocument,
  options: {
    fetchJson?: (url: string) => Promise<unknown>;
    resolvedAt?: string;
  } = {},
): Promise<ResolvedAcceptanceTargetDocument> {
  const load = options.fetchJson ?? fetchJson;
  const [seasons, spids] = await Promise.all([load(SEASON_META_URL), load(SPID_META_URL)]);
  const seasonIds = new Map<string, number>();
  const targets = document.targets.map((target) => {
    let id = seasonIds.get(target.season);
    if (id === undefined) {
      id = seasonId(seasons, target.season);
      seasonIds.set(target.season, id);
    }
    return { ...target, spid: resolveSpid(spids, target, id) };
  });
  const resolvedAt = options.resolvedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(resolvedAt))) throw new TypeError("resolvedAt must be a timestamp");
  return {
    schema_version: 1,
    catalog_id: document.catalog_id,
    resolved_at: new Date(resolvedAt).toISOString(),
    targets,
  };
}
