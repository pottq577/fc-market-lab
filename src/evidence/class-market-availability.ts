export interface ClassMarketAvailability {
  spid_prefix: string;
  class_code: string;
  market_available_on: string;
  source_url: string;
  evidence_note: string;
}

export interface ClassMarketAvailabilityDocument {
  schema_version: 1;
  classes: ClassMarketAvailability[];
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

export function parseClassMarketAvailabilityDocument(
  value: unknown,
): ClassMarketAvailabilityDocument {
  if (!isRecord(value)) {
    throw new TypeError("document must be an object");
  }
  if (value.schema_version !== 1) {
    throw new TypeError("document.schema_version must be 1");
  }
  if (!Array.isArray(value.classes) || value.classes.length === 0) {
    throw new TypeError("document.classes must be a non-empty array");
  }

  const prefixes = new Set<string>();
  const classCodes = new Set<string>();
  const classes = value.classes.map((item, index) => {
    const context = `document.classes[${index}]`;
    if (!isRecord(item)) {
      throw new TypeError(`${context} must be an object`);
    }

    const spid_prefix = readRequiredString(item, "spid_prefix", context);
    if (!/^\d+$/.test(spid_prefix)) {
      throw new TypeError(`${context}.spid_prefix must contain digits only`);
    }
    if (prefixes.has(spid_prefix)) {
      throw new TypeError(`duplicate spid_prefix: ${spid_prefix}`);
    }
    prefixes.add(spid_prefix);

    const class_code = readRequiredString(item, "class_code", context);
    if (classCodes.has(class_code)) {
      throw new TypeError(`duplicate class_code: ${class_code}`);
    }
    classCodes.add(class_code);

    const market_available_on = readRequiredString(
      item,
      "market_available_on",
      context,
    );
    assertDate(market_available_on, `${context}.market_available_on`);

    const source_url = readRequiredString(item, "source_url", context);
    assertHttpUrl(source_url, `${context}.source_url`);

    return {
      spid_prefix,
      class_code,
      market_available_on,
      source_url,
      evidence_note: readRequiredString(item, "evidence_note", context),
    } satisfies ClassMarketAvailability;
  });

  return { schema_version: 1, classes };
}

export function findClassMarketAvailability(
  document: ClassMarketAvailabilityDocument,
  spid: string,
): ClassMarketAvailability | undefined {
  if (!/^\d+$/.test(spid)) {
    throw new TypeError("spid must contain digits only");
  }

  return document.classes
    .filter((item) => spid.startsWith(item.spid_prefix))
    .sort((left, right) => right.spid_prefix.length - left.spid_prefix.length)[0];
}
