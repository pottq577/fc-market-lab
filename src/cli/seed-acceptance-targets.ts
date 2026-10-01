import { readFile } from "node:fs/promises";

import { seedAcceptanceTargets } from "../acceptance/target-seeding.ts";
import { parseResolvedAcceptanceTargetDocument } from "../catalog/acceptance-targets.ts";
import { countMarketAnnotationDatabase, countMarketStructureDatabase, openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const targetsPath = readOption(args, "targets") ?? "data/catalog/acceptance-targets.resolved.json";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const document = parseResolvedAcceptanceTargetDocument(
  JSON.parse(await readFile(targetsPath, "utf8")),
);
const db = openMarketDatabase(dbPath);
try {
  const result = seedAcceptanceTargets(db, document);
  console.log(JSON.stringify({
    status: "SEEDED",
    db_path: dbPath,
    targets_path: targetsPath,
    ...result,
    annotation_totals: countMarketAnnotationDatabase(db),
    structure_totals: countMarketStructureDatabase(db),
  }, null, 2));
} finally {
  db.close();
}
