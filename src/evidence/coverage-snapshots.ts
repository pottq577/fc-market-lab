import type { CoverageSnapshot } from "../gates/coverage-viability.ts";

export interface Gate0BCoverageEvidenceDocument {
  schema_version: 1;
  catalog_id: string;
  source_id: string;
  captured_on: string;
  capture_method: string;
  capture_bundle_sha256: string;
  raw_committed: boolean;
  snapshots: CoverageSnapshot[];
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

function readNonNegativeNumber(
  record: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${context}.${key} must be a non-negative number`);
  }
  return value;
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

export function parseGate0BCoverageEvidenceDocument(
  value: unknown,
): Gate0BCoverageEvidenceDocument {
  if (!isRecord(value)) {
    throw new TypeError("document must be an object");
  }
  if (value.schema_version !== 1) {
    throw new TypeError("document.schema_version must be 1");
  }

  const captured_on = readRequiredString(value, "captured_on", "document");
  assertDate(captured_on, "document.captured_on");
  const capture_bundle_sha256 = readRequiredString(
    value,
    "capture_bundle_sha256",
    "document",
  );
  assertHash(capture_bundle_sha256, "document.capture_bundle_sha256");
  if (typeof value.raw_committed !== "boolean") {
    throw new TypeError("document.raw_committed must be a boolean");
  }
  if (!Array.isArray(value.snapshots) || value.snapshots.length === 0) {
    throw new TypeError("document.snapshots must be a non-empty array");
  }

  const seen = new Set<string>();
  const snapshots = value.snapshots.map((item, index): CoverageSnapshot => {
    const context = `document.snapshots[${index}]`;
    if (!isRecord(item)) {
      throw new TypeError(`${context} must be an object`);
    }

    const spid = readRequiredString(item, "spid", context);
    if (!/^\d+$/.test(spid)) {
      throw new TypeError(`${context}.spid must contain digits only`);
    }
    const grade = readPositiveInteger(item, "grade", context);
    if (grade > 13) {
      throw new TypeError(`${context}.grade must be an integer from 1 to 13`);
    }

    const key = `${spid}:${grade}`;
    if (seen.has(key)) {
      throw new TypeError(`duplicate coverage snapshot: ${key}`);
    }
    seen.add(key);

    const observed_at = readRequiredString(item, "observed_at", context);
    assertTimestamp(observed_at, `${context}.observed_at`);
    const raw_sha256 = readRequiredString(item, "raw_sha256", context);
    assertHash(raw_sha256, `${context}.raw_sha256`);
    const first_source_date = readRequiredString(
      item,
      "first_source_date",
      context,
    );
    const last_source_date = readRequiredString(item, "last_source_date", context);
    assertDate(first_source_date, `${context}.first_source_date`);
    assertDate(last_source_date, `${context}.last_source_date`);
    if (first_source_date > last_source_date) {
      throw new TypeError(
        `${context}.first_source_date must not be after last_source_date`,
      );
    }

    return {
      spid,
      grade,
      class_code: readRequiredString(item, "class_code", context),
      observed_at,
      raw_sha256,
      point_count: readPositiveInteger(item, "point_count", context),
      first_source_date,
      last_source_date,
      observed_span_days: readNonNegativeNumber(
        item,
        "observed_span_days",
        context,
      ),
      native_granularity: readRequiredString(
        item,
        "native_granularity",
        context,
      ),
      source_path: "data/evidence/gate-0b-price-coverage.json",
    };
  });

  return {
    schema_version: 1,
    catalog_id: readRequiredString(value, "catalog_id", "document"),
    source_id: readRequiredString(value, "source_id", "document"),
    captured_on,
    capture_method: readRequiredString(value, "capture_method", "document"),
    capture_bundle_sha256,
    raw_committed: value.raw_committed,
    snapshots,
  };
}
