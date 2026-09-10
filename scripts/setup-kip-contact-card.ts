/**
 * One-time (or idempotent) setup for Kip's Linq iMessage contact card.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/setup-kip-contact-card.ts
 *
 * Requires MESSAGE_CHANNEL-related Linq env: LINQ_API_KEY, LINQ_FROM_NUMBER,
 * APP_BASE_URL (so the logo URL resolves), and optionally KIP_CONTACT_*.
 */
import { createLinqChannel } from "@pulse/gateway";
import { kipContactIdentity } from "@pulse/shared";

async function main(): Promise<void> {
  const identity = kipContactIdentity();
  console.log("Configuring Kip contact card…");
  console.log(`  name:  ${identity.firstName}`);
  console.log(`  phone: ${process.env.LINQ_FROM_NUMBER ?? identity.phone ?? "(unset)"}`);
  console.log(`  image: ${identity.imageUrl}`);

  const channel = createLinqChannel();
  const ok = await channel.ensureContactCard();
  if (!ok) {
    console.error("Contact card is not active yet. Check LINQ_FROM_NUMBER / Linq dashboard and retry.");
    process.exitCode = 1;
    return;
  }
  console.log("Contact card is active. It will be shared into each iMessage chat after the first outbound.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
