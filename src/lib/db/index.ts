import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

export type DB = Database.Database;

const globalForDb = globalThis as unknown as { __rhiDb?: DB };

export function defaultDbPath(): string {
  return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "rhi.db");
}

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: DB): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const applied = new Set(db.prepare("SELECT id FROM schema_migrations").all().map((r) => (r as { id: number }).id));
  const ran: number[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, Date.now());
    })();
    ran.push(m.id);
  }
  return ran;
}

/** Process-wide connection (survives Next.js dev hot reloads). */
export function getDb(): DB {
  if (!globalForDb.__rhiDb) globalForDb.__rhiDb = openDb(defaultDbPath());
  return globalForDb.__rhiDb;
}

/** Tests swap in an in-memory database. */
export function setDbForTesting(db: DB | undefined) {
  globalForDb.__rhiDb = db;
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
