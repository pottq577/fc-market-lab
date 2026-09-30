import { readFile } from "node:fs/promises";

import {
  parseSeedCatalogDocument,
  seedCatalogTargets,
  summarizeSeedCatalog,
} from "../catalog/seed-catalog.ts";

const args = process.argv.slice(2);
const catalogPath = args.find((arg) => !arg.startsWith("--")) ??
  "data/catalog/seed-catalog.json";
const emitTargets = args.includes("--targets");

const raw = await readFile(catalogPath, "utf8");
const document = parseSeedCatalogDocument(JSON.parse(raw));

console.log(
  JSON.stringify(
    emitTargets
      ? { catalog_id: document.catalog_id, targets: seedCatalogTargets(document) }
      : summarizeSeedCatalog(document),
    null,
    2,
  ),
);
