import {
  query, queryOne, type Brand, type AdCampaign, type AdObjective, type AdAudience, type AdCreativeSpec, type AdCreativeSource,
} from "@pulse/shared";
import { getMarketingAdapter } from "@pulse/graph";
import {
  adsEnabled, adsDisabledMessage, isAdsConnected, assertCanSpend, formatCents,
  logAdApproval, recordSpend, spendCaps,
} from "./adsFeatures.js";
import { connectLinkMessage } from "./smsConnect.js";
import { brandContextForPrompt } from "./brandContext.js";
import { callLLM } from "./llm.js";
import { resolveAdDestinationUrl, ensureDestinationLink } from "./destinationLinks.js";

const OBJECTIVES: AdObjective[] = ["awareness", "traffic", "leads", "messages", "sales"];

function detectObjective(body: string): AdObjective {
  if (/\b(lead|leads|lead gen|sign[- ]?ups?)\b/i.test(body)) return "leads";
  if (/\b(message|messages|dm|inbox)\b/i.test(body)) return "messages";
  if (/\b(sale|sales|convert|purchase|shop|roas)\b/i.test(body)) return "sales";
  if (/\b(aware|awareness|reach|brand)\b/i.test(body)) return "awareness";
  return "traffic";
}
function detectCreativeSource(body: string): AdCreativeSource {
  if (/\bcarousel\b/i.test(body)) return "carousel";
  if (/\b(video|reel)\b/i.test(body)) return "video";
  if (/\b(organic|existing post)\b/i.test(body)) return "organic";
  return "static";
}
function parseBudgetCents(body: string): number | null {
  const m = body.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
function parseDays(body: string): number {
  const m = body.match(/\b(\d+)\s*(?:day|days)\b/i);
  if (m) return Math.max(1, Math.min(30, Number(m[1])));
  const w = body.match(/\b(\d+)\s*weeks?\b/i);
  if (w) return Math.max(1, Math.min(30, Number(w[1]) * 7));
  return 7;
}
function audiencesFromIcp(brand: Brand): AdAudience[] {
  const who = brand.icp?.segments?.[0] ?? brand.icp?.demographics ?? "local customers";
  return [
    { label: `ICP interest — ${who.slice(0, 60)}`, meta_type: "interest", interests: [who.slice(0, 60)], age_min: 25, age_max: 55 },
    { label: "Page engagers (retargeting)", meta_type: "retargeting", notes: "Page/IG engagers last 30 days", age_min: 22, age_max: 60 },
    { label: "Lookalike of engagers", meta_type: "lookalike", notes: "1% lookalike where available" },
  ];
}
function offerCopy(brand: Brand) {
  const offers = brand.offers ?? {};
  const primary = offers.primary ?? `${brand.name} — ${brand.positioning?.one_liner ?? "worth a look"}`;
  const cta = offers.cta ?? "Learn more";
  return {
    primary: primary.slice(0, 400), headline: (offers.primary ?? brand.name).slice(0, 40), cta,
    offer_ref: {
      primary: offers.primary ?? null, bonuses: offers.bonuses ?? [], proof: offers.proof ?? [],
      cta, booking_link: offers.booking_link ?? null, claim_constraints: offers.claim_constraints ?? [],
    },
  };
}

export function looksLikePaidCampaignRequest(body: string): boolean {
  if (/\b(boost|promote)\b/i.test(body) && !/\b(ad\s*campaign|paid campaign|run ads)\b/i.test(body)) return false;
  return /\b(ad\s*campaign|paid campaign|run ads|facebook ads|meta ads|start ads)\b/i.test(body)
    || /\b(create|launch|build|run)\b.{0,30}\b(paid|ads?)\b/i.test(body)
    || /\bads?\s+for\s+(leads?|traffic|sales?|awareness|messages?)\b/i.test(body);
}

export function looksLikeAdCampaignControl(body: string): "pause" | "resume" | "kill" | "budget" | null {
  if (/\b(pause|hold|freeze)\b.{0,20}\b(ads?|boost|paid)\b|\b(ads?|boost)\b.{0,20}\bpause\b/i.test(body)) return "pause";
  if (/\b(resume|unpause|restart)\b.{0,20}\b(ads?|boost|paid)\b/i.test(body)) return "resume";
  if (/\b(kill|stop|cancel|scrap)\b.{0,20}\b(ads?|boost|the ad|paid)\b/i.test(body)) return "kill";
  if (/\b(change|edit|raise|lower|set)\b.{0,20}\b(budget|spend)\b/i.test(body) && /\bads?\b/i.test(body)) return "budget";
  return null;
}

export async function getProposedAdCampaign(brandId: string): Promise<AdCampaign | null> {
  return queryOne<AdCampaign>(
    `select * from ad_campaigns where brand_id=$1 and kind='campaign' and status in ('proposed','preview')
       and created_at > now() - interval '30 minutes' order by created_at desc limit 1`, [brandId],
  );
}
export async function getLiveAdCampaign(brandId: string): Promise<AdCampaign | null> {
  return queryOne<AdCampaign>(
    `select * from ad_campaigns where brand_id=$1 and status in ('active','paused') order by created_at desc limit 1`,
    [brandId],
  );
}

function previewText(c: AdCampaign, destinationUrl?: string | null): string {
  return (
    `📣 Ad campaign preview\n\nName: ${c.name}\nObjective: ${c.objective}\nAudience: ${c.audience?.label ?? "TBD"}\n` +
    `Creative: ${c.creative?.source ?? "static"}${c.creative?.headline ? ` — "${c.creative.headline}"` : ""}\n` +
    ((c.offer_ref as any)?.primary ? `Offer: ${(c.offer_ref as any).primary}\n` : "") +
    (destinationUrl ? `Clicks go to: ${destinationUrl}\n` : "") +
    `Budget: ${formatCents(c.budget_cents)}/day · ${c.duration_days} days (~${formatCents(c.budget_cents * c.duration_days)} total)\n` +
    (c.objective === "leads" ? "Leads: hot ones hand into your usual lead SMS thread.\n" : "") +
    `\nReply "yes" to launch, "no" to cancel, or tell me what to change.`
  );
}

export async function proposeAdCampaign(
  brand: Brand, request: string,
): Promise<{ ok: true; campaign: AdCampaign; summary: string } | { ok: false; summary: string }> {
  if (!adsEnabled(brand)) return { ok: false, summary: adsDisabledMessage() };
  if (!isAdsConnected(brand)) return { ok: false, summary: "Connect an ad account first.\n\n" + connectLinkMessage(brand, "ads") };

  // Prefer a confirmed booking URL for click-through; confirm with owner if missing.
  const ensured = await ensureDestinationLink(brand, "ads");
  if (ensured.askSms) return { ok: false, summary: ensured.askSms };
  brand = ensured.brand;

  const caps = spendCaps(brand);
  let budget = parseBudgetCents(request) ?? Math.min(5_000, Math.floor(caps.campaign_cents / 3));
  if (budget < 500) return { ok: false, summary: 'Budgets need at least $5/day. Try e.g. "run ads for leads at $20/day for 7 days".' };
  if (budget > caps.campaign_cents) budget = caps.campaign_cents;
  const objective = detectObjective(request);
  const audiences = audiencesFromIcp(brand);
  let audience = audiences[0]!;
  if (/\bretarget/i.test(request)) audience = audiences[1]!;
  if (/\blookalike|lal\b/i.test(request)) audience = audiences[2]!;
  const offer = offerCopy(brand);
  const creative: AdCreativeSpec = {
    source: detectCreativeSource(request), primary_text: offer.primary, headline: offer.headline, cta: offer.cta,
    notes: brandContextForPrompt(brand)?.slice(0, 200),
  };
  let name = `${brand.name} ${objective}`.slice(0, 60);
  try {
    const raw = await callLLM({
      system: `Name a short Meta ads campaign for "${brand.name}". Output ONLY JSON: {"name":"…"}`,
      messages: [{ role: "user", content: request }], maxTokens: 80,
    });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { name?: string };
    if (parsed.name) name = parsed.name.slice(0, 60);
  } catch { /* keep default */ }
  const days = parseDays(request);
  const campaign = await queryOne<AdCampaign>(
    `insert into ad_campaigns
      (brand_id,name,objective,status,audience,offer_ref,creative,budget_cents,duration_days,weekly_cap_cents,campaign_cap_cents,kind,plan)
     values ($1,$2,$3,'preview',$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,'campaign',$11::jsonb) returning *`,
    [brand.id, name, objective, JSON.stringify(audience), JSON.stringify(offer.offer_ref), JSON.stringify(creative),
     budget, days, caps.weekly_cents, caps.campaign_cents,
     JSON.stringify({ step: "preview", audience_options: audiences.map((a) => a.label) })],
  );
  if (!campaign) return { ok: false, summary: "Couldn't save that campaign draft — try again." };
  const destinationUrl = resolveAdDestinationUrl(brand);
  return { ok: true, campaign, summary: previewText(campaign, destinationUrl) };
}

export async function confirmAdCampaign(brand: Brand, proposed: AdCampaign): Promise<string> {
  if (!adsEnabled(brand)) return adsDisabledMessage();
  if (!isAdsConnected(brand)) return connectLinkMessage(brand, "ads");
  const blocked = await assertCanSpend(brand, { additionalCents: proposed.budget_cents * proposed.duration_days, adCampaignId: proposed.id });
  if (blocked) return blocked;
  try {
    const result = await getMarketingAdapter().createCampaign({
      brand, name: proposed.name, objective: proposed.objective, dailyBudgetCents: proposed.budget_cents,
      audience: proposed.audience,
      creative: {
        primary_text: proposed.creative.primary_text ?? proposed.name, headline: proposed.creative.headline, cta: proposed.creative.cta,
      },
      durationDays: proposed.duration_days,
    });
    await query(
      `update ad_campaigns set status='active', external_campaign_id=$1, external_adset_id=$2, external_ad_id=$3,
         starts_at=now(), ends_at=now()+($4||' days')::interval, plan=plan||$5::jsonb where id=$6`,
      [result.campaignId, result.adsetId, result.adId, String(proposed.duration_days),
       JSON.stringify({ preview_url: result.previewUrl }), proposed.id],
    );
    await logAdApproval({ brandId: brand.id, adCampaignId: proposed.id, action: "launch",
      after: { external_campaign_id: result.campaignId, objective: proposed.objective, budget_cents: proposed.budget_cents },
      note: "SMS yes on ad campaign preview" });
    await recordSpend({ brandId: brand.id, adCampaignId: proposed.id, amountCents: proposed.budget_cents,
      source: result.campaignId.startsWith("mock_") ? "mock" : "estimate", meta: { kind: "campaign_launch" } });
    const leadNote = proposed.objective === "leads" ? "\nLead form leads will land in your usual engagement handoff thread." : "";
    return `Campaign live ✅ ${proposed.name}\n${proposed.objective} · ${formatCents(proposed.budget_cents)}/day · ${proposed.duration_days} days` +
      (result.previewUrl ? `\n${result.previewUrl}` : "") + leadNote +
      `\nSay "pause ads", "resume ads", "kill ads", or "change ads budget to $X".`;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Couldn't launch (${detail}). Say "connect ad account" if scopes look wrong.`;
  }
}

export async function cancelProposedAdCampaign(proposed: AdCampaign): Promise<string> {
  await query(`update ad_campaigns set status='cancelled' where id=$1`, [proposed.id]);
  await logAdApproval({ brandId: proposed.brand_id, adCampaignId: proposed.id, action: "reject", note: "SMS no on ad campaign" });
  return "Scrapped that ad campaign. Nothing spent.";
}

export async function pauseAdCampaign(brand: Brand, live: AdCampaign): Promise<string> {
  if (live.external_campaign_id) {
    try { await getMarketingAdapter().pauseCampaign(brand, live.external_campaign_id); }
    catch (err) { return `Tried to pause but Meta said: ${err instanceof Error ? err.message : String(err)}`; }
  }
  await query(`update ad_campaigns set status='paused' where id=$1`, [live.id]);
  await logAdApproval({ brandId: brand.id, adCampaignId: live.id, action: "pause", note: "SMS pause" });
  return `Paused ${live.name}. Say "resume ads" when you want it back.`;
}
export async function resumeAdCampaign(brand: Brand, live: AdCampaign): Promise<string> {
  const blocked = await assertCanSpend(brand, { additionalCents: live.budget_cents, adCampaignId: live.id });
  if (blocked) return blocked;
  if (live.external_campaign_id) {
    try { await getMarketingAdapter().resumeCampaign(brand, live.external_campaign_id); }
    catch (err) { return `Tried to resume but Meta said: ${err instanceof Error ? err.message : String(err)}`; }
  }
  await query(`update ad_campaigns set status='active' where id=$1`, [live.id]);
  await logAdApproval({ brandId: brand.id, adCampaignId: live.id, action: "resume", note: "SMS resume" });
  return `Resumed ${live.name}.`;
}
export async function killAdCampaign(brand: Brand, live: AdCampaign): Promise<string> {
  if (live.external_campaign_id) {
    try { await getMarketingAdapter().killCampaign(brand, live.external_campaign_id); }
    catch (err) { return `Tried to kill it but Meta said: ${err instanceof Error ? err.message : String(err)}`; }
  }
  await query(`update ad_campaigns set status='killed' where id=$1`, [live.id]);
  await logAdApproval({ brandId: brand.id, adCampaignId: live.id, action: "kill", note: "SMS kill" });
  return `Killed ${live.name}. It won't spend further.`;
}

export async function proposeBudgetEdit(brand: Brand, live: AdCampaign, body: string): Promise<string> {
  const cents = parseBudgetCents(body);
  if (cents == null || cents < 500) return 'Tell me the new daily budget like "change ads budget to $25".';
  const caps = spendCaps(brand);
  if (cents > (live.campaign_cap_cents ?? caps.campaign_cents)) {
    return `That's above this campaign's cap (${formatCents(live.campaign_cap_cents ?? caps.campaign_cents)}).`;
  }
  await query(`update ad_campaigns set plan = plan || $1::jsonb where id=$2`,
    [JSON.stringify({ pending_budget_cents: cents, step: "await_budget_confirm" }), live.id]);
  return `New daily budget: ${formatCents(cents)} (was ${formatCents(live.budget_cents)}).\nReply "yes" to apply, or "no" to keep the current budget.`;
}
export async function confirmBudgetEdit(brand: Brand, live: AdCampaign): Promise<string> {
  const pending = Number(live.plan?.pending_budget_cents ?? 0);
  if (!pending || pending < 500) return "No budget change pending.";
  const blocked = await assertCanSpend(brand, { additionalCents: pending, adCampaignId: live.id });
  if (blocked) return blocked;
  if (live.external_adset_id) {
    try { await getMarketingAdapter().updateBudget(brand, live.external_adset_id, pending); }
    catch (err) { return `Meta rejected the budget change: ${err instanceof Error ? err.message : String(err)}`; }
  }
  await query(`update ad_campaigns set budget_cents=$1, plan = plan - 'pending_budget_cents' - 'step' where id=$2`, [pending, live.id]);
  await logAdApproval({ brandId: brand.id, adCampaignId: live.id, action: "budget_edit",
    before: { budget_cents: live.budget_cents }, after: { budget_cents: pending }, note: "SMS confirmed budget edit" });
  return `Budget updated to ${formatCents(pending)}/day.`;
}
export async function rejectBudgetEdit(live: AdCampaign): Promise<string> {
  await query(`update ad_campaigns set plan = plan - 'pending_budget_cents' - 'step' where id=$1`, [live.id]);
  return "Kept the current budget.";
}
