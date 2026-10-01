import { readFile } from "node:fs/promises";

import {
  evaluateBenchmarkGate1A,
  parseBenchmarkDiscoveryTargetDocument,
} from "../benchmark/gate1a.ts";
import { openMarketDatabase } from "../db/market-db.ts";
import { parseSourceViabilityDocument } from "../gates/source-viability.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const targetsPath =
  readOption(args, "targets") ?? "data/raw/benchmark-discovery/targets.json";
const evidencePath =
  readOption(args, "evidence") ?? "data/evidence/source-viability.json";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const asOf = readOption(args, "as-of") ?? new Date().toISOString();
const requireReady = args.includes("--require-ready");

const targets = parseBenchmarkDiscoveryTargetDocument(
  JSON.parse(await readFile(targetsPath, "utf8")),
);
const sourceDocument = parseSourceViabilityDocument(
  JSON.parse(await readFile(evidencePath, "utf8")),
);

const db = openMarketDatabase(dbPath);
try {
  const result = evaluateBenchmarkGate1A(db, targets, sourceDocument, { asOf });
  console.log(
    JSON.stringify(
      {
        ...result,
        db_path: dbPath,
        targets_path: targetsPath,
        evidence_path: evidencePath,
      },
      null,
      2,
    ),
  );
  if (requireReady && result.status === "BLOCKED") {
    process.exitCode = 2;
  }
} finally {
  db.close();
}
