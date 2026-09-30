import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const PRICE_HISTORY_SCHEMA_VERSION = 1;

export interface OpenMarketDatabaseOptions {
  migrationPath?: string;
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

  const applied = db
    .prepare("SELECT 1 AS applied FROM schema_migration WHERE version = ?")
    .get(PRICE_HISTORY_SCHEMA_VERSION);
  if (applied) {
    return db;
  }

  const migrationPath =
    options.migrationPath ?? "db/migrations/001_price_history.sql";
  const migrationSql = readFileSync(migrationPath, "utf8");

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(migrationSql);
    db.prepare(
      "INSERT INTO schema_migration(version, applied_at) VALUES (?, ?)",
    ).run(PRICE_HISTORY_SCHEMA_VERSION, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
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
