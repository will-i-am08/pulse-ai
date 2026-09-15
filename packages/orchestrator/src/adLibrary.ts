import type { Brand } from "@pulse/shared";
import { callLLM, stripMarkdown } from "./llm.js";
import { persistCompetitorResearch, safePublicUrl, saveResearchSnapshot } from "./research.js";
import { brandContextForPrompt } from "./brandContext.js";

export async function adLibraryBrief(brand: Brand, request: string): Promise<string> {
  const ctx = brandContextForPrompt(brand);
  const system = [
    `You are Kip, "${brand.name}"'s social + ads manager${brand.website ? ` (${brand.website})` : ""}.`,
    "Deep-dive the Meta Ad Library (facebook.com/ads/library) for this owner's category or named competitors.",
    ctx ? `Brand strategy context:\n${ctx}` : "No ICP/offers on file — stay general; never invent fake discounts.",
    "Use web search. Cover: hooks, offers, CTAs, creative formats, angles.",
    'Output ONLY JSON: {"subject":"","summary":"","ad_library_angles":[""],"competitor_hooks":[""],"competitor_ctas":[""],"sources":[""],"visual_exemplars":[{"url":"https://…","label":""}]}',
    "If Ad Library signal is thin, say so honestly — never invent ads.",
  ].join("\n");
  const raw = await callLLM({
    system,
    messages: [{ role: "user", content: request }],
    maxTokens: 1200,
    webSearch: 8,
    tier: "smart",
    task: "ad_library",
  });
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as any;
    const summary = stripMarkdown((parsed.summary ?? "").trim() || "Couldn't find solid Ad Library signal yet.");
    const subject = String(parsed.subject ?? "ad library").trim().slice(0, 120);
    await saveResearchSnapshot({
      brandId: brand.id, kind: "ads", subject, summary,
      findings: {
        ad_library_angles: parsed.ad_library_angles, competitor_hooks: parsed.competitor_hooks,
        competitor_ctas: parsed.competitor_ctas, sources: parsed.sources,
      },
    }).catch(() => undefined);
    const exemplars = (parsed.visual_exemplars ?? [])
      .map((e: any) => ({ url: e.url, label: e.label, source: "competitor" as const, competitor_name: subject }))
      .filter((e: any) => safePublicUrl(e.url ?? null) || e.label);
    if (exemplars.length) {
      await persistCompetitorResearch(brand.id, subject, summary, {
        ad_library_angles: parsed.ad_library_angles, competitor_hooks: parsed.competitor_hooks,
        competitor_ctas: parsed.competitor_ctas, sources: parsed.sources,
      }, exemplars).catch(() => undefined);
    }
    return summary;
  } catch { return stripMarkdown(raw); }
}

export function looksLikeAdLibraryRequest(body: string): boolean {
  return /\bad\s*library\b/i.test(body) || /\b(scan|research|dive|brief)\b.{0,30}\b(ads?|advertis)/i.test(body)
    || /\bwhat\s+ads\b.{0,40}\b(running|competitors?|category)\b/i.test(body);
}
