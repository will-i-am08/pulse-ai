import { query, queryOne, type Brand, type AdCampaign } from "@pulse/shared";
import { getMarketingAdapter } from "@pulse/graph";
import {
  adsEnabled, adsAutopilotOn, isAdsConnected, formatCents, logAdApproval, recordSpend,
  spendCaps, weeklySpendCents, campaignSpendCents,
} from "./adsFeatures.js";

export async function syncAdPerformance(brand: Brand): Promise<{ alerts: string[]; suggestions: string[] }> {
  const alerts: string[] = []; const suggestions: string[] = [];
  if (!adsEnabled(brand) || !isAdsConnected(brand)) return { alerts, suggestions };
  const live = await query<AdCampaign>(
    `select * from ad_campaigns where brand_id=$1 and status in ('active','paused') order by created_at desc limit 10`,
    [brand.id],
  );
  const caps = spendCaps(brand);
  const weekly = await weeklySpendCents(brand.id);
  if (weekly >= caps.weekly_cents) {
    for (const c of live.filter((x) => x.status === "active")) {
      await pauseForCap(brand, c, "weekly");
      alerts.push(`Weekly ads cap hit (${formatCents(caps.weekly_cents)}). Paused ${c.name}.`);
    }
  }
  for (const c of live) {
    if (!c.external_campaign_id) continue;
    try {
      const insights = await getMarketingAdapter().fetchCampaignInsights(brand, c.external_campaign_id);
      await query(`update ad_campaigns set metrics=$1::jsonb where id=$2`, [JSON.stringify({
        spend_cents: insights.spendCents, impressions: insights.impressions, clicks: insights.clicks,
        ctr: insights.ctr, leads: insights.leads, messages: insights.messages, purchases: insights.purchases,
        cpa_cents: insights.cpaCents, roas: insights.roas,
      }), c.id]);
      const logged = await campaignSpendCents(c.id);
      const delta = insights.spendCents - logged;
      if (delta > 0) {
        await recordSpend({ brandId: brand.id, adCampaignId: c.id, amountCents: delta,
          source: c.external_campaign_id.startsWith("mock_") ? "mock" : "sync" });
      }
      const campCap = c.campaign_cap_cents ?? caps.campaign_cents;
      const spent = await campaignSpendCents(c.id);
      if (c.status === "active" && spent >= campCap) {
        await pauseForCap(brand, c, "campaign");
        alerts.push(`Campaign cap hit on ${c.name} (${formatCents(campCap)}). I've paused it.`);
        continue;
      }
      if (c.status === "active" && insights.impressions > 500) {
        const ctrPct = insights.ctr * 100;
        if (ctrPct < 0.5 || (insights.cpaCents != null && insights.cpaCents > c.budget_cents * 2)) {
          const msg = `${c.name} looks soft (${ctrPct.toFixed(1)}% CTR). Want me to pause it?`;
          if (adsAutopilotOn(brand)) {
            await pauseAdForPerf(brand, c, "loser autopilot");
            alerts.push(`Autopilot paused underperformer ${c.name}.`);
          } else {
            await query(`update ad_campaigns set plan = plan || $1::jsonb where id=$2`,
              [JSON.stringify({ pause_suggestion: msg, step: "await_pause_confirm" }), c.id]);
            suggestions.push(msg + ' Reply "yes pause" or "keep it".');
          }
        } else if (ctrPct > 2 && insights.roas != null && insights.roas >= 2) {
          const msg = `${c.name} is strong (${ctrPct.toFixed(1)}% CTR, ROAS ~${insights.roas}). Want me to scale budget +20%?`;
          await query(`update ad_campaigns set plan = plan || $1::jsonb where id=$2`,
            [JSON.stringify({ scale_suggestion: msg, step: "await_scale_confirm" }), c.id]);
          suggestions.push(msg + ' Reply "yes scale" or "not now".');
        }
      }
    } catch (err) { console.error(`syncAdPerformance: campaign ${c.id}`, err); }
  }
  return { alerts, suggestions };
}

async function pauseForCap(brand: Brand, c: AdCampaign, kind: "weekly" | "campaign"): Promise<void> {
  if (c.external_campaign_id) {
    try { await getMarketingAdapter().pauseCampaign(brand, c.external_campaign_id); } catch { /* local */ }
  }
  await query(`update ad_campaigns set status='paused' where id=$1`, [c.id]);
  await logAdApproval({ brandId: brand.id, adCampaignId: c.id, action: "cap_breach",
    note: `${kind} cap breach — auto-paused`, after: { status: "paused" } });
}
async function pauseAdForPerf(brand: Brand, c: AdCampaign, note: string): Promise<void> {
  if (c.external_campaign_id) {
    try { await getMarketingAdapter().pauseCampaign(brand, c.external_campaign_id); } catch { /* local */ }
  }
  await query(`update ad_campaigns set status='paused' where id=$1`, [c.id]);
  await logAdApproval({ brandId: brand.id, adCampaignId: c.id, action: "pause", note });
}

export async function confirmPauseSuggestion(brand: Brand, c: AdCampaign): Promise<string> {
  await pauseAdForPerf(brand, c, "SMS confirmed pause suggestion");
  await query(`update ad_campaigns set plan = plan - 'pause_suggestion' - 'step' where id=$1`, [c.id]);
  return `Paused ${c.name}.`;
}
export async function confirmScaleSuggestion(brand: Brand, c: AdCampaign): Promise<string> {
  const next = Math.round(c.budget_cents * 1.2);
  const caps = spendCaps(brand);
  if (next > (c.campaign_cap_cents ?? caps.campaign_cents)) {
    return `Scaling would exceed the campaign cap (${formatCents(c.campaign_cap_cents ?? caps.campaign_cents)}).`;
  }
  if (c.external_adset_id) {
    try { await getMarketingAdapter().updateBudget(brand, c.external_adset_id, next); }
    catch (err) { return `Couldn't scale: ${err instanceof Error ? err.message : String(err)}`; }
  }
  await query(`update ad_campaigns set budget_cents=$1, plan = plan - 'scale_suggestion' - 'step' where id=$2`, [next, c.id]);
  await logAdApproval({ brandId: brand.id, adCampaignId: c.id, action: "scale",
    before: { budget_cents: c.budget_cents }, after: { budget_cents: next }, note: "SMS confirmed scale" });
  return `Scaled ${c.name} to ${formatCents(next)}/day.`;
}

export function looksLikePauseConfirm(body: string): boolean {
  return /^\s*(yes\s+pause|pause\s+it|pause)\s*[!.]*$/i.test(body) || /\byes\b.{0,10}\bpause\b/i.test(body);
}
export function looksLikeScaleConfirm(body: string): boolean {
  return /^\s*(yes\s+scale|scale\s+it|scale)\s*[!.]*$/i.test(body) || /\byes\b.{0,10}\bscale\b/i.test(body);
}
export function looksLikeKeepRunning(body: string): boolean {
  return /\b(keep\s+it|not\s+now|no\s+pause|no\s+scale)\b/i.test(body);
}
export async function clearPerfSuggestion(c: AdCampaign): Promise<string> {
  await query(`update ad_campaigns set plan = plan - 'pause_suggestion' - 'scale_suggestion' - 'step' where id=$1`, [c.id]);
  return "Got it — leaving it as is.";
}
export function looksLikeCapRaise(body: string): "weekly" | "campaign" | null {
  if (/\braise\s+weekly\s+cap\b|\bweekly\s+(ads?\s+)?cap\b/i.test(body)) return "weekly";
  if (/\braise\s+campaign\s+cap\b|\bcampaign\s+(ads?\s+)?cap\b/i.test(body)) return "campaign";
  return null;
}
export function parseDollarCap(body: string): number | null {
  const m = body.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 5 ? Math.round(n * 100) : null;
}

export async function paidDigestSection(brand: Brand): Promise<string | null> {
  if (!adsEnabled(brand)) return null;
  if (!isAdsConnected(brand)) return "Paid: ad account not connected yet.";
  await syncAdPerformance(brand).catch(() => ({ alerts: [], suggestions: [] }));
  const rows = await query<AdCampaign>(
    `select * from ad_campaigns where brand_id=$1 and status in ('active','paused','done')
       and created_at > now() - interval '14 days' order by created_at desc limit 5`, [brand.id],
  );
  if (!rows.length) return "Paid: no campaigns in the last 2 weeks.";
  const weekly = await weeklySpendCents(brand.id);
  const caps = spendCaps(brand);
  const lines = rows.map((c) => {
    const m = c.metrics ?? {};
    const spend = m.spend_cents ?? 0;
    const ctr = m.ctr != null ? `${(Number(m.ctr) * 100).toFixed(1)}% CTR` : "no CTR yet";
    return `• ${c.name} (${c.status}) — ${formatCents(Number(spend))} · ${ctr}`;
  });
  return `Paid this week: ${formatCents(weekly)} / ${formatCents(caps.weekly_cents)} cap\n` + lines.join("\n");
}

export async function getCampaignAwaitingPerfConfirm(brandId: string): Promise<AdCampaign | null> {
  return queryOne<AdCampaign>(
    `select * from ad_campaigns where brand_id=$1 and status in ('active','paused')
       and (plan ? 'pause_suggestion' or plan ? 'scale_suggestion') order by updated_at desc limit 1`,
    [brandId],
  );
}
