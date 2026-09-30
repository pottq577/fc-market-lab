import { readFile } from "node:fs/promises";

import {
  parseSeedCatalogDocument,
  seedCatalogTargets,
} from "../catalog/seed-catalog.ts";
import {
  collectDatacenterPriceTargets,
  type PriceCollectionTarget,
} from "../collect/datacenter-price.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseTarget(value: unknown, context: string): PriceCollectionTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const spid = String(record.spid ?? "");
  const grade = Number(record.grade);
  return { spid, grade };
}

async function readTargets(args: string[]): Promise<PriceCollectionTarget[]> {
  const catalogPath = readOption(args, "catalog");
  const targetsPath = readOption(args, "targets");

  if (catalogPath && targetsPath) {
    throw new TypeError("--catalog and --targets are mutually exclusive");
  }

  if (catalogPath) {
    const parsed: unknown = JSON.parse(await readFile(catalogPath, "utf8"));
    return seedCatalogTargets(parseSeedCatalogDocument(parsed));
  }

  if (targetsPath) {
    const parsed: unknown = JSON.parse(await readFile(targetsPath, "utf8"));
    const values = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as Record<string, unknown>).targets)
        ? (parsed as { targets: unknown[] }).targets
        : null;
    if (!values) {
      throw new TypeError("targets file must be an array or {\"targets\": [...]} object");
    }
    return values.map((value, index) => parseTarget(value, `targets[${index}]`));
  }

  const spid = readOption(args, "spid");
  const grade = readOption(args, "grade");
  if (!spid || !grade) {
    throw new TypeError(
      "usage: npm run collect:price -- --spid <spid> --grade <grade> [--output-dir <dir>] [--delay-ms <ms>] OR --targets <json> OR --catalog <seed-catalog.json>",
    );
  }
  return [{ spid, grade: Number(grade) }];
}

const args = process.argv.slice(2);
const targets = await readTargets(args);
const outputDir = readOption(args, "output-dir");
const delayMs = readOption(args, "delay-ms");
const timeoutMs = readOption(args, "timeout-ms");
const maxRetries = readOption(args, "max-retries");

console.error(
  "experimental collector: Gate 0A policy remains MANUAL_ONLY; requests are sequential and stop on HTTP 403/429",
);

const results = await collectDatacenterPriceTargets(targets, {
  ...(outputDir ? { outputDir } : {}),
  ...(delayMs ? { delayMs: Number(delayMs) } : {}),
  ...(timeoutMs ? { timeoutMs: Number(timeoutMs) } : {}),
  ...(maxRetries ? { maxRetries: Number(maxRetries) } : {}),
});

console.log(JSON.stringify({ collected: results.length, results }, null, 2));
