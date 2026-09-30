import type { SeedCatalogDocument } from "../catalog/seed-catalog.ts";

export const DATACENTER_METADATA_CAPTURE_METHOD =
  "OFFICIAL_WEB_UI_MANUAL_CAPTURE" as const;
export const DATACENTER_PLAYWRIGHT_CAPTURE_METHOD =
  "OFFICIAL_WEB_UI_PLAYWRIGHT" as const;
export const DATACENTER_METADATA_CAPTURE_METHODS = [
  DATACENTER_METADATA_CAPTURE_METHOD,
  DATACENTER_PLAYWRIGHT_CAPTURE_METHOD,
] as const;

export type DatacenterMetadataCaptureMethod =
  (typeof DATACENTER_METADATA_CAPTURE_METHODS)[number];

export interface DatacenterMetadataPosition {
  name: string;
  ovr: number;
  primary: boolean;
}

export interface DatacenterMetadataEntry {
  spid: string;
  grade: number;
  player_name: string;
  observed_at: string;
  source_url: string;
  raw_sha256: string;
  salary: number;
  positions: DatacenterMetadataPosition[];
  ovr: number;
  stats: Record<string, number>;
  traits: string[];
  clubs: string[];
  nations: string[];
  team_colors: string[];
}

export interface DatacenterMetadataEvidenceDocument {
  schema_version: 1;
  catalog_id: string;
  capture_method: DatacenterMetadataCaptureMethod;
  entries: DatacenterMetadataEntry[];
}

export interface DatacenterMetadataTemplateEntry {
  spid: string;
  grade: number;
  player_name: string;
  source_url: string;
  observed_at: null;
  raw_sha256: null;
  salary: null;
  positions: [];
  ovr: null;
  stats: Record<string, never>;
  traits: [];
  clubs: [];
  nations: [];
  team_colors: [];
}

export interface DatacenterMetadataTemplateDocument {
  schema_version: 1;
  catalog_id: string;
  capture_method: typeof DATACENTER_METADATA_CAPTURE_METHOD;
  entries: DatacenterMetadataTemplateEntry[];
}

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
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${context}.${key} must be a positive integer`);
  }
  return value as number;
}

function assertTimestamp(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
}

function assertHash(value: string, field: string): void {
  if (!/^sha256:[0-9a-f]{64}$/i.test(value)) {
    throw new TypeError(`${field} must be sha256:<64 hex chars>`);
  }
}

function stringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array`);
  }
  const result = value.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new TypeError(`${context}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
  if (new Set(result).size !== result.length) {
    throw new TypeError(`${context} must not contain duplicates`);
  }
  return result;
}

function parsePositions(
  value: unknown,
  context: string,
): DatacenterMetadataPosition[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${context} must be a non-empty array`);
  }

  let primaryCount = 0;
  const names = new Set<string>();
  const positions = value.map((item, index) => {
    const itemContext = `${context}[${index}]`;
    if (!isRecord(item)) {
      throw new TypeError(`${itemContext} must be an object`);
    }
    const name = requiredString(item, "name", itemContext);
    const ovr = positiveInteger(item, "ovr", itemContext);
    if (typeof item.primary !== "boolean") {
      throw new TypeError(`${itemContext}.primary must be a boolean`);
    }
    if (names.has(name)) {
      throw new TypeError(`${context} has duplicate position name ${name}`);
    }
    names.add(name);
    if (item.primary) {
      primaryCount += 1;
    }
    return { name, ovr, primary: item.primary };
  });

  if (primaryCount !== 1) {
    throw new TypeError(`${context} must contain exactly one primary position`);
  }
  return positions;
}

function parseStats(value: unknown, context: string): Record<string, number> {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new TypeError(`${context} must be a non-empty object`);
  }
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key.trim() === "") {
      throw new TypeError(`${context} contains an empty stat name`);
    }
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
      throw new TypeError(`${context}.${key} must be a non-negative number`);
    }
    result[key.trim()] = raw;
  }
  return result;
}

function validateSourceUrl(
  value: string,
  spid: string,
  grade: number,
  field: string,
): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${field} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "fconline.nexon.com") {
    throw new TypeError(`${field} must use https://fconline.nexon.com`);
  }
  if (parsed.pathname.toLowerCase() !== "/datacenter/playerinfo") {
    throw new TypeError(`${field} must point to /DataCenter/PlayerInfo`);
  }
  if (parsed.searchParams.get("spid") !== spid) {
    throw new TypeError(`${field} spid query must equal ${spid}`);
  }
  if (parsed.searchParams.get("n1Strong") !== String(grade)) {
    throw new TypeError(`${field} n1Strong query must equal ${grade}`);
  }
}

function parseEntry(value: unknown, index: number): DatacenterMetadataEntry {
  const context = `document.entries[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }

  const spid = requiredString(value, "spid", context);
  if (!/^\d+$/.test(spid)) {
    throw new TypeError(`${context}.spid must contain digits only`);
  }
  const grade = positiveInteger(value, "grade", context);
  if (grade > 13) {
    throw new TypeError(`${context}.grade must be between 1 and 13`);
  }
  const observed_at = requiredString(value, "observed_at", context);
  assertTimestamp(observed_at, `${context}.observed_at`);
  const raw_sha256 = requiredString(value, "raw_sha256", context);
  assertHash(raw_sha256, `${context}.raw_sha256`);
  const source_url = requiredString(value, "source_url", context);
  validateSourceUrl(source_url, spid, grade, `${context}.source_url`);

  const salary = positiveInteger(value, "salary", context);
  const ovr = positiveInteger(value, "ovr", context);
  const positions = parsePositions(value.positions, `${context}.positions`);
  const primary = positions.find((position) => position.primary)!;
  if (primary.ovr !== ovr) {
    throw new TypeError(`${context}.ovr must equal the primary position OVR`);
  }

  return {
    spid,
    grade,
    player_name: requiredString(value, "player_name", context),
    observed_at,
    source_url,
    raw_sha256,
    salary,
    positions,
    ovr,
    stats: parseStats(value.stats, `${context}.stats`),
    traits: stringArray(value.traits, `${context}.traits`),
    clubs: stringArray(value.clubs, `${context}.clubs`),
    nations: stringArray(value.nations, `${context}.nations`),
    team_colors: stringArray(value.team_colors, `${context}.team_colors`),
  };
}

export function parseDatacenterMetadataEvidenceDocument(
  value: unknown,
): DatacenterMetadataEvidenceDocument {
  if (!isRecord(value)) {
    throw new TypeError("document must be an object");
  }
  if (value.schema_version !== 1) {
    throw new TypeError("document.schema_version must be 1");
  }
  if (
    typeof value.capture_method !== "string" ||
    !DATACENTER_METADATA_CAPTURE_METHODS.includes(
      value.capture_method as DatacenterMetadataCaptureMethod,
    )
  ) {
    throw new TypeError(
      `document.capture_method must be one of: ${DATACENTER_METADATA_CAPTURE_METHODS.join(", ")}`,
    );
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    throw new TypeError("document.entries must be a non-empty array");
  }

  const entries = value.entries.map(parseEntry);
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.spid}:${entry.grade}:${entry.observed_at}`;
    if (seen.has(key)) {
      throw new TypeError(`duplicate metadata evidence entry: ${key}`);
    }
    seen.add(key);
  }

  return {
    schema_version: 1,
    catalog_id: requiredString(value, "catalog_id", "document"),
    capture_method: value.capture_method as DatacenterMetadataCaptureMethod,
    entries,
  };
}

export function buildDatacenterMetadataTemplate(
  catalog: SeedCatalogDocument,
): DatacenterMetadataTemplateDocument {
  return {
    schema_version: 1,
    catalog_id: catalog.catalog_id,
    capture_method: DATACENTER_METADATA_CAPTURE_METHOD,
    entries: catalog.seeds.map((seed) => ({
      spid: seed.primary_instrument.spid,
      grade: seed.primary_instrument.grade,
      player_name: seed.player_name,
      source_url:
        `https://fconline.nexon.com/DataCenter/PlayerInfo?` +
        `n1Strong=${seed.primary_instrument.grade}&spid=${seed.primary_instrument.spid}`,
      observed_at: null,
      raw_sha256: null,
      salary: null,
      positions: [],
      ovr: null,
      stats: {},
      traits: [],
      clubs: [],
      nations: [],
      team_colors: [],
    })),
  };
}
