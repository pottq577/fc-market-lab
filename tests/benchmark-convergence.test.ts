import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runBenchmarkConvergence } from "../src/benchmark/convergence.ts";

type PanelOffset = {
  returnOffset: number;
  breadthOffset: number;
  invertReturn?: boolean;
};

function fixture(
  days: number,
  offsets: Record<string, PanelOffset>,
): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE benchmark_panel (
      panel_id TEXT PRIMARY KEY,
      panel_family_id TEXT NOT NULL,
      panel_label TEXT NOT NULL,
      panel_size INTEGER NOT NULL,
      effective_from TEXT NOT NULL
    ) STRICT;
  `);
  db.exec(readFileSync("db/migrations/014_benchmark_metrics.sql", "utf8"));
  db.exec(readFileSync("db/migrations/015_benchmark_uncertainty.sql", "utf8"));
  db.exec(readFileSync("db/migrations/016_benchmark_convergence.sql", "utf8"));

  for (const [id, size] of [["p100", 100], ["p200", 200], ["p400", 400], ["p800", 800]] as const) {
    db.prepare("INSERT INTO benchmark_panel VALUES (?, 'family', ?, ?, '2026-10-02T00:00:00.000Z')")
      .run(id, `P${size}`, size);
  }

  db.prepare(
    `INSERT INTO benchmark_metric_run(
      benchmark_metric_run_id, panel_family_id, metric_version,
      analysis_cutoff, timezone, price_semantics,
      minimum_weighted_coverage, input_hash, created_at,
      status, result_hash
    ) VALUES (
      'metric-run', 'family', 'market-benchmark-metrics-v1',
      '2026-10-02T12:00:00.000Z', 'Asia/Seoul', 'MARKET_REFERENCE_PRICE',
      0.8, 'sha256:metric-input', '2026-10-02T12:00:00.000Z',
      'SUCCEEDED', 'sha256:metric-result'
    )`,
  ).run();
  db.prepare(
    `INSERT INTO benchmark_uncertainty_run VALUES (
      'uncertainty-run', 'metric-run', 'market-benchmark-uncertainty-v1',
      'STRATIFIED_PLAYER_BOOTSTRAP', 1000, 0.95,
      'market-benchmark-bootstrap-v1', 0.8,
      'sha256:uncertainty-input', '2026-10-02T12:01:00.000Z',
      'SUCCEEDED', 'sha256:uncertainty-result'
    )`,
  ).run();

  const start = new Date("2026-01-01T00:00:00.000Z");
  for (let day = 0; day < days; day += 1) {
    const current = new Date(start);
    current.setUTCDate(current.getUTCDate() + day);
    const date = current.toISOString().slice(0, 10);
    const baseReturn = day % 2 === 0 ? 0.01 : -0.01;
    const baseBreadth = day % 2 === 0 ? 0.55 : 0.45;
    for (const [panelId, size] of [["p100", 100], ["p200", 200], ["p400", 400], ["p800", 800]] as const) {
      const offset = offsets[panelId] ?? { returnOffset: 0, breadthOffset: 0 };
      const signedBase = offset.invertReturn ? -baseReturn : baseReturn;
      const returnValue = signedBase + (baseReturn > 0 ? offset.returnOffset : -offset.returnOffset);
      const breadthValue = baseBreadth + offset.breadthOffset;
      for (const [metricName, value] of [["RETURN_1D", returnValue], ["BREADTH", breadthValue]] as const) {
        db.prepare(
          `INSERT INTO benchmark_metric VALUES (
            'metric-run', ?, ?, 'FIXED_PANEL_BACKCAST', ?, ?, 'OK',
            ?, ?, ?, ?, 1, '{}'
          )`,
        ).run(panelId, date, metricName, value, size, size, size, size);
      }
    }
  }
  return db;
}

test("selects the smallest middle panel when every adjacent pair converges", () => {
  const db = fixture(70, {
    p100: { returnOffset: 0.0015, breadthOffset: 0.02 },
    p200: { returnOffset: 0.001, breadthOffset: 0.015 },
    p400: { returnOffset: 0.0005, breadthOffset: 0.01 },
    p800: { returnOffset: 0, breadthOffset: 0 },
  });
  try {
    const first = runBenchmarkConvergence(db, {
      benchmarkUncertaintyRunId: "uncertainty-run",
      createdAt: "2026-10-02T12:02:00.000Z",
    });
    const second = runBenchmarkConvergence(db, {
      benchmarkUncertaintyRunId: "uncertainty-run",
      createdAt: "2026-10-02T12:03:00.000Z",
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.benchmark_convergence_run_id, second.benchmark_convergence_run_id);
    assert.equal(first.result_hash, second.result_hash);
    assert.equal(first.benchmark_status, "STABLE");
    assert.equal(first.selected_panel_id, "p200");
    assert.equal(first.selected_panel_size, 200);
    assert.deepEqual(first.pairs.map((pair) => pair.status), ["PASS", "PASS", "PASS"]);
  } finally {
    db.close();
  }
});

test("keeps the benchmark unstable when the P400 to P800 terminal pair fails", () => {
  const db = fixture(70, {
    p100: { returnOffset: 0.0015, breadthOffset: 0.02 },
    p200: { returnOffset: 0.001, breadthOffset: 0.015 },
    p400: { returnOffset: 0.0005, breadthOffset: 0.01 },
    p800: { returnOffset: 0, breadthOffset: 0, invertReturn: true },
  });
  try {
    const result = runBenchmarkConvergence(db, {
      benchmarkUncertaintyRunId: "uncertainty-run",
    });
    assert.deepEqual(result.pairs.map((pair) => pair.status), ["PASS", "PASS", "FAIL"]);
    assert.equal(result.pairs[2]!.return_direction_match_ratio, 0);
    assert.equal(result.benchmark_status, "UNSTABLE");
    assert.equal(result.selected_panel_id, null);
  } finally {
    db.close();
  }
});

test("selects P400 when only the two largest adjacent pairs converge", () => {
  const db = fixture(70, {
    p100: { returnOffset: 0.02, breadthOffset: 0.2 },
    p200: { returnOffset: 0.001, breadthOffset: 0.015 },
    p400: { returnOffset: 0.0005, breadthOffset: 0.01 },
    p800: { returnOffset: 0, breadthOffset: 0 },
  });
  try {
    const result = runBenchmarkConvergence(db, {
      benchmarkUncertaintyRunId: "uncertainty-run",
    });
    assert.deepEqual(result.pairs.map((pair) => pair.status), ["FAIL", "PASS", "PASS"]);
    assert.equal(result.benchmark_status, "STABLE");
    assert.equal(result.selected_panel_id, "p400");
  } finally {
    db.close();
  }
});

test("marks pairs insufficient below the 60 common valid day floor", () => {
  const db = fixture(59, {
    p100: { returnOffset: 0.0015, breadthOffset: 0.02 },
    p200: { returnOffset: 0.001, breadthOffset: 0.015 },
    p400: { returnOffset: 0.0005, breadthOffset: 0.01 },
    p800: { returnOffset: 0, breadthOffset: 0 },
  });
  try {
    const result = runBenchmarkConvergence(db, {
      benchmarkUncertaintyRunId: "uncertainty-run",
    });
    assert.deepEqual(
      result.pairs.map((pair) => pair.status),
      ["INSUFFICIENT", "INSUFFICIENT", "INSUFFICIENT"],
    );
    assert.ok(result.pairs.every((pair) => pair.common_valid_return_days === 59));
    assert.equal(result.benchmark_status, "UNSTABLE");
  } finally {
    db.close();
  }
});
