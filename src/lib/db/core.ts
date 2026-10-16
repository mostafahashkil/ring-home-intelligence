import { AsyncLocalStorage } from "node:async_hooks";

export type Row = Record<string, unknown>;
export type Params = unknown[] | Record<string, unknown>;

export interface Db {
  readonly dialect: "sqlite" | "postgres";
  all<T = Row>(sql: string, params?: Params): Promise<T[]>;
  get<T = Row>(sql: string, params?: Params): Promise<T | undefined>;
  run(sql: string, params?: Params): Promise<{ changes: number }>;
  /** Runs one or more statements without parameters. */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface OpenedDb extends Db {
  /** Applies pending migrations; returns the ids that ran. */
  migrate(): Promise<number[]>;
}

/** The transaction-scoped Db for the current async context, if any. */
export const txStore = new AsyncLocalStorage<Db>();
