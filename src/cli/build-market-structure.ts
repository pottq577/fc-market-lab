import { readFile } from "node:fs/promises";

import { parseSeedCatalogDocument } from "../catalog/seed-catalog.ts";
import {
  countMarketStructureDatabase,
  openMarketDatabase,
} from "../db/market-db.ts";
import { buildMarketStructure } from "../normalize/market-structure.ts";

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
const catalogPath = readOption(args, "catalog") ?? "data/catalog/seed-catalog.json";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const asOf = readOption(args, "as-of");
const catalog = parseSeedCatalogDocument(
  JSON.parse(await readFile(catalogPath, "utf8")),
);

const db = openMarketDatabase(dbPath);
try {
  const result = buildMarketStructure(db, catalog, { asOf });
  console.log(
    JSON.stringify(
      {
        status: "BUILT",
        db_path: dbPath,
        catalog_path: catalogPath,
        ...result,
        totals: countMarketStructureDatabase(db),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
