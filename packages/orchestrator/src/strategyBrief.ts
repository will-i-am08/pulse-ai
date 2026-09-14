import {
  query,
  queryOne,
  type Brand,
  type BrandIcp,
  type BrandOffers,
  type BrandPainPoints,
  type BrandPositioning,
  type StrategyBrief,
  type StrategyBriefPieces,
} from "@pulse/shared";
import { callLLM, stripMarkdown } from "./llm.js";
import {
  mergeIcp,
  mergeOffers,
  mergePainPoints,
  mergePositioning,
  brandContextForPrompt,
} from "./brandContext.js";
import { listRecentSnapshots } from "./research.js";

// Phase D2 — strategy brief SMS flow. Propose ICP + pains + positioning + offer
// framing; owner accepts all / parts / revises. Only accepted pieces become truth.
// Never auto-publishes or spends.

export type StrategyPieceKey = "icp" | "pains" | "positioning" | "offers";

const PIECE_KEYS: StrategyPieceKey[] = ["icp", "pains", "positioning", "offers"];

export function looksLikeStrategyRequest(body: string): boolean {
  return (
    /\b(propose|draft|build|make)\s+(a\s+|our\s+|my\s+)?strateg(y|ic)\b/i.test(body) ||
    /\bstrateg(y|ic)\s+brief\b/i.test(body) ||
    /\b(propose|draft)\s+(icp\s*\+\s*pains|positioning\s+and\s+offers)\b/i.test(body) ||
    /^\s*strategy\s*[!.?]*$/i.test(body)
  );
}

export async function getProposedStrategyBrief(brandId: string): Promise<StrategyBrief | null> {
  return queryOne<StrategyBrief>(
    `select * from strategy_briefs
      where brand_id = $1 and status = 'proposed' and created_at > now() - interval '2 hours'
      order by created_at desc limit 1`,
    [brandId],
  );
}

function briefSmsText(pieces: StrategyBriefPieces): string {
  const lines: string[] = [
    pieces.summary?.trim() || "Here's a strategy brief from the research — nothing is live until you accept:",
    "",
  ];
  if (pieces.icp) {
    const segs = pieces.icp.segments?.length ? pieces.icp.segments.join("; ") : "(thin)";
    lines.push(`ICP: ${segs}${pieces.icp.demographics ? ` · ${pieces.icp.demographics}` : ""}`);
    if (pieces.icp.jtbd?.length) lines.push(`  Jobs: ${pieces.icp.jtbd.join("; ")}`);
  }
  if (pieces.pains?.items?.length) {
    lines.push(`Pains: ${pieces.pains.items.map((p) => p.text).slice(0, 4).join("; ")}`);
  }
  if (pieces.positioning?.one_liner) {
    lines.push(`Positioning: "${pieces.positioning.one_liner}"`);
  }
  if (pieces.offers?.primary || pieces.offers?.cta) {
    lines.push(
      `Offer framing: ${[pieces.offers.primary, pieces.offers.cta].filter(Boolean).join(" · ")}`,
    );
  }
  lines.push("");
  lines.push(
    'Reply "accept all", or "accept ICP and pains", or tell me what to revise. I won\'t publish or spend anything.',
  );
  return lines.join("\n");
}

/**
 * Build a strategy brief from recent research + brand facts. Stored as proposed.
 */
export async function proposeStrategyBrief(
  brand: Brand,
  request?: string,
): Promise<{ brief: StrategyBrief; summary: string } | null> {
  if (brand.account_type === "personal") {
    return null;
  }
  const snapshots = await listRecentSnapshots(brand.id, { days: 21, limit: 6 });
  const researchBlock = snapshots.length
    ? snapshots
        .map((s) => {
          const f = s.findings ?? {};
          const bits = [
            s.summary,
            Array.isArray(f.pain_language) ? `pains: ${(f.pain_language as string[]).join("; ")}` : "",
            Array.isArray(f.competitor_hooks)
              ? `hooks: ${(f.competitor_hooks as string[]).join("; ")}`
              : "",
            Array.isArray(f.ad_library_angles)
              ? `ads: ${(f.ad_library_angles as string[]).join("; ")}`
              : "",
          ]
            .filter(Boolean)
            .join(" | ");
          return `- [${s.kind}] ${bits}`;
        })
        .join("\n")
    : "(No prior research snapshots — keep proposals tentative and humble.)";

  const ctx = brandContextForPrompt(brand);
  const system = [
    `You draft a STRATEGY BRIEF for "${brand.name}" for SMS approval.`,
    ctx ? `Current brand objects (may be empty):\n${ctx}` : "No ICP/pains/positioning/offers on file yet.",
    `Recent research:\n${researchBlock}`,
    'Output ONLY JSON: {"summary":"<one short SMS lead>","icp":{"segments":[""],"demographics":"","jtbd":[""],"notes":""},"pains":{"items":[{"text":"","source":"research","confirmed":false}]},"positioning":{"one_liner":"","category":"","differentiation":""},"offers":{"primary":"","bonuses":[],"proof":[],"cta":"","claim_constraints":["never invent discounts or awards"]}}',
    "Do NOT invent discounts, awards, testimonials, or medical claims. Offers stay framing-level unless research/facts state them.",
    "Mark pain confirmed=false. This is a draft — owner must accept before it is truth.",
    "If research is thin, fewer items — never invent a fake customer.",
  ].join("\n");

  let parsed: StrategyBriefPieces;
  try {
    const raw = await callLLM({
      system,
      messages: [
        {
          role: "user",
          content: request?.trim() || "Propose the full strategy brief now.",
        },
      ],
      maxTokens: 1100,
      tier: "smart",
      task: "strategy_brief",
    });
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as StrategyBriefPieces;
  } catch (err) {
    console.error("proposeStrategyBrief: LLM/parse failed", err);
    return null;
  }

  const pieces = sanitizePieces(parsed);
  if (!pieces.icp && !pieces.pains && !pieces.positioning && !pieces.offers) return null;

  // Cancel any older proposed brief so the unique index stays happy.
  await query(
    `update strategy_briefs set status = 'cancelled', updated_at = now()
      where brand_id = $1 and status = 'proposed'`,
    [brand.id],
  );

  const brief = await queryOne<StrategyBrief>(
    `insert into strategy_briefs (brand_id, status, pieces)
     values ($1, 'proposed', $2::jsonb)
     returning *`,
    [brand.id, JSON.stringify(pieces)],
  );
  if (!brief) return null;
  return { brief, summary: briefSmsText(pieces) };
}

function sanitizePieces(raw: StrategyBriefPieces): StrategyBriefPieces {
  const out: StrategyBriefPieces = {
    summary: typeof raw.summary === "string" ? stripMarkdown(raw.summary).slice(0, 400) : undefined,
  };
  if (raw.icp && typeof raw.icp === "object") {
    const icp: BrandIcp = {
      segments: Array.isArray(raw.icp.segments)
        ? raw.icp.segments.map(String).filter(Boolean).slice(0, 5)
        : [],
      demographics: typeof raw.icp.demographics === "string" ? raw.icp.demographics.slice(0, 200) : "",
      jtbd: Array.isArray(raw.icp.jtbd) ? raw.icp.jtbd.map(String).filter(Boolean).slice(0, 5) : [],
      notes: typeof raw.icp.notes === "string" ? raw.icp.notes.slice(0, 400) : "",
      researched: true,
    };
    if (icp.segments?.length || icp.demographics || icp.jtbd?.length) out.icp = icp;
  }
  if (raw.pains?.items?.length) {
    out.pains = {
      items: raw.pains.items
        .filter((p) => p?.text)
        .slice(0, 6)
        .map((p) => ({
          text: String(p.text).trim().slice(0, 200),
          source: "research" as const,
          confirmed: false,
        })),
    };
  }
  if (raw.positioning && (raw.positioning.one_liner || raw.positioning.category || raw.positioning.differentiation)) {
    out.positioning = {
      one_liner: raw.positioning.one_liner?.slice(0, 240),
      category: raw.positioning.category?.slice(0, 120),
      differentiation: raw.positioning.differentiation?.slice(0, 240),
    };
  }
  if (raw.offers && typeof raw.offers === "object") {
    const o: BrandOffers = {};
    if (raw.offers.primary) o.primary = String(raw.offers.primary).slice(0, 240);
    if (Array.isArray(raw.offers.bonuses)) o.bonuses = raw.offers.bonuses.map(String).filter(Boolean).slice(0, 5);
    if (Array.isArray(raw.offers.proof)) o.proof = raw.offers.proof.map(String).filter(Boolean).slice(0, 5);
    if (raw.offers.cta) o.cta = String(raw.offers.cta).slice(0, 120);
    if (Array.isArray(raw.offers.claim_constraints)) {
      o.claim_constraints = raw.offers.claim_constraints.map(String).filter(Boolean).slice(0, 6);
    }
    if (!o.claim_constraints?.length) {
      o.claim_constraints = ["never invent discounts or awards"];
    }
    if (o.primary || o.cta || o.bonuses?.length || o.proof?.length) out.offers = o;
  }
  return out;
}

/** Parse which pieces the owner wants to accept from an SMS. */
export function parseStrategyAccept(body: string): "all" | StrategyPieceKey[] | null {
  if (/\baccept\s+all\b|\ball\s+of\s+(it|that|this)\b|\block\s+(it\s+)?all\b/i.test(body)) {
    return "all";
  }

  // Partial accept before bare "yes"/"accept" so "accept ICP and pains" stays partial.
  const keys: StrategyPieceKey[] = [];
  if (/\b(accept|keep|lock|yes)\b/i.test(body) || /\baccept\b/i.test(body)) {
    if (/\b(icp|ideal\s+customer|audience)\b/i.test(body)) keys.push("icp");
    if (/\bpains?\b/i.test(body)) keys.push("pains");
    if (/\b(positioning|one[\s-]?liner)\b/i.test(body)) keys.push("positioning");
    if (/\boffers?\b/i.test(body)) keys.push("offers");
  }
  if (keys.length) return keys;

  if (/^\s*(yes|yep|yeah|yup|love it|looks good|perfect|do it|sounds good|accept)\b/i.test(body)) {
    return "all";
  }
  return null;
}

export function looksLikeStrategyRevise(body: string): boolean {
  return /\b(revise|change|tweak|update)\b.{0,40}\b(strateg|icp|pain|positioning|offer)/i.test(body) ||
    /\bstrateg(y|ic).{0,20}\b(revise|change|tweak)\b/i.test(body);
}

/**
 * Apply accepted pieces onto brand objects (source of truth). Unaccepted pieces stay drafts only.
 */
export async function acceptStrategyPieces(
  brand: Brand,
  brief: StrategyBrief,
  which: "all" | StrategyPieceKey[],
): Promise<string> {
  const pieces = brief.pieces ?? {};
  const keys: StrategyPieceKey[] = which === "all" ? PIECE_KEYS.filter((k) => pieces[k]) : which;
  const applied: string[] = [];

  if (keys.includes("icp") && pieces.icp) {
    const merged = mergeIcp(brand.icp, {
      ...pieces.icp,
      researched: true,
      confirmed_at: new Date().toISOString(),
    });
    await query(`update brands set icp = $1::jsonb where id = $2`, [JSON.stringify(merged), brand.id]);
    brand.icp = merged;
    applied.push("ICP");
  }
  if (keys.includes("pains") && pieces.pains?.items?.length) {
    const merged = mergePainPoints(brand.pain_points, {
      items: pieces.pains.items.map((p) => ({
        ...p,
        confirmed: true,
        source: p.source ?? "research",
      })),
    });
    await query(`update brands set pain_points = $1::jsonb where id = $2`, [
      JSON.stringify(merged),
      brand.id,
    ]);
    brand.pain_points = merged;
    applied.push("pains");
  }
  if (keys.includes("positioning") && pieces.positioning) {
    const merged = mergePositioning(brand.positioning, pieces.positioning);
    await query(`update brands set positioning = $1::jsonb where id = $2`, [
      JSON.stringify(merged),
      brand.id,
    ]);
    brand.positioning = merged;
    applied.push("positioning");
  }
  if (keys.includes("offers") && pieces.offers) {
    const merged = mergeOffers(brand.offers, pieces.offers);
    await query(`update brands set offers = $1::jsonb where id = $2`, [
      JSON.stringify(merged),
      brand.id,
    ]);
    brand.offers = merged;
    applied.push("offers");
  }

  const allAccepted = which === "all" || keys.length >= PIECE_KEYS.filter((k) => pieces[k]).length;
  await query(
    `update strategy_briefs set status = $1, updated_at = now() where id = $2`,
    [allAccepted ? "accepted" : "proposed", brief.id],
  );

  if (!applied.length) {
    return "Nothing to lock in from that brief — say \"propose strategy\" for a fresh one.";
  }
  return `Locked in: ${applied.join(", ")}. That's your source of truth now — I still won't publish or spend without you asking.`;
}

/**
 * Revise a proposed brief from owner instructions (stays proposed; not truth yet).
 */
export async function reviseStrategyBrief(
  brand: Brand,
  brief: StrategyBrief,
  instruction: string,
): Promise<string> {
  const system = [
    `Revise this proposed strategy brief for "${brand.name}" per the owner's instruction.`,
    `Current proposal JSON: ${JSON.stringify(brief.pieces)}`,
    'Output ONLY JSON with the same shape: {"summary","icp","pains","positioning","offers"}.',
    "Only change what they asked. Do not invent discounts/awards. Still a draft.",
  ].join("\n");
  let parsed: StrategyBriefPieces;
  try {
    const raw = await callLLM({
      system,
      messages: [{ role: "user", content: instruction }],
      maxTokens: 1100,
      tier: "smart",
      task: "strategy_brief",
    });
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as StrategyBriefPieces;
  } catch {
    return "Couldn't revise that just then — try again, or say \"accept all\" / \"accept ICP\".";
  }
  const pieces = sanitizePieces(parsed);
  await query(
    `update strategy_briefs set pieces = $1::jsonb, status = 'proposed', updated_at = now() where id = $2`,
    [JSON.stringify(pieces), brief.id],
  );
  return briefSmsText(pieces);
}

export async function cancelStrategyBrief(briefId: string): Promise<void> {
  await query(`update strategy_briefs set status = 'cancelled', updated_at = now() where id = $1`, [
    briefId,
  ]);
}
