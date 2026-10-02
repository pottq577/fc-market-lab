import {
  BENCHMARK_PANEL_VERSION,
  DEFAULT_BENCHMARK_PANEL_SEED,
  buildBenchmarkPanels,
  resolveBenchmarkPanelUniverseId,
} from "../benchmark/panel.ts";
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

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const requestedFrame = readOption(args, "frame");
const requestedUniverse = readOption(args, "universe");
const panelVersion = readOption(args, "panel-version") ?? BENCHMARK_PANEL_VERSION;
const sampleSeed = readOption(args, "sample-seed") ?? DEFAULT_BENCHMARK_PANEL_SEED;
const effectiveFrom = readOption(args, "effective-from");
const createdAt = readOption(args, "created-at");

const db = openMarketDatabase(dbPath);
try {
  const discoveryFrameId = resolveBenchmarkDiscoveryFrameId(db, requestedFrame);
  const discoveryStatus = benchmarkDiscoveryStatus(db, discoveryFrameId);
  if (discoveryStatus.readiness !== "READY_FOR_PANEL") {
    throw new TypeError(
      `discovery ${discoveryFrameId} is ${discoveryStatus.readiness}; panel creation requires READY_FOR_PANEL`,
    );
  }
  const universeSnapshotId = resolveBenchmarkPanelUniverseId(
    db,
    discoveryFrameId,
    requestedUniverse,
  );
  const result = buildBenchmarkPanels(db, {
    discoveryStatus,
    universeSnapshotId,
    panelVersion,
    sampleSeed,
    ...(effectiveFrom !== undefined ? { effectiveFrom } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
  });
  console.log(
    JSON.stringify(
      {
        status: "READY",
        db_path: dbPath,
        ...result,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
