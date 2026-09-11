import { createHmac } from "node:crypto";
import { queryOne } from "@pulse/shared";

async function main(): Promise<void> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET missing");

  const user = await queryOne<{ id: string; email: string }>(
    "select id, email from users where is_admin = true limit 1",
  );
  if (!user) throw new Error("no admin user");

  const sig = createHmac("sha256", secret).update(user.id).digest("hex");
  console.log(`SESSION=${user.id}.${sig}`);
  console.log(`EMAIL=${user.email}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
