import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { collectBenchmarkDiscoveryBatch } from "../benchmark/discovery-collection.ts";
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

function optionalInteger(args: string[], name: string): number | undefined {
  const value = readOption(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TypeError(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

const args = process.argv.slice(2);
const targetsPath =
  readOption(args, "targets") ?? "data/raw/benchmark-discovery/targets.json";
const evidencePath =
  readOption(args, "evidence") ?? "data/evidence/source-viability.json";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const outputDir =
  readOption(args, "output-dir") ?? "data/raw/benchmark-discovery/price";
const batchDir =
  readOption(args, "batch-dir") ?? "data/raw/benchmark-discovery/batches";
const delayMs = optionalInteger(args, "delay-ms");
const timeoutMs = optionalInteger(args, "timeout-ms");
const maxRetries = optionalInteger(args, "max-retries");

const targets = parseBenchmarkDiscoveryTargetDocument(
  JSON.parse(await readFile(targetsPath, "utf8")),
);
const sourceDocument = parseSourceViabilityDocument(
  JSON.parse(await readFile(evidencePath, "utf8")),
);

const db = openMarketDatabase(dbPath);
let gate;
try {
  gate = evaluateBenchmarkGate1A(db, targets, sourceDocument, {
    asOf: new Date().toISOString(),
  });
} finally {
  db.close();
}
if (gate.status === "BLOCKED") {
  throw new TypeError(`Gate 1A is BLOCKED: ${gate.blockers.join("; ")}`);
}

console.error(
  `Gate 1A ${gate.status}; source automation_decision=${gate.automation_decision}. ` +
    "This command is an operator-initiated experimental batch and does not change Gate 0A policy.",
);

const batch = await collectBenchmarkDiscoveryBatch(targets, gate, {
  outputDir,
  ...(delayMs !== undefined ? { delayMs } : {}),
  ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  ...(maxRetries !== undefined ? { maxRetries } : {}),
  onProgress: ({ index, total, result }) => {
    const detail =
      result.status === "COLLECTED"
        ? `points=${result.point_count ?? 0}`
        : `error=${result.error_message ?? "unknown"}`;
    console.error(
      `[${index}/${total}] rank=${result.sample_rank} ${result.spid}:${result.grade} ${result.status} ${detail}`,
    );
  },
});
await mkdir(batchDir, { recursive: true });
const batchPath = join(batchDir, `${batch.batch_id}.json`);
await writeFile(batchPath, `${JSON.stringify(batch, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});

const counts = {
  collected: batch.results.filter((item) => item.status === "COLLECTED").length,
  no_usable_price: batch.results.filter(
    (item) => item.status === "NO_USABLE_PRICE",
  ).length,
  failed: batch.results.filter((item) => item.status === "FAILED").length,
  halted: batch.results.filter((item) => item.status === "HALTED").length,
};
console.log(
  JSON.stringify(
    {
      status: batch.status,
      gate_status: gate.status,
      batch_path: batchPath,
      output_dir: outputDir,
      ...counts,
      batch_id: batch.batch_id,
      discovery_frame_id: batch.discovery_frame_id,
      rank_range: batch.rank_range,
    },
    null,
    2,
  ),
);
if (batch.status === "HALTED") {
  process.exitCode = 2;
}
