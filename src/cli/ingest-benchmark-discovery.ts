import { readFile } from "node:fs/promises";

import {
  parseBenchmarkDiscoveryBatchDocument,
} from "../benchmark/discovery-collection.ts";
import { ingestBenchmarkDiscoveryBatch } from "../benchmark/discovery-ingest.ts";
import { countPriceDatabase, openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const batchPath = readOption(args, "batch");
if (!batchPath) {
  throw new TypeError(
    "usage: npm run benchmark:ingest-discovery -- --batch <batch-manifest.json> [--db <path>]",
  );
}
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const batch = parseBenchmarkDiscoveryBatchDocument(
  JSON.parse(await readFile(batchPath, "utf8")),
);

const db = openMarketDatabase(dbPath);
try {
  const result = await ingestBenchmarkDiscoveryBatch(db, batch);
  console.log(
    JSON.stringify(
      {
        status: "INGESTED",
        db_path: dbPath,
        batch_path: batchPath,
        ...result,
        totals: countPriceDatabase(db),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
