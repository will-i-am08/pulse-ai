import {
  query,
  queryOne,
  encrypt,
  decrypt,
  type Brand,
  type Interaction,
} from "@pulse/shared";
import { brandFeatures, setBrandFeatures } from "./adsFeatures.js";
import {
  buildLeadCard,
  formatLeadCardSms,
  type LeadCard,
  type LeadCardInput,
} from "./leadCard.js";

export type CrmPushTrigger = "auto_lead" | "owner_sms" | "email_fallback";
export type CrmPushStatus = "success" | "failure" | "skipped";

export type CrmPushResult = {
  ok: boolean;
  status: CrmPushStatus;
  httpStatus?: number;
  error?: string;
  card: LeadCard;
  emailed?: boolean;
};

const HTTPS_URL_RE = /^https:\/\/[^\s]+$/i;

/** Validate a catch-hook URL (https only). */
export function isValidCrmWebhookUrl(url: string): boolean {
  if (!HTTPS_URL_RE.test(url.trim())) return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Decrypt the stored CRM webhook URL, or null if unset/unreadable. */
export function getCrmWebhookUrl(brand: Brand): string | null {
  const raw = (brand as Brand & { crm_webhook_url?: string | null }).crm_webhook_url;
  if (!raw) return null;
  try {
    // Prefer encrypted; fall back to plain https for local/dev rows.
    if (raw.startsWith("https://")) return raw;
    return decrypt(raw);
  } catch {
    return null;
  }
}

/** Persist CRM webhook URL (encrypted) and enable the feature toggle. */
export async function setCrmWebhookUrl(brandId: string, url: string): Promise<void> {
  const trimmed = url.trim();
  if (!isValidCrmWebhookUrl(trimmed)) {
    throw new Error("CRM webhook must be an https:// URL");
  }
  const enc = encrypt(trimmed);
  await query(`update brands set crm_webhook_url = $1 where id = $2`, [enc, brandId]);
  await setBrandFeatures(brandId, { crm_webhook: true });
}

/** Clear CRM webhook URL and disable the feature. */
export async function clearCrmWebhookUrl(brandId: string): Promise<void> {
  await query(`update brands set crm_webhook_url = null where id = $1`, [brandId]);
  await setBrandFeatures(brandId, { crm_webhook: false });
}

async function writeCrmPushLog(input: {
  brandId: string;
  interactionId?: string | null;
  trigger: CrmPushTrigger;
  status: CrmPushStatus;
  httpStatus?: number | null;
  error?: string | null;
  payload: LeadCard;
}): Promise<void> {
  await query(
    `insert into crm_push_log (brand_id, interaction_id, trigger, status, http_status, error, payload)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.brandId,
      input.interactionId ?? null,
      input.trigger,
      input.status,
      input.httpStatus ?? null,
      input.error ?? null,
      JSON.stringify(input.payload),
    ],
  );
}

/** Optional email fallback when EMAIL_FROM is configured (Resend if key present). */
export async function sendLeadEmailFallback(opts: {
  brand: Brand;
  card: LeadCard;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; error?: string }> {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) return { ok: false, error: "EMAIL_FROM not configured" };

  let to = process.env.EMAIL_TO?.trim() ?? null;
  if (!to && opts.brand.owner_user_id) {
    const user = await queryOne<{ email: string | null }>(
      `select email from users where id = $1`,
      [opts.brand.owner_user_id],
    );
    to = user?.email?.trim() || null;
  }
  if (!to) return { ok: false, error: "no owner email for fallback" };

  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return { ok: false, error: "EMAIL_FROM set but RESEND_API_KEY missing" };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Kip lead: ${opts.card.handle ?? "new lead"} on ${opts.card.platform}`,
        text: formatLeadCardSms(opts.card),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `email HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type PushLeadOptions = {
  brand: Brand;
  interaction: Interaction;
  trigger: CrmPushTrigger;
  /** Override card fields (summary/intent/etc.). */
  cardOverrides?: Partial<Omit<LeadCardInput, "interaction" | "brandId">>;
  /** When true, skip the features.crm_webhook gate (owner explicit "send to CRM"). */
  force?: boolean;
  /** When webhook unset/fails, try EMAIL_FROM fallback. */
  emailFallback?: boolean;
  fetchImpl?: typeof fetch;
};

/**
 * POST the stable lead-card JSON to the brand's CRM catch-hook.
 * Respects features.crm_webhook unless `force` (owner SMS command).
 */
export async function pushLeadToCrm(opts: PushLeadOptions): Promise<CrmPushResult> {
  const features = brandFeatures(opts.brand);
  const card = buildLeadCard({
    interaction: opts.interaction,
    brandId: opts.brand.id,
    brandName: opts.brand.name,
    ...opts.cardOverrides,
  });

  if (!opts.force && !features.crm_webhook) {
    await writeCrmPushLog({
      brandId: opts.brand.id,
      interactionId: opts.interaction.id,
      trigger: opts.trigger,
      status: "skipped",
      error: "crm_webhook feature off",
      payload: card,
    });
    return { ok: false, status: "skipped", error: "CRM webhook is off for this brand", card };
  }

  const url = getCrmWebhookUrl(opts.brand);
  const fetchFn = opts.fetchImpl ?? fetch;

  if (url) {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Kip-CRM-Webhook/1" },
        body: JSON.stringify(card),
      });
      if (res.ok) {
        await writeCrmPushLog({
          brandId: opts.brand.id,
          interactionId: opts.interaction.id,
          trigger: opts.trigger,
          status: "success",
          httpStatus: res.status,
          payload: card,
        });
        return { ok: true, status: "success", httpStatus: res.status, card };
      }
      const errText = `HTTP ${res.status}`;
      await writeCrmPushLog({
        brandId: opts.brand.id,
        interactionId: opts.interaction.id,
        trigger: opts.trigger,
        status: "failure",
        httpStatus: res.status,
        error: errText,
        payload: card,
      });

      if (opts.emailFallback !== false && process.env.EMAIL_FROM) {
        const emailed = await sendLeadEmailFallback({
          brand: opts.brand,
          card,
          fetchImpl: fetchFn,
        });
        await writeCrmPushLog({
          brandId: opts.brand.id,
          interactionId: opts.interaction.id,
          trigger: "email_fallback",
          status: emailed.ok ? "success" : "failure",
          error: emailed.error ?? null,
          payload: card,
        });
        if (emailed.ok) {
          return {
            ok: true,
            status: "success",
            httpStatus: res.status,
            error: `webhook failed (${errText}); emailed instead`,
            card,
            emailed: true,
          };
        }
      }
      return { ok: false, status: "failure", httpStatus: res.status, error: errText, card };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await writeCrmPushLog({
        brandId: opts.brand.id,
        interactionId: opts.interaction.id,
        trigger: opts.trigger,
        status: "failure",
        error: message,
        payload: card,
      });

      if (opts.emailFallback !== false && process.env.EMAIL_FROM) {
        const emailed = await sendLeadEmailFallback({
          brand: opts.brand,
          card,
          fetchImpl: fetchFn,
        });
        await writeCrmPushLog({
          brandId: opts.brand.id,
          interactionId: opts.interaction.id,
          trigger: "email_fallback",
          status: emailed.ok ? "success" : "failure",
          error: emailed.error ?? null,
          payload: card,
        });
        if (emailed.ok) {
          return { ok: true, status: "success", error: `webhook error; emailed instead`, card, emailed: true };
        }
      }
      return { ok: false, status: "failure", error: message, card };
    }
  }

  // No webhook — optional email fallback.
  if (opts.emailFallback !== false && process.env.EMAIL_FROM) {
    const emailed = await sendLeadEmailFallback({
      brand: opts.brand,
      card,
      fetchImpl: fetchFn,
    });
    await writeCrmPushLog({
      brandId: opts.brand.id,
      interactionId: opts.interaction.id,
      trigger: "email_fallback",
      status: emailed.ok ? "success" : "failure",
      error: emailed.error ?? (emailed.ok ? null : "email failed"),
      payload: card,
    });
    if (emailed.ok) {
      return { ok: true, status: "success", card, emailed: true };
    }
    return { ok: false, status: "failure", error: emailed.error ?? "email fallback failed", card };
  }

  await writeCrmPushLog({
    brandId: opts.brand.id,
    interactionId: opts.interaction.id,
    trigger: opts.trigger,
    status: "skipped",
    error: "no CRM webhook URL",
    payload: card,
  });
  return {
    ok: false,
    status: "skipped",
    error: 'No CRM webhook set. Reply "set crm webhook https://…" or ask for a CRM settings link.',
    card,
  };
}

/** Latest escalated lead interaction for owner SMS verbs. */
export async function latestEscalatedLead(brandId: string): Promise<Interaction | null> {
  return queryOne<Interaction>(
    `select * from interactions
      where brand_id = $1 and status = 'escalated' and bucket = 'lead'
      order by created_at desc limit 1`,
    [brandId],
  );
}

/** Latest interaction the owner might act on (drafted or escalated). */
export async function latestActionableInteraction(brandId: string): Promise<Interaction | null> {
  return queryOne<Interaction>(
    `select * from interactions
      where brand_id = $1 and status in ('drafted', 'escalated')
      order by created_at desc limit 1`,
    [brandId],
  );
}
