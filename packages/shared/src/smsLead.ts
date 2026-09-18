import { appBaseUrl } from "./env.js";
import { poolExecutor, type Executor } from "./db.js";

/** Prefill the native Messages composer with this, plus an optional campaign slug. */
export const SMS_LEAD_PREFILL = "Hi Kip";

/** One full welcome SMS per unknown number inside this window. */
export const SMS_LEAD_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const SOURCE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RESERVED_SOURCES = new Set(["qr"]);

const OPT_OUT_RE = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i;
const HELP_RE = /^(help|info)$/i;

export type UnknownInboundKind = "lead" | "help" | "opt_out";

export type SmsLeadAcquisition = {
  channel: "sms";
  source?: string;
  captured_at: string;
};

/** Campaign slug from a QR path or inbound body. Null if missing or unsafe. */
export function normalizeSmsLeadSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || RESERVED_SOURCES.has(s) || !SOURCE_RE.test(s)) return null;
  return s;
}

/** Body the QR / Text Kip button drops into Messages. */
export function smsLeadPrefillBody(source?: string | null): string {
  const src = normalizeSmsLeadSource(source);
  return src ? `${SMS_LEAD_PREFILL} ${src}` : SMS_LEAD_PREFILL;
}

/**
 * Cross-platform `sms:` URI. `?&body=` is the form that fills the composer on
 * both iOS (`&body=`) and Android (`?body=`).
 */
export function smsComposeHref(phone: string, body: string): string {
  const to = phone.trim();
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

/** True when this looks like a phone (not a desktop browser). */
export function isMobileUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  if (/windows phone/i.test(ua)) return true;
  if (/iPhone|iPod|iPad/i.test(ua)) return true;
  if (/Android/i.test(ua)) return true;
  return false;
}

export function classifyUnknownInbound(body: string): UnknownInboundKind {
  const trimmed = body.trim();
  if (!trimmed) return "lead";
  if (OPT_OUT_RE.test(trimmed)) return "opt_out";
  if (HELP_RE.test(trimmed)) return "help";
  return "lead";
}

/** Pull a campaign slug from a prefilled "Hi Kip {src}" (or a bare slug). */
export function parseSmsLeadSource(body: string): string | null {
  const trimmed = body.trim();
  const hi = trimmed.match(/^hi\s+kip(?:\s+([a-z0-9][a-z0-9-]{0,31}))?$/i);
  if (hi) return normalizeSmsLeadSource(hi[1] ?? null);
  return normalizeSmsLeadSource(trimmed);
}

/** AU/NZ E.164 → trunk form for the signup field (0412…). */
export function toLocalPhoneInput(e164: string): string | null {
  if (e164.startsWith("+61") && e164.length >= 11) return `0${e164.slice(3)}`;
  if (e164.startsWith("+64") && e164.length >= 11) return `0${e164.slice(3)}`;
  return null;
}

/** Human-readable Kip line for fallback copy on /hi. */
export function formatE164ForDisplay(e164: string): string {
  if (e164.startsWith("+61") && e164.length === 12) {
    const rest = e164.slice(3);
    return `+61 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
  }
  return e164;
}

export function phoneForSignupQuery(e164: string): string {
  return toLocalPhoneInput(e164) ?? e164;
}

export function smsLeadSignupPath(phone: string, source?: string | null): string {
  const params = new URLSearchParams();
  params.set("from", "sms");
  params.set("phone", phoneForSignupQuery(phone));
  const src = normalizeSmsLeadSource(source);
  if (src) params.set("src", src);
  return `/signup?${params.toString()}`;
}

export function smsLeadSignupUrl(phone: string, source?: string | null): string {
  return `${appBaseUrl()}${smsLeadSignupPath(phone, source)}`;
}

export function smsLeadWelcomeMessage(phone: string, source?: string | null): string {
  const url = smsLeadSignupUrl(phone, source);
  return (
    `Hey, I'm Kip. I run your social from this chat.\n\n` +
    `Text me a photo, I write the caption in your voice, you say yes, and it posts to Instagram, Facebook, X and Threads. ` +
    `Nothing goes out without your yes.\n\n` +
    `Set up here (takes a couple of minutes):\n${url}`
  );
}

export function smsLeadRepeatMessage(phone: string, source?: string | null): string {
  return `Here's the link again:\n${smsLeadSignupUrl(phone, source)}`;
}

export function smsLeadHelpMessage(): string {
  return `Kip is an AI social manager. Sign up at ${appBaseUrl()}/signup Reply STOP to opt out.`;
}

export function repliedWithinCooldown(lastRepliedAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastRepliedAt) return false;
  const at = Date.parse(lastRepliedAt);
  if (Number.isNaN(at)) return false;
  return now - at < SMS_LEAD_REPLY_COOLDOWN_MS;
}

export function mergeSignupAcquisition(
  facts: Record<string, unknown>,
  opts: { from?: string | null; src?: string | null; now?: Date },
): Record<string, unknown> {
  if (opts.from !== "sms") return facts;
  const acquisition: SmsLeadAcquisition = {
    channel: "sms",
    captured_at: (opts.now ?? new Date()).toISOString(),
  };
  const source = normalizeSmsLeadSource(opts.src);
  if (source) acquisition.source = source;
  return { ...facts, acquisition };
}

export async function markSmsLeadConverted(phone: string, exec: Executor = poolExecutor): Promise<void> {
  await exec.query(`update sms_leads set converted_at = now() where phone = $1 and converted_at is null`, [phone]);
}

export function publicHiPath(source?: string | null): string {
  const src = normalizeSmsLeadSource(source);
  return src ? `/hi/${src}` : "/hi";
}

export function publicQrPath(source?: string | null, opts?: { download?: boolean }): string {
  const src = normalizeSmsLeadSource(source);
  const params = new URLSearchParams();
  if (src) params.set("src", src);
  if (opts?.download) params.set("download", "1");
  const q = params.toString();
  return q ? `/hi/qr?${q}` : "/hi/qr";
}

/** Default print variants shown on the operator QR page. */
export const SMS_LEAD_PRINT_CAMPAIGNS: ReadonlyArray<{ source: string | null; label: string }> = [
  { source: null, label: "Generic" },
  { source: "flyer", label: "Flyer" },
  { source: "card", label: "Business card" },
  { source: "poster", label: "Poster" },
];

export function smsLeadCampaignLabel(source: string | null): string {
  if (!source) return "Generic";
  return source
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Defaults + observed SMS lead slugs + an optional extra (from the operator form). */
export function collectQrCampaigns(opts?: {
  observed?: Array<string | null | undefined>;
  extra?: string | null;
}): Array<{ source: string | null; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ source: string | null; label: string }> = [];
  const add = (source: string | null) => {
    const key = source ?? "";
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ source, label: smsLeadCampaignLabel(source) });
  };
  for (const campaign of SMS_LEAD_PRINT_CAMPAIGNS) {
    const key = campaign.source ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: campaign.source, label: campaign.label });
  }
  for (const raw of opts?.observed ?? []) {
    const src = normalizeSmsLeadSource(raw);
    if (src) add(src);
  }
  const extra = normalizeSmsLeadSource(opts?.extra);
  if (extra) add(extra);
  return out;
}

