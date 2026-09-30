export const MIN_SEED_PLAYERS = 20;
export const MAX_SEED_PLAYERS = 30;
export const SEED_SOURCE_SECTIONS = ["CLASS_USAGE", "POSITION_USAGE"] as const;

export type SeedSourceSection = (typeof SEED_SOURCE_SECTIONS)[number];

export interface SeedPrimaryInstrument {
  spid: string;
  grade: number;
}

export interface SeedCatalogSource {
  source_id: string;
  source_url: string;
  data_date: string;
  observed_at: string;
  method: string;
  ranker_scope: string;
}

export interface SeedSelectionObservation {
  section: SeedSourceSection;
  ranker_squad_count: number;
  displayed_share_percent: number;
}

export interface SeedPlayer {
  player_key: string;
  player_name: string;
  primary_instrument: SeedPrimaryInstrument;
  selection_observation: SeedSelectionObservation;
  selection_reason: string;
}

export interface SeedCatalogDocument {
  schema_version: 1;
  catalog_id: string;
  status: "FROZEN";
  frozen_at: string;
  selection_source: SeedCatalogSource;
  seeds: SeedPlayer[];
}

export interface SeedCatalogSummary {
  catalog_id: string;
  status: "FROZEN";
  player_count: number;
  primary_instrument_count: number;
  source_id: string;
  source_data_date: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(
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

function readPositiveInteger(
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

function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${context}.${key} must be a finite number`);
  }
  return value;
}

function assertTimestamp(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
}

function assertDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${field} must be YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${field} must be a valid calendar date`);
  }
}

function assertHttpUrl(value: string, field: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${field} must be an absolute HTTP(S) URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`${field} must be an absolute HTTP(S) URL`);
  }
}

function parseSource(value: unknown): SeedCatalogSource {
  if (!isRecord(value)) {
    throw new TypeError("document.selection_source must be an object");
  }

  const source_url = readRequiredString(
    value,
    "source_url",
    "document.selection_source",
  );
  const data_date = readRequiredString(
    value,
    "data_date",
    "document.selection_source",
  );
  const observed_at = readRequiredString(
    value,
    "observed_at",
    "document.selection_source",
  );

  assertHttpUrl(source_url, "document.selection_source.source_url");
  assertDate(data_date, "document.selection_source.data_date");
  assertTimestamp(observed_at, "document.selection_source.observed_at");

  return {
    source_id: readRequiredString(
      value,
      "source_id",
      "document.selection_source",
    ),
    source_url,
    data_date,
    observed_at,
    method: readRequiredString(value, "method", "document.selection_source"),
    ranker_scope: readRequiredString(
      value,
      "ranker_scope",
      "document.selection_source",
    ),
  };
}

function parseInstrument(
  value: unknown,
  context: string,
): SeedPrimaryInstrument {
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }

  const spid = readRequiredString(value, "spid", context);
  if (!/^\d+$/.test(spid)) {
    throw new TypeError(`${context}.spid must contain digits only`);
  }

  const grade = readPositiveInteger(value, "grade", context);
  if (grade > 13) {
    throw new TypeError(`${context}.grade must be an integer from 1 to 13`);
  }

  return { spid, grade };
}

function parseSelectionObservation(
  value: unknown,
  context: string,
): SeedSelectionObservation {
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }

  const section = readRequiredString(value, "section", context);
  if (!SEED_SOURCE_SECTIONS.includes(section as SeedSourceSection)) {
    throw new TypeError(
      `${context}.section must be one of: ${SEED_SOURCE_SECTIONS.join(", ")}`,
    );
  }

  const displayed_share_percent = readFiniteNumber(
    value,
    "displayed_share_percent",
    context,
  );
  if (displayed_share_percent <= 0 || displayed_share_percent > 100) {
    throw new TypeError(
      `${context}.displayed_share_percent must be > 0 and <= 100`,
    );
  }

  return {
    section: section as SeedSourceSection,
    ranker_squad_count: readPositiveInteger(
      value,
      "ranker_squad_count",
      context,
    ),
    displayed_share_percent,
  };
}

function parseSeed(value: unknown, index: number): SeedPlayer {
  const context = `document.seeds[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }

  const player_key = readRequiredString(value, "player_key", context);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(player_key)) {
    throw new TypeError(
      `${context}.player_key must be a lowercase kebab-case identifier`,
    );
  }

  return {
    player_key,
    player_name: readRequiredString(value, "player_name", context),
    primary_instrument: parseInstrument(
      value.primary_instrument,
      `${context}.primary_instrument`,
    ),
    selection_observation: parseSelectionObservation(
      value.selection_observation,
      `${context}.selection_observation`,
    ),
    selection_reason: readRequiredString(value, "selection_reason", context),
  };
}

export function parseSeedCatalogDocument(value: unknown): SeedCatalogDocument {
  if (!isRecord(value)) {
    throw new TypeError("document must be an object");
  }

  if (value.schema_version !== 1) {
    throw new TypeError("document.schema_version must be 1");
  }
  if (value.status !== "FROZEN") {
    throw new TypeError("document.status must be FROZEN");
  }

  const frozen_at = readRequiredString(value, "frozen_at", "document");
  assertTimestamp(frozen_at, "document.frozen_at");

  if (!Array.isArray(value.seeds)) {
    throw new TypeError("document.seeds must be an array");
  }
  if (
    value.seeds.length < MIN_SEED_PLAYERS ||
    value.seeds.length > MAX_SEED_PLAYERS
  ) {
    throw new TypeError(
      `document.seeds must contain ${MIN_SEED_PLAYERS}-${MAX_SEED_PLAYERS} players`,
    );
  }

  const seeds = value.seeds.map(parseSeed);
  const playerKeys = new Set<string>();
  const instruments = new Set<string>();
  for (const seed of seeds) {
    if (playerKeys.has(seed.player_key)) {
      throw new TypeError(`duplicate player_key: ${seed.player_key}`);
    }
    playerKeys.add(seed.player_key);

    const instrumentKey = `${seed.primary_instrument.spid}:${seed.primary_instrument.grade}`;
    if (instruments.has(instrumentKey)) {
      throw new TypeError(`duplicate primary instrument: ${instrumentKey}`);
    }
    instruments.add(instrumentKey);
  }

  return {
    schema_version: 1,
    catalog_id: readRequiredString(value, "catalog_id", "document"),
    status: "FROZEN",
    frozen_at,
    selection_source: parseSource(value.selection_source),
    seeds,
  };
}

export function seedCatalogTargets(
  document: SeedCatalogDocument,
): SeedPrimaryInstrument[] {
  return document.seeds.map((seed) => ({ ...seed.primary_instrument }));
}

export function summarizeSeedCatalog(
  document: SeedCatalogDocument,
): SeedCatalogSummary {
  return {
    catalog_id: document.catalog_id,
    status: document.status,
    player_count: document.seeds.length,
    primary_instrument_count: seedCatalogTargets(document).length,
    source_id: document.selection_source.source_id,
    source_data_date: document.selection_source.data_date,
  };
}
