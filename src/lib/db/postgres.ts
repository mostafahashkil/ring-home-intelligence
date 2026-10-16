import { Db, OpenedDb, Params, Row, txStore } from "./core";
import { MIGRATIONS } from "./migrations";

/** Minimal surface shared by pg.Pool and the Neon serverless Pool. */
interface QueryResult {
  rows: Row[];
  rowCount: number | null;
  fields: { name: string; dataTypeID: number }[];
}
interface Queryable {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}
interface PoolLike extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
  end(): Promise<void>;
}

const INT8 = 20;
const NUMERIC = 1700;
/** Arbitrary constant key for the migration advisory lock. */
const MIGRATION_LOCK = 72_741_001;

/** Rewrites `?` / `@name` placeholders to Postgres `$n`. Our SQL never uses those characters in literals. */
export function toPostgres(sql: string, params: Params | undefined): { text: string; values: unknown[] } {
  if (params === undefined) return { text: sql, values: [] };
  if (Array.isArray(params)) {
    let i = 0;
    return { text: sql.replace(/\?/g, () => `$${++i}`), values: params.map((v) => v ?? null) };
  }
  const values: unknown[] = [];
  const index = new Map<string, number>();
  const text = sql.replace(/@([A-Za-z_]\w*)/g, (_m, name: string) => {
    if (!index.has(name)) {
      values.push(params[name] ?? null);
      index.set(name, values.length);
    }
    return `$${index.get(name)}`;
  });
  return { text, values };
}

/** BIGINT (timestamps in ms, COUNT) and NUMERIC arrive as strings; the app expects numbers. */
function normalize(result: QueryResult): Row[] {
  const numeric = result.fields.filter((f) => f.dataTypeID === INT8 || f.dataTypeID === NUMERIC).map((f) => f.name);
  if (numeric.length === 0) return result.rows;
  for (const row of result.rows) {
    for (const name of numeric) if (row[name] !== null && row[name] !== undefined) row[name] = Number(row[name]);
  }
  return result.rows;
}

function wrap(q: Queryable, transaction: Db["transaction"], close: Db["close"]): Db {
  const query = async (sql: string, params?: Params) => {
    const { text, values } = toPostgres(sql, params);
    return q.query(text, values);
  };
  return {
    dialect: "postgres",
    async all<T>(sql: string, params?: Params) {
      return normalize(await query(sql, params)) as T[];
    },
    async get<T>(sql: string, params?: Params) {
      return normalize(await query(sql, params))[0] as T | undefined;
    },
    async run(sql: string, params?: Params) {
      return { changes: (await query(sql, params)).rowCount ?? 0 };
    },
    async exec(sql: string) {
      await q.query(sql);
    },
    transaction,
    close,
  };
}

/** Netlify Database (managed Postgres). Connection details come from the platform environment. */
export async function openPostgres(): Promise<OpenedDb> {
  const { getDatabase } = await import("@netlify/database");
  const pool = getDatabase().pool as unknown as PoolLike;

  async function withClient<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  const nested = async <T>(fn: () => Promise<T>) => fn();
  const noClose = async () => undefined;

  const db = wrap(
    pool,
    (fn) => withClient((client) => txStore.run(wrap(client, nested, noClose), fn)),
    () => pool.end(),
  );

  return {
    ...db,
    async migrate() {
      return withClient(async (client) => {
        // Several function instances may cold-start at once; only one applies migrations.
        await client.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`);
        await client.query(
          "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL)",
        );
        const applied = new Set((await client.query("SELECT id FROM schema_migrations")).rows.map((r) => r.id as number));
        const ran: number[] = [];
        for (const m of MIGRATIONS) {
          if (applied.has(m.id)) continue;
          await client.query(m.postgres);
          await client.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES ($1, $2, $3)", [m.id, m.name, Date.now()]);
          ran.push(m.id);
        }
        return ran;
      });
    },
  };
}
