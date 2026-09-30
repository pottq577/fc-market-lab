import { readFile } from "node:fs/promises";

import { parseSeedCatalogDocument } from "../catalog/seed-catalog.ts";
import { OPENAPI_METADATA_URLS } from "../collect/openapi-metadata.ts";
import {
  countMetadataUsageDatabase,
  openMarketDatabase,
} from "../db/market-db.ts";
import { normalizeOpenApiMetadata } from "../normalize/openapi-metadata.ts";
import { normalizeSeedUsage } from "../normalize/seed-usage.ts";

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

function parseManifest(value: unknown): {
  observed_at: string;
  artifacts: Record<"spid" | "season" | "position", string>;
} {
  if (!isRecord(value) || value.schema_version !== 1) {
    throw new TypeError("metadata manifest schema_version must be 1");
  }
  if (
    typeof value.observed_at !== "string" ||
    Number.isNaN(Date.parse(value.observed_at))
  ) {
    throw new TypeError("metadata manifest observed_at must be a timestamp");
  }
  if (!isRecord(value.artifacts)) {
    throw new TypeError("metadata manifest artifacts must be an object");
  }

  const artifacts = {} as Record<"spid" | "season" | "position", string>;
  for (const kind of ["spid", "season", "position"] as const) {
    const path = value.artifacts[kind];
    if (typeof path !== "string" || path.trim() === "") {
      throw new TypeError(`metadata manifest artifacts.${kind} is required`);
    }
    artifacts[kind] = path;
  }
  return { observed_at: value.observed_at, artifacts };
}

const args = process.argv.slice(2);
const catalogPath =
  readOption(args, "catalog") ?? "data/catalog/seed-catalog.json";
const manifestPath =
  readOption(args, "manifest") ?? "data/raw/openapi-metadata/latest.json";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";

const catalogRaw = await readFile(catalogPath);
const catalog = parseSeedCatalogDocument(JSON.parse(catalogRaw.toString("utf8")));
const manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")));
const artifacts = await Promise.all(
  (["spid", "season", "position"] as const).map(async (kind) => ({
    kind,
    source_url: OPENAPI_METADATA_URLS[kind],
    observed_at: manifest.observed_at,
    raw: await readFile(manifest.artifacts[kind]),
  })),
);

const db = openMarketDatabase(dbPath);
try {
  const metadata = normalizeOpenApiMetadata(db, { catalog, artifacts });
  const usage = normalizeSeedUsage(db, { catalog, catalogRaw });
  console.log(
    JSON.stringify(
      {
        status: "INGESTED",
        db_path: dbPath,
        catalog_id: catalog.catalog_id,
        manifest_path: manifestPath,
        metadata,
        usage,
        totals: countMetadataUsageDatabase(db),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
