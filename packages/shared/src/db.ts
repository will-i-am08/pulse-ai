import pg from "pg";

// Return timestamp/timestamptz as raw strings (our row types use string), not JS Date.
pg.types.setTypeParser(1114, (v: string) => v); // timestamp
pg.types.setTypeParser(1184, (v: string) => v); // timestamptz

// Single pg pool per process, talking to Neon Postgres over DATABASE_URL.
// Used server-side only (worker + webhook routes + dashboard server code).
let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for the database pool");
  pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Neon requires TLS; its cert chain is public
    max: 3,
    idleTimeoutMillis: 120000,
    connectionTimeoutMillis: 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5000,
    // Neon-specific: use pgbouncer-compatible settings
    application_name: "pulse-ai",
  });
  pool.on("error", (err) => {
    console.error("[db] idle pool client error (recovering):", err instanceof Error ? err.message : err);
  });
  return pool;
}

/** Run a query, return all rows. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await db().query(text, params as unknown[]);
  return res.rows as T[];
}

/** Run a query, return the first row or null. */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * A query runner scoped to a single connection — same shape as the pool-level
 * `query`/`queryOne`, so helpers can accept either the pool or a transaction.
 */
export interface Executor {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null>;
}

/** The pool itself, presented as an Executor (the default for helpers). */
export const poolExecutor: Executor = { query, queryOne };

/**
 * Run `fn` inside a single transaction on one pooled connection. Commits if it
 * resolves, rolls back if it throws (then re-throws). All statements must go
 * through the passed-in `tx` — queries on the module-level pool run on other
 * connections and are NOT part of the transaction.
 */
export async function withTransaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
  const client = await db().connect();
  const tx: Executor = {
    async query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
      const res = await client.query(text, params as unknown[]);
      return res.rows as R[];
    },
    async queryOne<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R | null> {
      const rows = await tx.query<R>(text, params);
      return rows[0] ?? null;
    },
  };
  try {
    await client.query("begin");
    const out = await fn(tx);
    await client.query("commit");
    return out;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // The connection may already be broken; the pool will discard it on release.
    }
    throw err;
  } finally {
    client.release();
  }
}
