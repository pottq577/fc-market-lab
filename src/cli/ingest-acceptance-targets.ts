import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { SeedPlayer } from "../catalog/seed-catalog.ts";
import { parseResolvedAcceptanceTargetDocument } from "../catalog/acceptance-targets.ts";
import { countPriceDatabase, openMarketDatabase } from "../db/market-db.ts";
import type { CoverageSnapshot } from "../gates/coverage-viability.ts";
import { indexRawPriceFilesByHash } from "../ingest/raw-price-files.ts";
import { normalizePriceHistorySnapshot } from "../normalize/price-history.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) result.push(path);
    }
  }
  await walk(root);
  return result.sort();
}

interface Capture {
  spid: string;
  grade: number;
  observed_at: string;
  raw_sha256: string;
  point_count: number;
  first_source_date: string;
  last_source_date: string;
  observed_span_days: number;
  native_granularity: string;
}

function parseCapture(value: unknown): Capture | null {
  if (!isRecord(value) || value.parse_status !== "PARSED") return null;
  if (!isRecord(value.request) || !isRecord(value.evidence)) return null;
  const evidence = value.evidence;
  const capture: Capture = {
    spid: String(value.request.spid ?? ""),
    grade: Number(value.request.n1strong),
    observed_at: String(value.observed_at ?? ""),
    raw_sha256: String(evidence.raw_sha256 ?? ""),
    point_count: Number(evidence.point_count),
    first_source_date: String(evidence.first_source_date ?? ""),
    last_source_date: String(evidence.last_source_date ?? ""),
    observed_span_days: Number(evidence.observed_span_days),
    native_granularity: String(evidence.native_granularity ?? ""),
  };
  if (
    !/^\d+$/.test(capture.spid) ||
    !Number.isInteger(capture.grade) ||
    Number.isNaN(Date.parse(capture.observed_at)) ||
    !/^sha256:[0-9a-f]{64}$/i.test(capture.raw_sha256) ||
    !Number.isInteger(capture.point_count) || capture.point_count <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(capture.first_source_date) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(capture.last_source_date) ||
    !Number.isFinite(capture.observed_span_days) ||
    capture.native_granularity === ""
  ) return null;
  return capture;
}

function seed(target: {
  player_key: string;
  player_name: string;
  spid: string;
  grade: number;
  target_id: string;
}): SeedPlayer {
  return {
    player_key: target.player_key,
    player_name: target.player_name,
    primary_instrument: { spid: target.spid, grade: target.grade },
    selection_observation: {
      section: "CLASS_USAGE",
      ranker_squad_count: 0,
      displayed_share_percent: 0,
    },
    selection_reason: `Supplementary acceptance target ${target.target_id}`,
  };
}

const args = process.argv.slice(2);
const targetsPath = readOption(args, "targets") ?? "data/catalog/acceptance-targets.resolved.json";
const rawDir = readOption(args, "raw-dir") ?? "data/raw/datacenter-price";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const document = parseResolvedAcceptanceTargetDocument(
  JSON.parse(await readFile(targetsPath, "utf8")),
);
const latest = new Map<string, Capture>();
for (const path of await jsonFiles(rawDir)) {
  const capture = parseCapture(JSON.parse(await readFile(path, "utf8")));
  if (!capture) continue;
  const key = `${capture.spid}:${capture.grade}`;
  const previous = latest.get(key);
  if (!previous || capture.observed_at > previous.observed_at) latest.set(key, capture);
}
const rawByHash = await indexRawPriceFilesByHash(rawDir);
const db = openMarketDatabase(dbPath);
try {
  const results = [];
  for (const target of document.targets) {
    const key = `${target.spid}:${target.grade}`;
    const capture = latest.get(key);
    if (!capture) throw new TypeError(`no parsed price capture found for acceptance target ${key}`);
    const raw = rawByHash.get(capture.raw_sha256);
    if (!raw) throw new TypeError(`raw capture ${capture.raw_sha256} for ${key} is missing`);
    const expected: CoverageSnapshot = {
      spid: target.spid,
      grade: target.grade,
      class_code: target.season,
      observed_at: capture.observed_at,
      raw_sha256: capture.raw_sha256,
      point_count: capture.point_count,
      first_source_date: capture.first_source_date,
      last_source_date: capture.last_source_date,
      observed_span_days: capture.observed_span_days,
      native_granularity: capture.native_granularity,
    };
    const normalized = normalizePriceHistorySnapshot(db, {
      seed: seed(target),
      expected,
      raw: raw.raw,
      source_id: "fconline-datacenter-price-history",
      capture_method: "OPERATOR_INVOKED_EXPERIMENTAL_COLLECTOR",
    });
    results.push({ target_id: target.target_id, ...normalized });
  }
  console.log(JSON.stringify({
    status: "INGESTED",
    db_path: dbPath,
    targets_path: targetsPath,
    results,
    totals: countPriceDatabase(db),
  }, null, 2));
} finally {
  db.close();
}
