// Apply db/migrations/*.sql to the Neon database in DATABASE_URL, in order.
// Idempotent (migrations use IF NOT EXISTS / OR REPLACE).
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
    for (const f of files) {
      process.stdout.write(`applying ${f} … `);
      await client.query(readFileSync(join(dir, f), "utf8"));
      console.log("ok");
    }
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
