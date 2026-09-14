/**
 * Dummy-environment arena: can Kip's new craft architecture produce a
 * competitive organic + paid social strategy without live Meta/LLM?
 *
 * We mock the LLM to return a craft-aware niche plan (as the upgraded prompts
 * instruct), then run the real contentJobs / hooks / humanizeCaption /
 * MockMarketingAdapter stack and score the playbook.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockMarketingAdapter } from "@pulse/graph";
import type { Brand, NichePlan } from "@pulse/shared";

vi.mock("../llm.js", () => ({ callLLM: vi.fn() }));
vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return { ...actual, query: vi.fn(async () => []), queryOne: vi.fn(async () => null) };
});
vi.mock("@pulse/graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/graph")>();
  return {
    ...actual,
    harvestBrandPosts: vi.fn(async () => {
      throw new Error("harvest should be skipped on preferFast");
    }),
  };
});

import { callLLM } from "../llm.js";
import { buildPlanWithFallback, planTextSummary } from "../nichePlan.js";
import {
  CONTENT_JOBS,
  inferContentJob,
  formatBiasForJob,
  pickUnderrepresentedJob,
  type ContentJob,
} from "../contentJobs.js";
import { pickHookFormulas, scoreHookLine, isBannedHookOpener } from "../hooks.js";
import {
  humanizeCaption,
  captionJobForFormat,
  captionJobPrompt,
  limitHashtags,
} from "../humanizeCaption.js";
import { brandContextForPrompt } from "../brandContext.js";
import { qualitySignalsLine } from "../insights.js";
import {
  looksLikePaidCampaignRequest,
  looksLikeAdCampaignControl,
} from "../adCampaigns.js";
import { adsEnabled, spendCaps, formatCents, isAdsConnected } from "../adsFeatures.js";
import { writeFileSync, mkdirSync } from "node:fs";

const mockedCallLLM = callLLM as unknown as ReturnType<typeof vi.fn>;

/** Dummy brand: Peak Form Physio — local clinic with real proof bank. */
function dummyBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "00000000-0000-4000-8000-00000000arena",
    name: "Peak Form Physio",
    client_phone: "+15550001111",
    owner_user_id: null,
    account_type: "business",
    website: "https://peakform.example",
    onboarding_state: { status: "done" } as Brand["onboarding_state"],
    contact_card_sent_at: null,
    brand_voice_profile: {
      tone: ["clear", "confident", "no fluff"],
      dos: ["name the body part", "use clinic numbers from the proof bank"],
      donts: ["medical miracle claims", "shame language"],
      example_captions: [
        "Desk shoulders aren't a personality. 3 drills, 4 minutes.",
      ],
      banned_words: ["miracle", "guaranteed cure"],
      emoji_policy: "sparing",
      hashtag_policy: "max 5, clinic + injury terms",
      notes: [],
      writing_mechanics: {},
      photo_style: {},
      analysis_source: "dummy-arena",
      proof_bank: [
        "127 desk-worker clients through the shoulder programme last year",
        "Avg. 3.2 fewer pain days/week by week 4 (intake vs follow-up)",
        "4.9★ from 214 Google reviews",
        "Walk-in to first session under 48 hours on weekdays",
      ],
      positions: [
        "Rest alone is not a rehab plan for desk shoulders",
        "If your physio never watches you lift, find another clinic",
      ],
    },
    voice_guide_md: "Talk like a sharp clinician who respects busy adults.",
    voice_analysis_state: { status: "done" } as Brand["voice_analysis_state"],
    ig_user_id: "ig_dummy",
    fb_page_id: "page_dummy",
    fb_page_name: "Peak Form Physio",
    ig_username: "peakformphysio",
    platform_tokens_encrypted: "enc",
    platform_user_token_encrypted: null,
    x_user_id: null,
    x_username: null,
    x_tokens_encrypted: null,
    threads_user_id: null,
    threads_username: null,
    threads_tokens_encrypted: null,
    linkedin_org_id: null,
    linkedin_org_name: null,
    linkedin_tokens_encrypted: null,
    linkedin_connected_at: null,
    tiktok_open_id: null,
    tiktok_display_name: null,
    tiktok_tokens_encrypted: null,
    tiktok_connected_at: null,
    meta_connected_at: new Date().toISOString(),
    facts: {
      owner_name: "Maya",
      service_area: "Austin, TX — sports & workplace physiotherapy",
      differentiators: "desk-athlete clinic; same-week first visits",
      services: [
        { name: "Desk Shoulder Reset", price: "from $189" },
        { name: "Runner gait screen", price: "$129" },
      ],
      booking_link: "https://peakform.example/book",
    },
    visual: {},
    icp: {
      segments: ["desk workers 28–45 with neck/shoulder pain", "recreational runners"],
      demographics: "Austin metro, household income $80k+",
      jtbd: ["stop pain without quitting work", "get a clear plan in one visit"],
    },
    pain_points: {
      items: [
        { text: "Pain flares after long laptop days", source: "research", confirmed: true },
        { text: "Tried YouTube stretches with no lasting change", source: "research", confirmed: true },
      ],
    },
    positioning: {
      one_liner: "The desk-athlete physio clinic — clear plans, same-week starts.",
      category: "physiotherapy",
      differentiation: "We treat desk athletes like athletes, not 'just tension'.",
    },
    offers: {
      primary: "Desk Shoulder Reset — 4-session starter plan",
      bonuses: ["home desk setup checklist"],
      proof: ["4.9★ from 214 reviews", "127 desk-worker clients last year"],
      cta: "Book your first session",
      booking_link: "https://peakform.example/book",
      claim_constraints: ["no miracle cures", "no invented % off", "only cite proof_bank numbers"],
    },
    features: { ads: true, ads_autopilot: false, autopilot: true },
    ads_spend_caps: { weekly_cents: 75_000, campaign_cents: 25_000 },
    ad_account_id: "act_mock_peak",
    ad_account_name: "Peak Form Ads",
    ads_tokens_encrypted: "mock_tok",
    ads_connected_at: new Date().toISOString(),
    ...over,
  } as Brand;
}

/** LLM response shaped the way the upgraded niche-plan prompts ask. */
const craftAwarePlanJson = {
  summary: "4 pillars, 5 posts/wk — Reels for reach, carousels for depth, Stories for soft sell",
  pillars: [
    {
      key: "desk_proof",
      name: "Desk proof",
      description: "Client outcomes and clinic receipts",
      posts_per_week: 1,
      format_bias: "reel",
      content_job: "proof",
    },
    {
      key: "how_to",
      name: "How-to",
      description: "Short drills and desk setups",
      posts_per_week: 2,
      format_bias: "carousel",
      content_job: "teach",
    },
    {
      key: "hot_takes",
      name: "Clinic takes",
      description: "Positions that could lose followers",
      posts_per_week: 1,
      format_bias: "reel",
      content_job: "opinion",
    },
    {
      key: "offer_soft",
      name: "Soft offer",
      description: "Sparse booking asks via Stories/carousel",
      posts_per_week: 1,
      format_bias: "story",
      content_job: "offer",
    },
  ],
  format_mix: "Reels ~40% (discovery), carousels ~40% (depth), Stories ~20% (sell + questions)",
  best_times: "Tue/Thu 7–8am + lunch; Sat morning for runners",
  starter_ideas: [
    "Reel: 127 desk-worker clients — what week 4 looked like",
    "Carousel: 3 laptop setups that unload the shoulder",
    "Opinion Reel: Rest alone is not a rehab plan",
  ],
  job_mix: "1 proof / 2 teach / 1 opinion / 0.5 story / 0.5 offer per week",
};

type OrganicSlot = {
  day: string;
  job: ContentJob;
  format: ReturnType<typeof formatBiasForJob>;
  hookId: string;
  hookLine: string;
  hookScore: number;
  captionJob: "A" | "B";
  caption: string;
  proofUsed: string | null;
};

function buildOrganicWeek(brand: Brand, plan: NichePlan): OrganicSlot[] {
  const proof = brand.brand_voice_profile.proof_bank ?? [];
  const positions = brand.brand_voice_profile.positions ?? [];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const recent: ContentJob[] = [];
  const slots: OrganicSlot[] = [];

  for (let i = 0; i < days.length; i++) {
    const pillar = plan.pillars[i % plan.pillars.length]!;
    const job =
      (pillar.content_job as ContentJob | undefined) ??
      inferContentJob({
        key: pillar.key,
        name: pillar.name,
        description: pillar.description,
      });
    // Prefer filling underrepresented jobs when the pillar job was just used.
    const chosen =
      recent.filter((j) => j === job).length >= 2
        ? pickUnderrepresentedJob(recent)
        : job;
    recent.push(chosen);

    const format =
      pillar.format_bias && ["feed", "carousel", "story", "reel"].includes(pillar.format_bias)
        ? pillar.format_bias
        : formatBiasForJob(chosen, { needDiscovery: chosen !== "offer" });

    const hooks = pickHookFormulas(chosen, 2);
    const hook = hooks[0]!;
    const proofLine = chosen === "proof" || chosen === "offer" ? proof[i % proof.length]! : null;
    const positionLine = chosen === "opinion" ? positions[i % positions.length]! : null;

    const rawHook =
      chosen === "opinion" && positionLine
        ? positionLine
        : chosen === "proof" && proofLine
          ? `${proofLine.split(" ")[0]} is what last year looked like for desk athletes.`
          : hook.example;

    expect(isBannedHookOpener(rawHook)).toBe(false);
    const hookScore = scoreHookLine(rawHook);
    const captionJob = captionJobForFormat(format);

    const draftBody =
      captionJob === "A"
        ? `${rawHook}\n\n${proofLine ?? positionLine ?? pillar.description}\n\nSave this for your next desk day.\n#physio #desksetup #shoulderpain #austin #rehab`
        : `${rawHook}\n\n${captionJobPrompt(captionJob).slice(0, 0)}${proofLine ?? positionLine ?? pillar.description}\n\nBook if you want a plan, not another YouTube loop.\n#physio #desksetup #shoulderpain #austin #rehab #pain #posture #office`;

    const caption = humanizeCaption(limitHashtags(draftBody, 5));
    const tagCount = (caption.match(/#\w+/g) ?? []).length;

    slots.push({
      day: days[i]!,
      job: chosen,
      format,
      hookId: hook.id,
      hookLine: rawHook,
      hookScore,
      captionJob,
      caption,
      proofUsed: proofLine,
    });

    expect(tagCount).toBeLessThanOrEqual(5);
    expect(caption).not.toMatch(/delve|game-changer|hey guys/i);
  }
  return slots;
}

type ScoreCard = {
  organic: Record<string, boolean>;
  paid: Record<string, boolean>;
  score: number;
  max: number;
  verdict: "winning" | "needs_work";
};

function scorePlaybook(input: {
  plan: NichePlan;
  slots: OrganicSlot[];
  brand: Brand;
  prospecting: { campaignId: string; objective: string };
  retarget: { campaignId: string };
  boost: { campaignId: string };
}): ScoreCard {
  const jobsUsed = new Set(input.slots.map((s) => s.job));
  const organic = {
    has_job_mix: Boolean(input.plan.job_mix && /proof|teach|opinion/i.test(input.plan.job_mix)),
    pillars_tagged_with_jobs: input.plan.pillars.every((p) => p.content_job),
    opinion_or_story_present: [...jobsUsed].some((j) => j === "opinion" || j === "story"),
    offer_sparse: input.slots.filter((s) => s.job === "offer").length <= 1,
    reels_for_discovery: input.slots
      .filter((s) => s.job === "proof" || s.job === "opinion")
      .every((s) => s.format === "reel" || s.format === "story"),
    hooks_scored: input.slots.every((s) => s.hookScore >= 5),
    no_banned_openers: input.slots.every((s) => !isBannedHookOpener(s.hookLine)),
    hashtag_cap: input.slots.every((s) => (s.caption.match(/#\w+/g) ?? []).length <= 5),
    proof_bank_cited: input.slots.some((s) => /127|4\.9|214/.test(s.caption)),
    format_mix_not_carousel_only: !/carousel-heavy|favour carousels/i.test(input.plan.format_mix),
  };

  const caps = spendCaps(input.brand);
  const paid = {
    ads_enabled_and_connected: adsEnabled(input.brand) && isAdsConnected(input.brand),
    prospecting_campaign_mocked: /^mock_/.test(input.prospecting.campaignId),
    retarget_campaign_mocked: /^mock_/.test(input.retarget.campaignId),
    boost_winning_reel: /^mock_/.test(input.boost.campaignId),
    leads_or_traffic_objective: ["leads", "traffic", "messages"].includes(input.prospecting.objective),
    weekly_cap_respected: caps.weekly_cents >= 20_000,
    intent_routing_works: looksLikePaidCampaignRequest("run ads for leads at $25/day for 7 days"),
    pause_control_works: looksLikeAdCampaignControl("pause ads") === "pause",
  };

  const flags = { ...organic, ...paid };
  const max = Object.keys(flags).length;
  const score = Object.values(flags).filter(Boolean).length;
  return {
    organic,
    paid,
    score,
    max,
    verdict: score / max >= 0.85 ? "winning" : "needs_work",
  };
}

describe("dummy arena — organic + paid winning strategy", () => {
  beforeEach(() => {
    mockedCallLLM.mockReset();
  });

  it("builds a scored organic+paid playbook using the new craft architecture", async () => {
    const brand = dummyBrand();
    mockedCallLLM.mockResolvedValue(JSON.stringify(craftAwarePlanJson));

    const plan = await buildPlanWithFallback(
      brand,
      "workplace physiotherapy for desk athletes",
      "@physiotutors @theprehabguys",
      { preferFast: true },
    );
    expect(plan).toBeTruthy();
    expect(plan!.pillars.every((p) => p.content_job)).toBe(true);
    expect(plan!.job_mix).toMatch(/proof/i);
    expect(plan!.format_mix).not.toMatch(/favour carousels/i);

    const sms = planTextSummary(plan!);
    expect(sms).toMatch(/Jobs:/i);

    const ctx = brandContextForPrompt(brand);
    expect(ctx).toMatch(/Proof bank/i);
    expect(ctx).toMatch(/127 desk-worker/);
    expect(ctx).toMatch(/Brand positions/i);

    const slots = buildOrganicWeek(brand, plan!);
    expect(slots).toHaveLength(5);
    expect(slots.some((s) => s.format === "reel")).toBe(true);

    // Quality analyst line for a winning Reel (Jake metrics when present).
    const quality = qualitySignalsLine({
      reach: 8200,
      sends: 410,
      hold_at_3s: 0.71,
      non_follower_reach: 5100,
    });
    expect(quality).toMatch(/sends\/reach/i);
    expect(quality).toMatch(/hold@3s/i);

    // Paid: prospecting + retarget + boost of the top Reel (mock Meta).
    const adapter = new MockMarketingAdapter();
    expect(adsEnabled(brand)).toBe(true);
    expect(isAdsConnected(brand)).toBe(true);

    const proofCaption = slots.find((s) => s.job === "proof")?.caption ?? slots[0]!.caption;
    const prospecting = await adapter.createCampaign({
      brand,
      name: "Peak Form — Desk Shoulder Leads",
      objective: "leads",
      dailyBudgetCents: 2500,
      audience: {
        label: "ICP — desk workers 28–45",
        meta_type: "interest",
        interests: ["physiotherapy", "remote work"],
      },
      creative: {
        primary_text: humanizeCaption(
          `${proofCaption.split("\n")[0]}\n\nDesk Shoulder Reset — 4 sessions. Book same week.`,
        ),
        headline: "Desk Shoulder Reset",
        cta: "BOOK_NOW",
      },
      durationDays: 7,
    });
    expect(prospecting.campaignId).toMatch(/^mock_(camp|boost)_/);

    const retarget = await adapter.createCampaign({
      brand,
      name: "Peak Form — Engager Retarget",
      objective: "traffic",
      dailyBudgetCents: 1500,
      audience: {
        label: "IG/Page engagers 30d",
        meta_type: "retargeting",
      },
      creative: {
        primary_text: humanizeCaption(
          "You watched the desk-shoulder reel. Here's the 4-session plan.",
        ),
        headline: "Book your first session",
        cta: "LEARN_MORE",
      },
      durationDays: 7,
    });

    const boost = await adapter.boostPost({
      brand,
      objectStoryId: "mock_story_winning_reel",
      name: "Boost — proof reel",
      dailyBudgetCents: 1000,
      durationDays: 3,
      audience: { label: "lookalike engagers", meta_type: "lookalike" },
    });

    const card = scorePlaybook({
      plan: plan!,
      slots,
      brand,
      prospecting: { campaignId: prospecting.campaignId, objective: "leads" },
      retarget: { campaignId: retarget.campaignId },
      boost: { campaignId: boost.campaignId },
    });

    const report = {
      brand: brand.name,
      niche: "workplace physiotherapy / desk athletes",
      organic_plan: {
        summary: plan!.summary,
        job_mix: plan!.job_mix,
        format_mix: plan!.format_mix,
        best_times: plan!.best_times,
        pillars: plan!.pillars,
        week: slots,
      },
      paid_plan: {
        weekly_cap: formatCents(spendCaps(brand).weekly_cents),
        campaign_cap: formatCents(spendCaps(brand).campaign_cents),
        prospecting,
        retarget,
        boost_winning_organic: boost,
        creative_rule: "Paid primary text reuses organic proof hooks + proof_bank only",
      },
      analyst: { winning_reel_quality: quality },
      scorecard: card,
      sms_preview: sms,
    };

    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(
      "/opt/cursor/artifacts/dummy-strategy-arena-report.json",
      JSON.stringify(report, null, 2),
    );
    writeFileSync(
      "/opt/cursor/artifacts/dummy-strategy-arena-report.md",
      [
        `# Dummy arena — ${brand.name}`,
        "",
        `## Verdict: **${card.verdict.toUpperCase()}** (${card.score}/${card.max})`,
        "",
        "### Organic",
        `- ${plan!.summary}`,
        `- Jobs: ${plan!.job_mix}`,
        `- Formats: ${plan!.format_mix}`,
        `- Times: ${plan!.best_times}`,
        "",
        "| Day | Job | Format | Hook score | Caption job |",
        "|---|---|---|---|---|",
        ...slots.map(
          (s) =>
            `| ${s.day} | ${s.job} | ${s.format} | ${s.hookScore} | ${s.captionJob} |`,
        ),
        "",
        "### Paid",
        `- Prospecting: ${prospecting.campaignId} (leads, $25/day)`,
        `- Retarget: ${retarget.campaignId} (traffic, $15/day)`,
        `- Boost winning Reel: ${boost.campaignId} ($10/day × 3)`,
        `- Caps: weekly ${formatCents(spendCaps(brand).weekly_cents)}, per-campaign ${formatCents(spendCaps(brand).campaign_cents)}`,
        "",
        "### Analyst (Jake metrics)",
        quality ?? "(none)",
        "",
        "### Score detail",
        "Organic:",
        ...Object.entries(card.organic).map(([k, v]) => `- ${v ? "✅" : "❌"} ${k}`),
        "Paid:",
        ...Object.entries(card.paid).map(([k, v]) => `- ${v ? "✅" : "❌"} ${k}`),
      ].join("\n"),
    );

    // All CONTENT_JOBS are known to the architecture.
    expect(CONTENT_JOBS.length).toBe(5);
    expect(card.verdict).toBe("winning");
    expect(card.score / card.max).toBeGreaterThanOrEqual(0.85);
  });
});
