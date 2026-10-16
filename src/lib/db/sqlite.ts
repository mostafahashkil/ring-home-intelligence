import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { Db, OpenedDb, Params, txStore } from "./core";
import { MIGRATIONS } from "./migrations";

const bind = (params: Params | undefined) => (params === undefined ? [] : Array.isArray(params) ? params : [params]);

/** better-sqlite3 behind the async Db interface (local development and tests). */
export function openSqlite(file: string): OpenedDb {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("busy_timeout = 5000");

  // One connection: serialize transactions so concurrent requests can't interleave inside one.
  let txQueue: Promise<unknown> = Promise.resolve();

  const db: OpenedDb = {
    dialect: "sqlite",
    async all<T>(sql: string, params?: Params) {
      return conn.prepare(sql).all(...bind(params)) as T[];
    },
    async get<T>(sql: string, params?: Params) {
      return conn.prepare(sql).get(...bind(params)) as T | undefined;
    },
    async run(sql: string, params?: Params) {
      return { changes: conn.prepare(sql).run(...bind(params)).changes };
    },
    async exec(sql: string) {
      conn.exec(sql);
    },
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      const result = txQueue.then(() =>
        txStore.run(db, async () => {
          conn.exec("BEGIN IMMEDIATE");
          try {
            const value = await fn();
            conn.exec("COMMIT");
            return value;
          } catch (err) {
            if (conn.inTransaction) conn.exec("ROLLBACK");
            throw err;
          }
        }),
      );
      txQueue = result.catch(() => undefined);
      return result;
    },
    async close() {
      conn.close();
    },
    async migrate() {
      conn.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
      const applied = new Set(conn.prepare("SELECT id FROM schema_migrations").all().map((r) => (r as { id: number }).id));
      const ran: number[] = [];
      for (const m of MIGRATIONS) {
        if (applied.has(m.id)) continue;
        conn.transaction(() => {
          conn.exec(m.sqlite);
          conn.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, Date.now());
        })();
        ran.push(m.id);
      }
      return ran;
    },
  };
  return db satisfies Db;
}
