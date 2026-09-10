// One-off: create/update the operator admin account.
//   ADMIN_PASSWORD=... ADMIN_PHONE=+61... tsx --env-file=.env scripts/create-admin.ts [email]
// The password is the dashboard break-glass; the phone is for normal OTP login.
import { queryOne, hashPassword, normalizePhone } from "@pulse/shared";

const email = (process.argv[2] || "will@jmcalder.com").toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const phone = process.env.ADMIN_PHONE ? normalizePhone(process.env.ADMIN_PHONE) : null;
if (!password) {
  console.error("Set ADMIN_PASSWORD");
  process.exit(1);
}
if (process.env.ADMIN_PHONE && !phone) {
  console.error(`ADMIN_PHONE "${process.env.ADMIN_PHONE}" is not a valid number`);
  process.exit(1);
}

async function main(): Promise<void> {
  const row = await queryOne<{ id: string; email: string }>(
    `insert into users (email, password_hash, name, is_admin, phone)
     values ($1, $2, $3, true, $4)
     on conflict (email) do update
        set password_hash = excluded.password_hash,
            is_admin = true,
            phone = coalesce(excluded.phone, users.phone)
     returning id, email`,
    [email, hashPassword(password!), "Will", phone],
  );
  console.log(`admin ready: ${row?.email}${phone ? ` (phone ${phone})` : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
