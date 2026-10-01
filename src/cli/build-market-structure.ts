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

function countCohortMembershipsById(
  db: ReturnType<typeof openMarketDatabase>,
): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT cd.cohort_id, COUNT(cm.instrument_id) AS count
       FROM cohort_definition cd
       LEFT JOIN cohort_membership cm ON cm.cohort_id = cd.cohort_id
       GROUP BY cd.cohort_id
       ORDER BY cd.cohort_id`,
    )
    .all() as Array<{ cohort_id: string; count: number | bigint }>;
  return Object.fromEntries(
    rows.map((row) => [row.cohort_id, Number(row.count)]),
  );
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
        cohort_memberships_by_cohort: countCohortMembershipsById(db),
        totals: countMarketStructureDatabase(db),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
