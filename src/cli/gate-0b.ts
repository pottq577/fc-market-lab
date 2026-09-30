import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseSeedCatalogDocument } from "../catalog/seed-catalog.ts";
import {
  evaluateGate0B,
  type CoverageSnapshot,
} from "../gates/coverage-viability.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listJsonFiles(root: string): Promise<string[]> {
  const result: string[] = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        result.push(path);
      }
    }
  }

  await walk(root);
  return result.sort();
}

function parseSnapshot(value: unknown, sourcePath: string): CoverageSnapshot | null {
  if (!isRecord(value) || value.parse_status !== "PARSED") {
    return null;
  }
  if (!isRecord(value.request) || !isRecord(value.evidence)) {
    return null;
  }

  const spid = String(value.request.spid ?? "");
  const grade = Number(value.request.n1strong);
  const observed_at = String(value.observed_at ?? "");
  const point_count = Number(value.evidence.point_count);
  const observed_span_days = Number(value.evidence.observed_span_days);
  const native_granularity = String(value.evidence.native_granularity ?? "");

  if (
    !/^\d+$/.test(spid) ||
    !Number.isInteger(grade) ||
    grade < 1 ||
    grade > 13 ||
    Number.isNaN(Date.parse(observed_at)) ||
    !Number.isInteger(point_count) ||
    point_count <= 0 ||
    !Number.isFinite(observed_span_days) ||
    observed_span_days < 0 ||
    native_granularity === ""
  ) {
    return null;
  }

  return {
    spid,
    grade,
    observed_at,
    point_count,
    observed_span_days,
    native_granularity,
    source_path: sourcePath,
  };
}

const args = process.argv.slice(2);
const catalogPath = readOption(args, "catalog") ?? "data/catalog/seed-catalog.json";
const rawDir = readOption(args, "raw-dir") ?? "data/raw/datacenter-price";
const requireReady = args.includes("--require-ready");

const catalog = parseSeedCatalogDocument(
  JSON.parse(await readFile(catalogPath, "utf8")),
);
const snapshots: CoverageSnapshot[] = [];

for (const path of await listJsonFiles(rawDir)) {
  const snapshot = parseSnapshot(JSON.parse(await readFile(path, "utf8")), path);
  if (snapshot) {
    snapshots.push(snapshot);
  }
}

const summary = evaluateGate0B(catalog, snapshots);
console.log(JSON.stringify(summary, null, 2));

if (requireReady && summary.status !== "READY") {
  process.exitCode = 2;
}
