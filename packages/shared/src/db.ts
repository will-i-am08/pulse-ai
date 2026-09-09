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
