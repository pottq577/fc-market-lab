import { createHash } from "node:crypto";

export interface PricePoint {
  source_timestamp_ms: number;
  value: number;
}

export interface DatacenterPriceCaptureEvidence {
  source_id: "fconline-datacenter-price-history";
  spid: string;
  grade: number;
  observed_at: string;
  raw_sha256: string;
  point_count: number;
  first_source_date: string;
  last_source_date: string;
  first_source_timestamp: string;
  last_source_timestamp: string;
  observed_span_days: number;
  native_granularity: string;
  price_semantics: "MARKET_REFERENCE_PRICE";
  gate_update: {
    native_granularity: string;
    history_span: string;
    evidence_hash: string;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const KST_TIME_ZONE = "Asia/Seoul";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gcd(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left;
}

function gcdAll(values: number[]): number {
  return values.reduce((result, value) => gcd(result, value));
}

function readPositiveInteger(value: unknown, context: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${context} must be a positive integer`);
  }
  return parsed;
}

function extractAssignedObject(
  raw: string,
  variableName: string,
): string | null {
  const assignment = new RegExp(`\\bvar\\s+${variableName}\\s*=\\s*`).exec(raw);
  if (!assignment) {
    return null;
  }

  const objectStart = raw.indexOf("{", assignment.index + assignment[0].length);
  if (objectStart < 0) {
    throw new TypeError(
      `${variableName} assignment does not contain an object`,
    );
  }

  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = objectStart; index < raw.length; index += 1) {
    const char = raw[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(objectStart, index + 1);
      }
    }
  }

  throw new TypeError(`${variableName} assignment has an unterminated object`);
}

function parseAssignedObject(
  raw: string,
  variableName: string,
  allowTrailingCommas = false,
): unknown | null {
  const objectText = extractAssignedObject(raw, variableName);
  if (objectText === null) {
    return null;
  }

  const normalized = allowTrailingCommas
    ? objectText.replace(/,\s*([}\]])/g, "$1")
    : objectText;

  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new TypeError(
      `${variableName} must be JSON-compatible: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function extractArrayProperty(
  objectText: string,
  propertyName: string,
  variableName = "json1",
): unknown[] {
  const property = new RegExp(
    `(?:["']${propertyName}["']|\\b${propertyName}\\b)\\s*:\\s*\\[`,
  ).exec(objectText);
  if (!property) {
    throw new TypeError(`${variableName}.${propertyName} must be an array`);
  }

  const arrayStart = objectText.indexOf(
    "[",
    property.index + property[0].length - 1,
  );
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = arrayStart; index < objectText.length; index += 1) {
    const char = objectText[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        const arrayText = objectText
          .slice(arrayStart, index + 1)
          .replace(/,\s*]/g, "]");
        try {
          const parsed = JSON.parse(arrayText);
          if (!Array.isArray(parsed)) {
            throw new TypeError(
              `${variableName}.${propertyName} must be an array`,
            );
          }
          return parsed;
        } catch (error) {
          throw new TypeError(
            `${variableName}.${propertyName} must be JSON-compatible: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  throw new TypeError(
    `${variableName}.${propertyName} has an unterminated array`,
  );
}

function normalizeKnownObjectKeys(
  objectText: string,
  knownKeys: ReadonlySet<string>,
): string {
  let normalized = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < objectText.length; index += 1) {
    const char = objectText[index];

    if (quote) {
      normalized += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      normalized += char;
      continue;
    }

    if (/[A-Za-z_$]/.test(char ?? "")) {
      let end = index + 1;
      while (
        end < objectText.length &&
        /[A-Za-z0-9_$]/.test(objectText[end] ?? "")
      ) {
        end += 1;
      }
      const identifier = objectText.slice(index, end);
      let cursor = end;
      while (
        cursor < objectText.length &&
        /\s/.test(objectText[cursor] ?? "")
      ) {
        cursor += 1;
      }
      if (knownKeys.has(identifier) && objectText[cursor] === ":") {
        normalized += `"${identifier}"`;
        index = end - 1;
        continue;
      }
    }

    normalized += char;
  }

  return normalized.replace(/,\s*([}\]])/g, "$1");
}

function parseChartDataAssignment(raw: string): unknown | null {
  const objectText = extractAssignedObject(raw, "chartData");
  if (objectText === null) {
    return null;
  }

  const normalized = normalizeKnownObjectKeys(
    objectText,
    new Set(["time", "value", "datasets", "data", "x", "y"]),
  );
  try {
    return JSON.parse(normalized);
  } catch (error) {
    // Older/live variants may include unrelated JavaScript-only properties.
    // The price series itself is still recoverable from its time/value arrays.
    try {
      return {
        time: extractArrayProperty(objectText, "time", "chartData"),
        value: extractArrayProperty(objectText, "value", "chartData"),
      };
    } catch {
      throw new TypeError(
        `chartData must contain a supported price series: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function parseJson1Assignment(raw: string): unknown | null {
  const objectText = extractAssignedObject(raw, "json1");
  if (objectText === null) {
    return null;
  }

  const normalized = objectText.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(normalized);
  } catch {
    // The live Data Center response is JavaScript, not an API contract. Keep the
    // parser tolerant of extra JS-only properties while extracting only the two
    // arrays that define the price series.
    return {
      time: extractArrayProperty(objectText, "time"),
      value: extractArrayProperty(objectText, "value"),
    };
  }
}

function finalizePoints(points: PricePoint[]): PricePoint[] {
  if (points.length < 2) {
    throw new TypeError("price graph must contain at least two points");
  }

  const sorted = [...points].sort(
    (left, right) => left.source_timestamp_ms - right.source_timestamp_ms,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) {
      continue;
    }
    if (previous.source_timestamp_ms === current.source_timestamp_ms) {
      throw new TypeError(
        `price graph contains duplicate timestamp ${current.source_timestamp_ms}`,
      );
    }
  }

  return sorted;
}

function parseTimestampedChartData(chartData: unknown): PricePoint[] {
  if (!isRecord(chartData) || !Array.isArray(chartData.datasets)) {
    throw new TypeError("chartData.datasets must be an array");
  }

  const firstDataset = chartData.datasets[0];
  if (!isRecord(firstDataset) || !Array.isArray(firstDataset.data)) {
    throw new TypeError("chartData.datasets[0].data must be an array");
  }

  const points = firstDataset.data.map((entry, index): PricePoint => {
    if (!isRecord(entry)) {
      throw new TypeError(
        `chartData.datasets[0].data[${index}] must be an object`,
      );
    }

    const sourceTimestampMs = readPositiveInteger(
      entry.x,
      `chartData.datasets[0].data[${index}].x`,
    );
    const value = readPositiveInteger(
      entry.y,
      `chartData.datasets[0].data[${index}].y`,
    );

    return { source_timestamp_ms: sourceTimestampMs, value };
  });

  return finalizePoints(points);
}

function parseExplicitTimestamp(
  value: unknown,
  context: string,
): number | null {
  if (typeof value === "number") {
    return readPositiveInteger(value, context);
  }
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return readPositiveInteger(trimmed, context);
  }

  const dateConstructor = /^(?:new\s+)?Date\s*\(\s*(\d+)\s*\)$/i.exec(trimmed);
  return dateConstructor
    ? readPositiveInteger(dateConstructor[1], context)
    : null;
}

function resolveMixedLegacyTimes(
  entries: unknown[],
  observedAt: string | undefined,
  context: string,
): number[] {
  if (entries.length < 2) {
    throw new TypeError(`${context}.time must contain at least two entries`);
  }

  const parsed = entries.map((entry, index) => {
    const entryContext = `${context}.time[${index}]`;
    const explicitTimestamp = parseExplicitTimestamp(entry, entryContext);
    if (explicitTimestamp !== null) {
      return { kind: "timestamp" as const, value: explicitTimestamp };
    }
    return {
      kind: "label" as const,
      value: parseMonthDay(entry, entryContext),
    };
  });

  const hasLabels = parsed.some((entry) => entry.kind === "label");
  if (hasLabels && !observedAt) {
    throw new TypeError(
      `observed_at is required when ${context}.time contains M.DD date labels`,
    );
  }

  let observedDateMs: number | null = null;
  let observedYear: number | null = null;
  if (hasLabels && observedAt) {
    const observed = kstCalendarDate(observedAt);
    observedYear = observed.year;
    observedDateMs = calendarDateMs(
      observed.year,
      observed.month,
      observed.day,
      "observed_at",
    );
  }

  const resolved = new Array<number>(parsed.length);
  let nextTimestamp: number | null = null;

  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    const entry = parsed[index];
    if (!entry) {
      throw new TypeError(`failed to resolve ${context}.time[${index}]`);
    }

    let timestamp: number;
    if (entry.kind === "timestamp") {
      timestamp = entry.value;
    } else {
      if (observedYear === null || observedDateMs === null) {
        throw new TypeError(
          `observed_at is required when ${context}.time contains M.DD date labels`,
        );
      }

      const upperBound = nextTimestamp ?? observedDateMs + DAY_MS;
      let year =
        nextTimestamp === null
          ? observedYear
          : new Date(nextTimestamp).getUTCFullYear();
      timestamp = calendarDateMs(
        year,
        entry.value.month,
        entry.value.day,
        `${context}.time[${index}]`,
      );
      if (timestamp >= upperBound) {
        year -= 1;
        timestamp = calendarDateMs(
          year,
          entry.value.month,
          entry.value.day,
          `${context}.time[${index}]`,
        );
      }
    }

    if (nextTimestamp !== null && timestamp >= nextTimestamp) {
      throw new TypeError(
        `${context}.time must resolve to strictly increasing timestamps; ` +
          `${context}.time[${index}] resolved to ${timestamp} before ${nextTimestamp}`,
      );
    }

    resolved[index] = timestamp;
    nextTimestamp = timestamp;
  }

  return resolved;
}

function parseLegacyChartData(
  chartData: Record<string, unknown>,
  observedAt?: string,
): PricePoint[] {
  if (!Array.isArray(chartData.time) || !Array.isArray(chartData.value)) {
    throw new TypeError(
      "chartData must contain datasets[0].data or matching time/value arrays",
    );
  }
  if (chartData.time.length !== chartData.value.length) {
    throw new TypeError(
      "chartData.time and chartData.value must have the same length",
    );
  }

  const timestamps = resolveMixedLegacyTimes(
    chartData.time,
    observedAt,
    "chartData",
  );

  return finalizePoints(
    timestamps.map((sourceTimestampMs, index) => ({
      source_timestamp_ms: sourceTimestampMs,
      value: readPositiveInteger(
        chartData.value[index],
        `chartData.value[${index}]`,
      ),
    })),
  );
}

function parseMonthDay(
  value: unknown,
  context: string,
): { month: number; day: number } {
  if (typeof value !== "string") {
    throw new TypeError(
      `${context} must be an M.D or M.DD date label; got ${JSON.stringify(value)}`,
    );
  }

  const match = /^(\d{1,2})\.(\d{1,2})$/.exec(value.trim());
  if (!match) {
    throw new TypeError(
      `${context} must be an M.D or M.DD date label; got ${JSON.stringify(value)}`,
    );
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new TypeError(`${context} is not a valid month/day label`);
  }
  return { month, day };
}

function calendarDateMs(
  year: number,
  month: number,
  day: number,
  context: string,
): number {
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`${context} is not a valid calendar date`);
  }
  return timestamp;
}

function kstCalendarDate(observedAt: string): {
  year: number;
  month: number;
  day: number;
} {
  const parsed = new Date(observedAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("observed_at must be an ISO-8601-compatible timestamp");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(byType.get("year")),
    month: Number(byType.get("month")),
    day: Number(byType.get("day")),
  };
}

function resolveDateLabels(
  labels: unknown[],
  observedAt: string,
  context = "json1",
): number[] {
  if (labels.length < 2) {
    throw new TypeError(
      `${context}.time must contain at least two date labels`,
    );
  }

  const parsedLabels = labels.map((label, index) =>
    parseMonthDay(label, `${context}.time[${index}]`),
  );

  for (let index = 1; index < labels.length; index += 1) {
    if (labels[index] === labels[index - 1]) {
      throw new TypeError(
        `${context}.time contains duplicate adjacent label ${String(labels[index])}`,
      );
    }
  }

  const observed = kstCalendarDate(observedAt);
  const observedDateMs = calendarDateMs(
    observed.year,
    observed.month,
    observed.day,
    "observed_at",
  );

  const resolved = new Array<number>(parsedLabels.length);
  const lastIndex = parsedLabels.length - 1;
  const last = parsedLabels[lastIndex];
  if (!last) {
    throw new TypeError(`${context}.time must contain date labels`);
  }

  let lastYear = observed.year;
  let lastTimestamp = calendarDateMs(
    lastYear,
    last.month,
    last.day,
    `${context}.time[${lastIndex}]`,
  );
  if (lastTimestamp > observedDateMs) {
    lastYear -= 1;
    lastTimestamp = calendarDateMs(
      lastYear,
      last.month,
      last.day,
      `${context}.time[${lastIndex}]`,
    );
  }
  resolved[lastIndex] = lastTimestamp;

  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    const current = parsedLabels[index];
    const nextTimestamp = resolved[index + 1];
    if (!current || nextTimestamp === undefined) {
      throw new TypeError(`failed to resolve ${context} date labels`);
    }

    const nextYear = new Date(nextTimestamp).getUTCFullYear();
    let candidateYear = nextYear;
    let candidate = calendarDateMs(
      candidateYear,
      current.month,
      current.day,
      `${context}.time[${index}]`,
    );
    if (candidate >= nextTimestamp) {
      candidateYear -= 1;
      candidate = calendarDateMs(
        candidateYear,
        current.month,
        current.day,
        `${context}.time[${index}]`,
      );
    }
    resolved[index] = candidate;
  }

  return resolved;
}

function parseLabeledSeries(
  time: unknown[],
  value: unknown[],
  observedAt: string,
  context: string,
): PricePoint[] {
  if (time.length !== value.length) {
    throw new TypeError(
      `${context}.time and ${context}.value must have the same length`,
    );
  }

  const timestamps = resolveDateLabels(time, observedAt, context);
  return finalizePoints(
    timestamps.map(
      (sourceTimestampMs, index): PricePoint => ({
        source_timestamp_ms: sourceTimestampMs,
        value: readPositiveInteger(value[index], `${context}.value[${index}]`),
      }),
    ),
  );
}

function parseLabeledJson1(json1: unknown, observedAt: string): PricePoint[] {
  if (
    !isRecord(json1) ||
    !Array.isArray(json1.time) ||
    !Array.isArray(json1.value)
  ) {
    throw new TypeError("json1.time and json1.value must be arrays");
  }
  return parseLabeledSeries(json1.time, json1.value, observedAt, "json1");
}

export function parseDatacenterPriceGraph(
  raw: string,
  observedAt?: string,
): PricePoint[] {
  const chartData = parseChartDataAssignment(raw);
  if (chartData !== null) {
    if (!isRecord(chartData)) {
      throw new TypeError("chartData must be an object");
    }
    if (Array.isArray(chartData.datasets)) {
      return parseTimestampedChartData(chartData);
    }
    return parseLegacyChartData(chartData, observedAt);
  }

  const json1 = parseJson1Assignment(raw);
  if (json1 !== null) {
    if (!observedAt) {
      throw new TypeError("observed_at is required for json1 M.DD date labels");
    }
    return parseLabeledJson1(json1, observedAt);
  }

  throw new TypeError(
    "response does not contain a supported price graph assignment (chartData or json1)",
  );
}

export function inferNativeGranularity(points: PricePoint[]): string {
  if (points.length < 2) {
    return "UNKNOWN";
  }

  const deltas: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) {
      continue;
    }
    const delta = current.source_timestamp_ms - previous.source_timestamp_ms;
    if (delta <= 0) {
      throw new TypeError(
        "price points must have strictly increasing timestamps",
      );
    }
    deltas.push(delta);
  }

  const cadenceMs = gcdAll(deltas);
  if (cadenceMs >= DAY_MS && cadenceMs % DAY_MS === 0) {
    return `P${cadenceMs / DAY_MS}D`;
  }
  if (cadenceMs >= HOUR_MS && cadenceMs % HOUR_MS === 0) {
    return `PT${cadenceMs / HOUR_MS}H`;
  }
  if (cadenceMs >= MINUTE_MS && cadenceMs % MINUTE_MS === 0) {
    return `PT${cadenceMs / MINUTE_MS}M`;
  }
  return `PT${cadenceMs}MS`;
}

function assertSpid(spid: string): void {
  if (!/^\d+$/.test(spid)) {
    throw new TypeError("spid must contain digits only");
  }
}

function assertGrade(grade: number): void {
  if (!Number.isInteger(grade) || grade < 1 || grade > 13) {
    throw new TypeError("grade must be an integer from 1 to 13");
  }
}

function assertObservedAt(observedAt: string): void {
  if (Number.isNaN(Date.parse(observedAt))) {
    throw new TypeError("observed_at must be an ISO-8601-compatible timestamp");
  }
}

function sourceDate(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

export function buildDatacenterPriceCaptureEvidence(input: {
  raw: string;
  spid: string;
  grade: number;
  observed_at: string;
}): DatacenterPriceCaptureEvidence {
  assertSpid(input.spid);
  assertGrade(input.grade);
  assertObservedAt(input.observed_at);

  const points = parseDatacenterPriceGraph(input.raw, input.observed_at);
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) {
    throw new TypeError("price graph must contain points");
  }

  const spanDays =
    (last.source_timestamp_ms - first.source_timestamp_ms) / DAY_MS;
  const granularity = inferNativeGranularity(points);
  const rawSha256 = `sha256:${createHash("sha256").update(input.raw).digest("hex")}`;

  return {
    source_id: "fconline-datacenter-price-history",
    spid: input.spid,
    grade: input.grade,
    observed_at: input.observed_at,
    raw_sha256: rawSha256,
    point_count: points.length,
    first_source_date: sourceDate(first.source_timestamp_ms),
    last_source_date: sourceDate(last.source_timestamp_ms),
    first_source_timestamp: new Date(first.source_timestamp_ms).toISOString(),
    last_source_timestamp: new Date(last.source_timestamp_ms).toISOString(),
    observed_span_days: Number(spanDays.toFixed(3)),
    native_granularity: granularity,
    price_semantics: "MARKET_REFERENCE_PRICE",
    gate_update: {
      native_granularity: granularity,
      history_span: `${points.length}_POINTS_${Number(spanDays.toFixed(3))}D_SPAN`,
      evidence_hash: rawSha256,
    },
  };
}
