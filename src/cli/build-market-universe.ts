import { readFile } from "node:fs/promises";

import {
  DEFAULT_PRICE_MAX_AGE_DAYS,
  DEFAULT_UNIVERSE_PRICE_SEMANTICS,
  MARKET_UNIVERSE_RULE_VERSION,
  buildMarketUniverseSnapshot,
  type UniversePriceSemantics,
} from "../benchmark/universe.ts";
import {
  OPENAPI_METADATA_URLS,
  type OpenApiMetadataKind,
} from "../collect/openapi-metadata.ts";
import { openMarketDatabase } from "../db/market-db.ts";

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

function parseManifest(value: unknown): {
  observed_at: string;
  artifacts: Record<OpenApiMetadataKind, string>;
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

  const artifacts = {} as Record<OpenApiMetadataKind, string>;
  for (const kind of ["spid", "season", "position"] as const) {
    const path = value.artifacts[kind];
    if (typeof path !== "string" || path.trim() === "") {
      throw new TypeError(`metadata manifest artifacts.${kind} is required`);
    }
    artifacts[kind] = path;
  }
  return { observed_at: value.observed_at, artifacts };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError("--price-max-age-days must be a positive integer");
  }
  return parsed;
}

function priceSemantics(value: string | undefined): UniversePriceSemantics {
  const parsed = value ?? DEFAULT_UNIVERSE_PRICE_SEMANTICS;
  if (
    parsed !== "MARKET_REFERENCE_PRICE" &&
    parsed !== "TRADE_PRICE" &&
    parsed !== "UNKNOWN"
  ) {
    throw new TypeError(
      "--price-semantics must be MARKET_REFERENCE_PRICE, TRADE_PRICE, or UNKNOWN",
    );
  }
  return parsed;
}

const args = process.argv.slice(2);
const manifestPath =
  readOption(args, "manifest") ?? "data/raw/openapi-metadata/latest.json";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const ruleVersion = readOption(args, "rule-version") ?? MARKET_UNIVERSE_RULE_VERSION;
const maxAgeDays = positiveInteger(
  readOption(args, "price-max-age-days"),
  DEFAULT_PRICE_MAX_AGE_DAYS,
);
const semantics = priceSemantics(readOption(args, "price-semantics"));

const manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")));
const asOf = readOption(args, "as-of") ?? manifest.observed_at;
const createdAt = readOption(args, "created-at");
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
  const result = buildMarketUniverseSnapshot(db, {
    artifacts,
    asOf,
    createdAt,
    ruleVersion,
    priceSemantics: semantics,
    priceMaxAgeDays: maxAgeDays,
  });
  console.log(
    JSON.stringify(
      {
        status: "BUILT",
        db_path: dbPath,
        manifest_path: manifestPath,
        ...result,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
