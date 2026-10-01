import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  benchmarkDiscoveryStatus,
  nextBenchmarkDiscoveryTargetDocument,
  resolveBenchmarkDiscoveryFrameId,
} from "../benchmark/discovery-status.ts";
import { openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError("--batch-size must be a positive integer");
  }
  return parsed;
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const targetsOutput =
  readOption(args, "targets-output") ??
  "data/raw/benchmark-discovery/targets.json";
const requestedFrame = readOption(args, "frame");
const batchSize = positiveInteger(readOption(args, "batch-size"));

const db = openMarketDatabase(dbPath);
try {
  const discoveryFrameId = resolveBenchmarkDiscoveryFrameId(db, requestedFrame);
  const options = batchSize !== undefined ? { batchSize } : {};
  const status = benchmarkDiscoveryStatus(db, discoveryFrameId, options);
  const document = nextBenchmarkDiscoveryTargetDocument(
    db,
    discoveryFrameId,
    options,
  );
  if (!document) {
    console.log(
      JSON.stringify(
        {
          status: "COMPLETE",
          db_path: dbPath,
          targets_output: null,
          ...status,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  await mkdir(dirname(targetsOutput), { recursive: true });
  await writeFile(targetsOutput, `${JSON.stringify(document, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        status: "PREPARED",
        db_path: dbPath,
        targets_output: targetsOutput,
        prepared_target_count: document.targets.length,
        prepared_rank_range: [document.from_rank, document.to_rank],
        ...status,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
