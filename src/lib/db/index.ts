/**
 * Database access. Two backends behind one async interface:
 *  - Postgres (Netlify Database) when deployed — NETLIFY_DB_URL is set by the platform.
 *  - SQLite (better-sqlite3) for local development and tests (DATABASE_PATH, default ./data/rhi.db).
 * SQL is written once with `?` (positional) or `@name` (named) placeholders and rewritten for Postgres.
 * Transactions propagate through AsyncLocalStorage: repo functions calling getDb() inside
 * `transaction()` automatically join it.
 */
import path from "node:path";
import { Db, OpenedDb, txStore } from "./core";
import { openPostgres } from "./postgres";
import { openSqlite } from "./sqlite";

export type { Db, Params, Row } from "./core";

const globalForDb = globalThis as unknown as { __rhiDb?: Promise<Db> };

export function defaultDbPath(): string {
  return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "rhi.db");
}

function postgresUrl(): string | null {
  return process.env.NETLIFY_DB_URL || null;
}

/** Opens a database and applies pending migrations. `file` selects SQLite; omit it to auto-detect. */
export async function openDb(file?: string): Promise<OpenedDb> {
  const url = file === undefined ? postgresUrl() : null;
  const db = url ? await openPostgres() : openSqlite(file ?? defaultDbPath());
  await db.migrate();
  return db;
}

/** Process-wide connection (survives Next.js dev hot reloads); the active transaction when inside one. */
export async function getDb(): Promise<Db> {
  const tx = txStore.getStore();
  if (tx) return tx;
  if (!globalForDb.__rhiDb) {
    globalForDb.__rhiDb = openDb().catch((err) => {
      globalForDb.__rhiDb = undefined;
      throw err;
    });
  }
  return globalForDb.__rhiDb;
}

/** Runs `fn` atomically; nested calls join the outer transaction. */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn();
  return (await getDb()).transaction(fn);
}

/** Tests swap in an in-memory database. */
export function setDbForTesting(db: Db | undefined) {
  globalForDb.__rhiDb = db ? Promise.resolve(db) : undefined;
}

export const json = {
  parse<T>(value: unknown, fallback: T): T {
    if (typeof value !== "string" || value === "") return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  },
  str(value: unknown): string | null {
    return value === null || value === undefined ? null : JSON.stringify(value);
  },
};
