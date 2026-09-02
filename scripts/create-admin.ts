// One-off: create/update the operator admin account.
//   ADMIN_PASSWORD=... tsx --env-file=.env scripts/create-admin.ts [email]
import { queryOne, hashPassword } from "@pulse/shared";

const email = (process.argv[2] || "will@jmcalder.com").toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error("Set ADMIN_PASSWORD");
  process.exit(1);
}

async function main(): Promise<void> {
  const row = await queryOne<{ id: string; email: string }>(
    `insert into users (email, password_hash, name, is_admin)
     values ($1, $2, $3, true)
     on conflict (email) do update set password_hash = excluded.password_hash, is_admin = true
     returning id, email`,
    [email, hashPassword(password!), "Will"],
  );
  console.log(`admin ready: ${row?.email}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
