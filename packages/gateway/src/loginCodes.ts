import { query, decrypt, type LoginCode } from "@pulse/shared";
import { sendToBrand } from "./gateway.js";

/**
 * Deliver pending passwordless-login codes through the agent channel.
 *
 * The dashboard writes an encrypted, undelivered `login_codes` row when a user
 * asks for a code; the agent process (the one that actually holds the channel —
 * the Discord bot, or the worker for SMS/Linq) calls this to decrypt and send
 * it into the user's own thread. Best-effort: a send failure leaves the row
 * undelivered so the next tick retries, until it expires.
 */
export async function deliverPendingLoginCodes(now: () => Date = () => new Date()): Promise<number> {
  const rows = await query<LoginCode>(
    `select * from login_codes
      where delivered_at is null
        and consumed_at is null
        and expires_at > now()
        and brand_id is not null
      order by created_at asc
      limit 20`,
  );
  let sent = 0;
  for (const row of rows) {
    if (!row.brand_id) continue;
    let code: string;
    try {
      code = decrypt(row.code_encrypted);
    } catch {
      // Undecryptable (key rotated?) — retire the row so it stops being retried.
      await query(`update login_codes set delivered_at = now() where id = $1`, [row.id]).catch(() => undefined);
      continue;
    }
    const minutes = Math.max(1, Math.round((new Date(row.expires_at).getTime() - now().getTime()) / 60000));
    const body =
      `Your Kip login code is ${code}. ` +
      `Enter it on the dashboard to sign in — it expires in about ${minutes} minute${minutes === 1 ? "" : "s"}. ` +
      `If you didn't try to log in, ignore this.`;
    try {
      await sendToBrand(row.brand_id, body);
      await query(`update login_codes set delivered_at = now() where id = $1`, [row.id]);
      sent += 1;
    } catch {
      // Leave undelivered; a later tick retries until expiry.
    }
  }
  return sent;
}
