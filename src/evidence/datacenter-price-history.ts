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

function readFiniteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${context} must be a finite number`);
  }
  return value;
}

function extractChartData(raw: string): unknown {
  const match = raw.match(/var\s+chartData\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!match?.[1]) {
    throw new TypeError("response does not contain a JSON chartData assignment");
  }

  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new TypeError(
      `chartData must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parseDatacenterPriceGraph(raw: string): PricePoint[] {
  const chartData = extractChartData(raw);
  if (!isRecord(chartData) || !Array.isArray(chartData.datasets)) {
    throw new TypeError("chartData.datasets must be an array");
  }

  const firstDataset = chartData.datasets[0];
  if (!isRecord(firstDataset) || !Array.isArray(firstDataset.data)) {
    throw new TypeError("chartData.datasets[0].data must be an array");
  }

  const points = firstDataset.data.map((entry, index): PricePoint => {
    if (!isRecord(entry)) {
      throw new TypeError(`chartData.datasets[0].data[${index}] must be an object`);
    }

    const sourceTimestampMs = readFiniteNumber(
      entry.x,
      `chartData.datasets[0].data[${index}].x`,
    );
    const value = readFiniteNumber(
      entry.y,
      `chartData.datasets[0].data[${index}].y`,
    );

    if (!Number.isInteger(sourceTimestampMs) || sourceTimestampMs <= 0) {
      throw new TypeError(
        `chartData.datasets[0].data[${index}].x must be a positive epoch-millisecond integer`,
      );
    }
    if (!Number.isInteger(value) || value <= 0) {
      throw new TypeError(
        `chartData.datasets[0].data[${index}].y must be a positive integer price`,
      );
    }

    return { source_timestamp_ms: sourceTimestampMs, value };
  });

  if (points.length < 2) {
    throw new TypeError("price graph must contain at least two points");
  }

  points.sort((a, b) => a.source_timestamp_ms - b.source_timestamp_ms);
  for (let index = 1; index < points.length; index += 1) {
    if (
      points[index - 1]?.source_timestamp_ms ===
      points[index]?.source_timestamp_ms
    ) {
      throw new TypeError(
        `price graph contains duplicate timestamp ${points[index]?.source_timestamp_ms}`,
      );
    }
  }

  return points;
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
      throw new TypeError("price points must have strictly increasing timestamps");
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

export function buildDatacenterPriceCaptureEvidence(input: {
  raw: string;
  spid: string;
  grade: number;
  observed_at: string;
}): DatacenterPriceCaptureEvidence {
  assertSpid(input.spid);
  assertGrade(input.grade);
  assertObservedAt(input.observed_at);

  const points = parseDatacenterPriceGraph(input.raw);
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
    first_source_timestamp: new Date(first.source_timestamp_ms).toISOString(),
    last_source_timestamp: new Date(last.source_timestamp_ms).toISOString(),
    observed_span_days: Number(spanDays.toFixed(3)),
    native_granularity: granularity,
    price_semantics: "MARKET_REFERENCE_PRICE",
    gate_update: {
      native_granularity: granularity,
      history_span: `${Number(spanDays.toFixed(3))}D_OBSERVED`,
      evidence_hash: rawSha256,
    },
  };
}
