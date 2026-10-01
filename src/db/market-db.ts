import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const PRICE_HISTORY_SCHEMA_VERSION = 1;
export const MARKET_SCHEMA_VERSION = 5;

export interface OpenMarketDatabaseOptions {
  migrationPath?: string;
  migrationPaths?: Partial<Record<number, string>>;
}

const DEFAULT_MIGRATION_PATHS: Record<number, string> = {
  1: "db/migrations/001_price_history.sql",
  2: "db/migrations/002_metadata_usage.sql",
  3: "db/migrations/003_market_annotations.sql",
  4: "db/migrations/004_market_structure.sql",
  5: "db/migrations/005_analysis_runs.sql",
};

function migrationPathFor(
  version: number,
  options: OpenMarketDatabaseOptions,
): string {
  if (version === 1 && options.migrationPath) {
    return options.migrationPath;
  }
  return options.migrationPaths?.[version] ?? DEFAULT_MIGRATION_PATHS[version]!;
}

function applyMigration(
  db: DatabaseSync,
  version: number,
  path: string,
): void {
  const applied = db
    .prepare("SELECT 1 AS applied FROM schema_migration WHERE version = ?")
    .get(version);
  if (applied) {
    return;
  }

  const migrationSql = readFileSync(path, "utf8");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(migrationSql);
    db.prepare(
      "INSERT INTO schema_migration(version, applied_at) VALUES (?, ?)",
    ).run(version, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openMarketDatabase(
  dbPath: string,
  options: OpenMarketDatabaseOptions = {},
): DatabaseSync {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  try {
    for (let version = 1; version <= MARKET_SCHEMA_VERSION; version += 1) {
      applyMigration(db, version, migrationPathFor(version, options));
    }
  } catch (error) {
    db.close();
    throw error;
  }

  return db;
}

export interface PriceDatabaseCounts {
  players: number;
  player_cards: number;
  instruments: number;
  source_snapshots: number;
  price_points: number;
}

export interface MetadataUsageDatabaseCounts {
  metadata_snapshots: number;
  metadata_snapshot_sources: number;
  usage_points: number;
}

export interface MarketAnnotationDatabaseCounts {
  events: number;
  products: number;
  rewards: number;
  exposures: number;
}

export interface MarketStructureDatabaseCounts {
  card_relations: number;
  relation_snapshots: number;
  cohort_definitions: number;
  cohort_memberships: number;
}

export interface AnalysisDatabaseCounts {
  dataset_snapshots: number;
  analysis_runs: number;
}

function countTable(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
    | { count: number | bigint }
    | undefined;
  return Number(row?.count ?? 0);
}

export function countPriceDatabase(db: DatabaseSync): PriceDatabaseCounts {
  return {
    players: countTable(db, "player"),
    player_cards: countTable(db, "player_card"),
    instruments: countTable(db, "instrument"),
    source_snapshots: countTable(db, "source_snapshot"),
    price_points: countTable(db, "price_point"),
  };
}

export function countMetadataUsageDatabase(
  db: DatabaseSync,
): MetadataUsageDatabaseCounts {
  return {
    metadata_snapshots: countTable(db, "metadata_snapshot"),
    metadata_snapshot_sources: countTable(db, "metadata_snapshot_source"),
    usage_points: countTable(db, "usage_point"),
  };
}

export function countMarketAnnotationDatabase(
  db: DatabaseSync,
): MarketAnnotationDatabaseCounts {
  return {
    events: countTable(db, "event"),
    products: countTable(db, "product"),
    rewards: countTable(db, "reward"),
    exposures: countTable(db, "exposure"),
  };
}

export function countMarketStructureDatabase(
  db: DatabaseSync,
): MarketStructureDatabaseCounts {
  return {
    card_relations: countTable(db, "card_relation"),
    relation_snapshots: countTable(db, "relation_snapshot"),
    cohort_definitions: countTable(db, "cohort_definition"),
    cohort_memberships: countTable(db, "cohort_membership"),
  };
}

export function countAnalysisDatabase(
  db: DatabaseSync,
): AnalysisDatabaseCounts {
  return {
    dataset_snapshots: countTable(db, "dataset_snapshot"),
    analysis_runs: countTable(db, "analysis_run"),
  };
}
