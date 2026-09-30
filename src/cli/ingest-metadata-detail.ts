import { readFile } from "node:fs/promises";

import { parseSeedCatalogDocument } from "../catalog/seed-catalog.ts";
import { countMetadataUsageDatabase, openMarketDatabase } from "../db/market-db.ts";
import { parseDatacenterMetadataEvidenceDocument } from "../evidence/datacenter-metadata.ts";
import { indexRawHtmlFilesByHash } from "../ingest/raw-html-files.ts";
import { normalizeDatacenterMetadata } from "../normalize/datacenter-metadata.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const catalogPath =
  readOption(args, "catalog") ?? "data/catalog/seed-catalog.json";
const evidencePath =
  readOption(args, "evidence") ?? "data/evidence/datacenter-metadata-detail.json";
const rawDir =
  readOption(args, "raw-dir") ?? "data/raw/datacenter-metadata";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";

const catalog = parseSeedCatalogDocument(
  JSON.parse(await readFile(catalogPath, "utf8")),
);
const document = parseDatacenterMetadataEvidenceDocument(
  JSON.parse(await readFile(evidencePath, "utf8")),
);
const rawByHash = await indexRawHtmlFilesByHash(rawDir);
const db = openMarketDatabase(dbPath);
try {
  const result = normalizeDatacenterMetadata(db, {
    catalog,
    document,
    rawByHash,
  });
  console.log(
    JSON.stringify(
      {
        status: "INGESTED",
        db_path: dbPath,
        evidence_path: evidencePath,
        ...result,
        totals: countMetadataUsageDatabase(db),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
