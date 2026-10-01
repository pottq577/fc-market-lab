import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  BENCHMARK_DISCOVERY_VERSION,
  DEFAULT_DISCOVERY_PROBE_GRADE,
  DEFAULT_DISCOVERY_SAMPLE_SEED,
  DEFAULT_DISCOVERY_TARGET_SIZE,
  benchmarkDiscoveryTargets,
  buildBenchmarkDiscoveryFrame,
} from "../benchmark/discovery-frame.ts";
import { openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  option: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${option} must be a positive integer`);
  }
  return parsed;
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const targetsOutput =
  readOption(args, "targets-output") ??
  "data/raw/benchmark-discovery/targets.json";
const targetSize = positiveInteger(
  readOption(args, "target-size"),
  DEFAULT_DISCOVERY_TARGET_SIZE,
  "--target-size",
);
const probeGrade = positiveInteger(
  readOption(args, "probe-grade"),
  DEFAULT_DISCOVERY_PROBE_GRADE,
  "--probe-grade",
);
const sampleSeed = readOption(args, "sample-seed") ?? DEFAULT_DISCOVERY_SAMPLE_SEED;
const frameVersion = readOption(args, "frame-version") ?? BENCHMARK_DISCOVERY_VERSION;
const fromRank = positiveInteger(readOption(args, "from-rank"), 1, "--from-rank");
const defaultToRank = Math.min(100, targetSize);
const toRank = positiveInteger(
  readOption(args, "to-rank"),
  defaultToRank,
  "--to-rank",
);

const db = openMarketDatabase(dbPath);
try {
  const requestedUniverse = readOption(args, "universe");
  const universe = requestedUniverse
    ? db
        .prepare(
          `SELECT universe_snapshot_id, as_of
           FROM market_universe_snapshot
           WHERE universe_snapshot_id = ?`,
        )
        .get(requestedUniverse)
    : db
        .prepare(
          `SELECT universe_snapshot_id, as_of
           FROM market_universe_snapshot
           ORDER BY as_of DESC, created_at DESC, universe_snapshot_id DESC
           LIMIT 1`,
        )
        .get();
  if (!universe) {
    throw new TypeError(
      requestedUniverse
        ? `unknown universe snapshot: ${requestedUniverse}`
        : "no market universe snapshot exists; run benchmark:universe first",
    );
  }
  const universeRow = universe as {
    universe_snapshot_id: string;
    as_of: string;
  };

  const result = buildBenchmarkDiscoveryFrame(db, {
    universeSnapshotId: universeRow.universe_snapshot_id,
    targetSize,
    sampleSeed,
    probeGrade,
    frameVersion,
  });
  const targets = benchmarkDiscoveryTargets(db, result.discovery_frame_id, {
    fromRank,
    toRank,
  });

  await mkdir(dirname(targetsOutput), { recursive: true });
  await writeFile(
    targetsOutput,
    `${JSON.stringify(
      {
        schema_version: 1,
        discovery_frame_id: result.discovery_frame_id,
        universe_snapshot_id: result.universe_snapshot_id,
        universe_as_of: universeRow.as_of,
        from_rank: fromRank,
        to_rank: toRank,
        targets,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    JSON.stringify(
      {
        status: "BUILT",
        db_path: dbPath,
        targets_output: targetsOutput,
        exported_target_count: targets.length,
        export_rank_range: [fromRank, toRank],
        ...result,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
