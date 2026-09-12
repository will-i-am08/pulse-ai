import { query, queryOne, decrypt, getServerEnv, type LoginCode } from "@pulse/shared";
import { createTwilioChannel } from "@pulse/channel-twilio";

export type DeliverLoginCodesOptions = {
  /** Only attempt codes for this E.164 phone (login/signup flush). */
  phone?: string;
  now?: () => Date;
};

/** Validity window that starts when the SMS is actually sent (not when queued). */
export const LOGIN_CODE_TTL_MINUTES = 15;

/**
 * Resolve which brand should receive a login code for this phone.
 * Prefer an explicit brand_id on the row; otherwise look up by client_phone
 * (covers accounts where signup created the user but brand ownership drifted,
 * or where the brand predates the phone-auth user).
 */
async function resolveBrandId(row: LoginCode): Promise<string | null> {
  if (row.brand_id) return row.brand_id;
  const brand = await queryOne<{ id: string }>(
    `select id from brands where client_phone = $1 order by created_at asc limit 1`,
    [row.phone],
  );
  if (brand) {
    // Backfill so the next tick (and the dashboard) don't keep rediscovering.
    await query(`update login_codes set brand_id = $1 where id = $2 and brand_id is null`, [
      brand.id,
      row.id,
    ]).catch(() => undefined);
    return brand.id;
  }
  return null;
}

/** True when we can SMS a login code without depending on MESSAGE_CHANNEL. */
function twilioSmsReady(): boolean {
  try {
    const env = getServerEnv();
    const hasCreds = Boolean(
      env.TWILIO_AUTH_TOKEN || (env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET),
    );
    return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_FROM_NUMBER && hasCreds);
  } catch {
    return false;
  }
}

/** Agent-thread fallback is only useful when MESSAGE_CHANNEL is Linq (not Twilio SMS). */
function agentFallbackAvailable(): boolean {
  try {
    return getServerEnv().MESSAGE_CHANNEL === "linq";
  } catch {
    return false;
  }
}

/**
 * Deliver via Linq agent thread. Lazy-imported so the login serverless
 * path does not pull @pulse/orchestrator (satori/harfbuzz) into the bundle when
 * Twilio SMS is the delivery path.
 */
async function deliverViaAgentChannel(brandId: string, body: string): Promise<boolean> {
  const { sendToBrand } = await import("./gateway.js");
  // OTP is not a chat bubble — skip typing pauses.
  return sendToBrand(brandId, body, undefined, { pace: false });
}

/**
 * Deliver one login-code body. Prefer Twilio SMS to the login phone (matches the
 * dashboard "we'll text you a code" copy). Fall back to the Linq agent thread
 * only when MESSAGE_CHANNEL=linq — otherwise we just retry the same failing
 * From-number with backoff and stall the login form.
 */
async function deliverCodeBody(row: LoginCode, body: string): Promise<boolean> {
  if (twilioSmsReady()) {
    try {
      const result = await createTwilioChannel().send({ to: row.phone, body });
      const brandId = row.brand_id ?? (await resolveBrandId(row));
      if (brandId) {
        await query(
          `insert into messages (brand_id, direction, channel, body, provider_message_sid)
           values ($1, 'outbound', 'twilio-sms', $2, $3)`,
          [brandId, body, result.providerMessageId],
        ).catch((err) =>
          console.error(
            `deliverPendingLoginCodes: SMS sent but failed to log outbound row`,
            err,
          ),
        );
      }
      return true;
    } catch (err) {
      if (!agentFallbackAvailable()) {
        console.error(
          `deliverPendingLoginCodes: Twilio SMS failed for ${row.phone}; no alternate channel`,
          err,
        );
        return false;
      }
      console.error(
        `deliverPendingLoginCodes: Twilio SMS failed for ${row.phone}; trying agent channel`,
        err,
      );
    }
  }

  if (!agentFallbackAvailable() && !twilioSmsReady()) {
    console.warn(
      `deliverPendingLoginCodes: Twilio SMS not configured and MESSAGE_CHANNEL is twilio; cannot deliver code ${row.id}`,
    );
    return false;
  }

  if (!agentFallbackAvailable()) {
    return false;
  }

  const brandId = await resolveBrandId(row);
  if (!brandId) {
    console.warn(
      `deliverPendingLoginCodes: no brand for phone ${row.phone} (code ${row.id}); cannot deliver`,
    );
    return false;
  }
  return deliverViaAgentChannel(brandId, body);
}

/**
 * Deliver pending passwordless-login codes through SMS (preferred) or the agent channel.
 *
 * The dashboard writes an encrypted, undelivered `login_codes` row when a user
 * asks for a code; the web app may call this immediately after queueing, and the
 * worker also polls as a backup. Best-effort: a
 * send failure leaves the row undelivered so the next tick retries, until it expires.
 */
export async function deliverPendingLoginCodes(
  nowOrOpts: (() => Date) | DeliverLoginCodesOptions = () => new Date(),
): Promise<number> {
  const opts: DeliverLoginCodesOptions =
    typeof nowOrOpts === "function" ? { now: nowOrOpts } : nowOrOpts;
  // `now` is accepted for call-site compatibility / tests; expiry is set in SQL.
  void (opts.now ?? (() => new Date()));

  // Newest first, one pending code per phone — older queued rows are superseded
  // so a late SMS for a stale attempt can't outrace the code the user just asked for.
  const rows = opts.phone
    ? await query<LoginCode>(
        `select * from login_codes
          where delivered_at is null
            and consumed_at is null
            and expires_at > now()
            and phone = $1
          order by created_at desc
          limit 1`,
        [opts.phone],
      )
    : await query<LoginCode>(
        `select distinct on (phone) *
           from login_codes
          where delivered_at is null
            and consumed_at is null
            and expires_at > now()
          order by phone, created_at desc
          limit 20`,
      );
  let sent = 0;
  for (const row of rows) {
    let code: string;
    try {
      code = decrypt(row.code_encrypted);
    } catch {
      // Undecryptable (key rotated?) — retire the row so it stops being retried.
      await query(`update login_codes set delivered_at = now() where id = $1`, [row.id]).catch(() => undefined);
      continue;
    }
    const body =
      row.purpose === 'operator_unlock'
        ? `Kip operator unlock code: ${code}. ` +
          `An operator needs this to edit your account details. ` +
          `It expires in about ${LOGIN_CODE_TTL_MINUTES} minutes. ` +
          `If you weren't expecting this, ignore it and contact support.`
        : `Your Kip login code is ${code}. ` +
          `Enter it on the dashboard to sign in — it expires in about ${LOGIN_CODE_TTL_MINUTES} minutes. ` +
          `If you didn't try to log in, ignore this.`;
    try {
      const ok = await deliverCodeBody(row, body);
      if (!ok) continue;
      // Start the validity clock at send time (not queue time) so a slow SMS
      // path doesn't burn the TTL before the user ever sees the text.
      await query(
        `update login_codes
            set delivered_at = now(),
                expires_at = now() + ($2 || ' minutes')::interval
          where id = $1`,
        [row.id, String(LOGIN_CODE_TTL_MINUTES)],
      );
      // Drop any older undelivered siblings for this phone.
      await query(
        `update login_codes
            set expires_at = least(expires_at, now())
          where phone = $1
            and id <> $2
            and consumed_at is null
            and delivered_at is null
            and expires_at > now()`,
        [row.phone, row.id],
      ).catch(() => undefined);
      sent += 1;
    } catch {
      // Leave undelivered; a later tick retries until expiry.
    }
  }
  return sent;
}
