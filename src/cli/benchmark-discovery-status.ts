import {
  benchmarkDiscoveryStatus,
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
const requestedFrame = readOption(args, "frame");
const batchSize = positiveInteger(readOption(args, "batch-size"));

const db = openMarketDatabase(dbPath);
try {
  const discoveryFrameId = resolveBenchmarkDiscoveryFrameId(db, requestedFrame);
  const status = benchmarkDiscoveryStatus(db, discoveryFrameId, {
    ...(batchSize !== undefined ? { batchSize } : {}),
  });
  console.log(JSON.stringify({ status: "OK", db_path: dbPath, ...status }, null, 2));
} finally {
  db.close();
}
