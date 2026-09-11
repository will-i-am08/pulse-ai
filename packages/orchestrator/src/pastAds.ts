import type { Brand } from "@pulse/shared";
import { getMarketingAdapter } from "@pulse/graph";
import { connectLinkMessage } from "./smsConnect.js";
import { isAdsConnected, formatCents, adsEnabled, adsDisabledMessage } from "./adsFeatures.js";
import { saveResearchSnapshot } from "./research.js";

export async function pastAdsAnalysis(brand: Brand): Promise<string> {
  if (!isAdsConnected(brand)) {
    return "I can dig into your past Meta ads once your ad account is linked.\n\n" + connectLinkMessage(brand, "ads");
  }
  if (!adsEnabled(brand)) return adsDisabledMessage();
  try {
    const ads = await getMarketingAdapter().listPastAds(brand, 8);
    if (!ads.length) return "No past ads on this account yet — once you run a few I'll summarise winners and losers.";
    const ranked = [...ads].sort((a, b) => {
      if (a.results > 0 && b.results > 0) return a.spendCents / a.results - b.spendCents / b.results;
      return b.ctr - a.ctr;
    });
    const winners = ranked.slice(0, 2);
    const losers = ranked.slice(-2).reverse();
    const fmt = (a: typeof ads[0]) =>
      `• ${a.name} — ${formatCents(a.spendCents)} spent, ${(a.ctr * 100).toFixed(1)}% CTR, ${a.results} ${a.resultType}`;
    const summary =
      `📈 Past ads on ${brand.ad_account_name ?? "your account"}\n\nWorking better:\n${winners.map(fmt).join("\n")}\n\nWeaker:\n${losers.map(fmt).join("\n")}\n\nWant me to boost a winner-style angle, or kill spend on something similar that's still live?`;
    await saveResearchSnapshot({
      brandId: brand.id, kind: "ads", subject: "past-ads", summary,
      findings: { notes: `analysed ${ads.length} ads`, ad_library_angles: winners.map((w) => w.name) },
    }).catch(() => undefined);
    return summary;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Couldn't pull past ads (${detail}). If scopes look wrong, say "connect ad account" for a fresh link.`;
  }
}

export function looksLikePastAdsRequest(body: string): boolean {
  return /\b(past|previous|historic|old|my)\s+ads?\b/i.test(body)
    || /\bads?\s+(history|performance|results|report)\b/i.test(body)
    || /\b(what|which)\s+ads?\b.{0,30}\b(worked|winning|losing|performed)\b/i.test(body);
}
