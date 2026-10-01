import { readFile } from "node:fs/promises";

import {
  countMarketAnnotationDatabase,
  openMarketDatabase,
} from "../db/market-db.ts";
import { parseMarketAnnotationDocument } from "../evidence/market-annotations.ts";
import { normalizeMarketAnnotations } from "../normalize/market-annotations.ts";

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
const positionalInput = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
const inputPath = readOption(args, "input") ?? positionalInput;
if (!inputPath) {
  throw new TypeError(
    "market annotation input is required: --input <path> or a positional path",
  );
}
const document = parseMarketAnnotationDocument(
  JSON.parse(await readFile(inputPath, "utf8")),
);
if (args.includes("--check")) {
  console.log(
    JSON.stringify(
      {
        status: "VALID",
        input_path: inputPath,
        annotated_at: document.annotated_at,
        events: document.events.length,
        products: document.products.length,
        rewards: document.products.reduce(
          (sum, product) => sum + product.rewards.length,
          0,
        ),
        exposures: document.exposures.length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const db = openMarketDatabase(dbPath);
try {
  const result = normalizeMarketAnnotations(db, document);
  console.log(
    JSON.stringify(
      {
        status: "INGESTED",
        input_path: inputPath,
        db_path: dbPath,
        ...result,
        totals: countMarketAnnotationDatabase(db),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
