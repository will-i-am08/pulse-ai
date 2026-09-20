// Apply db/migrations/*.sql to the Neon database in DATABASE_URL, in order.
// Tracks applied files in `schema_migrations` so historical ALTER/CHECK
// migrations are not re-run against a newer schema (re-applying 0011 used to
// fail once LinkedIn/TikTok rows existed).
//   pnpm migrate     (tsx --env-file=.env scripts/migrate.ts)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const dir = join(process.cwd(), "db/migrations");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}

async function main(): Promise<void> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows: existing } = await client.query<{ id: string }>(
      `select id from schema_migrations`,
    );
    const applied = new Set(existing.map((r) => r.id));

    // First run against an already-migrated prod DB: baseline every file that
    // is already on disk so we don't re-play superseded CHECKs (e.g. 0011).
    if (applied.size === 0) {
      const { rows: branded } = await client.query<{ n: string }>(
        `select count(*)::text as n from information_schema.tables
          where table_schema = 'public' and table_name = 'brands'`,
      );
      if (Number(branded[0]?.n ?? 0) > 0) {
        console.log(
          `schema_migrations empty but brands exists — baselining ${files.length} existing migration(s)`,
        );
        for (const f of files) {
          await client.query(`insert into schema_migrations (id) values ($1) on conflict do nothing`, [
            f,
          ]);
          applied.add(f);
        }
      }
    }

    let ran = 0;
    for (const f of files) {
      if (applied.has(f)) continue;
      process.stdout.write(`applying ${f} … `);
      await client.query("begin");
      try {
        await client.query(readFileSync(join(dir, f), "utf8"));
        await client.query(`insert into schema_migrations (id) values ($1)`, [f]);
        await client.query("commit");
        console.log("ok");
        ran += 1;
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }

    if (ran === 0) console.log("no new migrations");

    const { rows } = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    console.log(`\ntables (${rows.length}): ${rows.map((r) => r.table_name).join(", ")}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("migrate failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
