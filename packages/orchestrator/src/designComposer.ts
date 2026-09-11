import { randomUUID } from "node:crypto";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import {
  query,
  putMedia,
  type Brand,
  type DesignMemoryRef,
  type VisualExemplar,
} from "@pulse/shared";
import { anton as ANTON, serif as SERIF } from "./assets/fonts.generated.js";
import { resolveBrandPalette } from "./imaging.js";
import { listRecentDesignMemory, listTopDesignMemory } from "./designMemory.js";
import { listVisualExemplars } from "./research.js";
import { ensureNicheExemplarBootstrap } from "./designBootstrap.js";
import { routeImageJob } from "./modelRouter.js";

/**
 * Phase C7 — context-driven design composer.
 * Brand tokens stay stable (DNA). Composition primitives vary so tip/offer
 * carousels are not N identical dark cards. Cold-start: when design memory is
 * empty, lean on niche exemplars + brand tokens (bootstrap rule).
 */

export type SlideRole = "hook" | "tip" | "step" | "before" | "after" | "menu" | "offer" | "cta" | "body";

/** Layout primitives — reusable building blocks, not named theme packs. */
export type LayoutPrimitive =
  | "centered_stack"
  | "bottom_band"
  | "top_masthead"
  | "numbered_tip"
  | "split_offer"
  | "editorial_quote";

export type ComposeSlideInput = {
  brand: Brand;
  text: string;
  role: SlideRole;
  index: number;
  total: number;
  /** Force a layout; otherwise pick with variation against recent. */
  layout?: LayoutPrimitive;
  /** Recent layouts from this carousel / brand — avoid near-duplicates. */
  recentLayouts?: LayoutPrimitive[];
  width?: number;
  height?: number;
};

export type DesignContext = {
  brand: Brand;
  ownMemory: DesignMemoryRef[];
  topMemory: DesignMemoryRef[];
  nicheExemplars: VisualExemplar[];
  /** True when we have no own design memory — composer must bootstrap. */
  coldStart: boolean;
  bootstrapNotes: string;
};

const ALL_LAYOUTS: LayoutPrimitive[] = [
  "centered_stack",
  "bottom_band",
  "top_masthead",
  "numbered_tip",
  "split_offer",
  "editorial_quote",
];

/** Prefer layouts that differ from the last few — brand DNA stays via palette/fonts. */
export function pickLayoutVariant(
  recent: LayoutPrimitive[] = [],
  role?: SlideRole,
): LayoutPrimitive {
  const avoid = new Set(recent.slice(-3));
  let pool = ALL_LAYOUTS.filter((l) => !avoid.has(l));
  if (pool.length === 0) pool = [...ALL_LAYOUTS];

  // Soft role bias (still varied — not a frozen template).
  if (role === "hook" || role === "cta") {
    const preferred = pool.filter((l) => l === "centered_stack" || l === "top_masthead" || l === "editorial_quote");
    if (preferred.length) pool = preferred;
  } else if (role === "step" || role === "tip") {
    const preferred = pool.filter((l) => l === "numbered_tip" || l === "bottom_band" || l === "centered_stack");
    if (preferred.length) pool = preferred;
  } else if (role === "offer" || role === "menu") {
    const preferred = pool.filter((l) => l === "split_offer" || l === "bottom_band" || l === "top_masthead");
    if (preferred.length) pool = preferred;
  } else if (role === "before" || role === "after") {
    const preferred = pool.filter((l) => l === "bottom_band" || l === "top_masthead" || l === "centered_stack");
    if (preferred.length) pool = preferred;
  }

  return pool[Math.floor(Math.random() * pool.length)] ?? "centered_stack";
}

/** Stable-enough hash so consecutive carousels still vary without Math.random in tests. */
export function layoutForIndex(
  index: number,
  total: number,
  recent: LayoutPrimitive[] = [],
  role?: SlideRole,
): LayoutPrimitive {
  const avoid = new Set(recent.slice(-3));
  let pool = ALL_LAYOUTS.filter((l) => !avoid.has(l));
  if (pool.length === 0) pool = [...ALL_LAYOUTS];
  if (role === "hook") {
    const p = pool.filter((l) => l !== "numbered_tip");
    if (p.length) pool = p;
  }
  // Deterministic walk so one carousel gets distinct slides.
  return pool[(index + total * 3) % pool.length] ?? pool[0]!;
}

/** Gather own memory + niche exemplars for the composer (cold-start aware). */
export async function gatherDesignContext(brand: Brand): Promise<DesignContext> {
  let nicheExemplars = await listVisualExemplars(brand.id, 8).catch(() => [] as VisualExemplar[]);
  const [ownMemory, topMemory] = await Promise.all([
    listRecentDesignMemory(brand.id, 6).catch(() => [] as DesignMemoryRef[]),
    listTopDesignMemory(brand.id, 4).catch(() => [] as DesignMemoryRef[]),
  ]);
  const coldStart = ownMemory.length === 0 && topMemory.length === 0;
  if (coldStart && nicheExemplars.length < 3) {
    await ensureNicheExemplarBootstrap(brand);
    nicheExemplars = await listVisualExemplars(brand.id, 8).catch(() => nicheExemplars);
  }
  const tokens = brand.visual ?? {};
  const bootstrapNotes = coldStart
    ? [
        "COLD-START bootstrap: no design memory yet.",
        "Use brand tokens (colours/fonts/aesthetic) as identity through-line.",
        nicheExemplars.length
          ? `Niche exemplars available (${nicheExemplars.length}) — compose in that category's range, do not clone one competitor.`
          : "No niche exemplars yet — compose from brand tokens alone with varied primitives.",
        tokens.aesthetic ? `Aesthetic: ${tokens.aesthetic}.` : "",
        tokens.photo_treatment ? `Photo treatment: ${tokens.photo_treatment}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : [
        `Own design memory: ${ownMemory.length} recent, ${topMemory.length} top.`,
        nicheExemplars.length ? `Niche exemplars: ${nicheExemplars.length}.` : "No niche exemplars.",
        "Match brand bar; vary composition vs last slides.",
      ].join(" ");

  return { brand, ownMemory, topMemory, nicheExemplars, coldStart, bootstrapNotes };
}

function roleLabel(role: SlideRole, index: number): string {
  if (role === "before") return "BEFORE";
  if (role === "after") return "AFTER";
  if (role === "step") return `STEP ${index}`;
  if (role === "tip") return `${index}`;
  if (role === "menu") return "MENU";
  if (role === "offer") return "OFFER";
  if (role === "cta") return "NEXT";
  if (role === "hook") return "NOW";
  return "";
}

/** Render one designed slide via Satori primitives + brand palette. */
export async function composeSlide(input: ComposeSlideInput): Promise<Buffer> {
  // Router documents the decision (composer path for designed text).
  routeImageJob("designed_slide");

  const layout =
    input.layout ??
    layoutForIndex(input.index, input.total, input.recentLayouts ?? [], input.role);
  const palette = resolveBrandPalette(input.brand.visual);
  const width = input.width ?? 1080;
  const height = input.height ?? 1080;
  const pad = Math.round(width * 0.1);
  const label = roleLabel(input.role, input.index + 1);
  const masthead = input.brand.name.toUpperCase();
  const text = input.text.trim();
  const fontSize = Math.round(
    width * (text.length > 90 ? 0.048 : text.length > 50 ? 0.062 : text.length > 28 ? 0.078 : 0.095),
  );

  type Node = Record<string, unknown>;
  const children: Node[] = [];

  if (layout === "top_masthead" || layout === "editorial_quote") {
    children.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          color: palette.muted,
          fontFamily: palette.bodyFont,
          fontSize: `${Math.round(width * 0.032)}px`,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          marginBottom: `${Math.round(height * 0.06)}px`,
        },
        children: masthead,
      },
    });
  }

  if (label && (layout === "numbered_tip" || layout === "split_offer" || layout === "bottom_band")) {
    children.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          color: palette.muted,
          fontFamily: palette.displayFont,
          fontSize: `${Math.round(width * 0.045)}px`,
          letterSpacing: "0.08em",
          marginBottom: `${Math.round(height * 0.04)}px`,
        },
        children: label,
      },
    });
  }

  if (layout === "split_offer") {
    children.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          width: `${Math.round(width * 0.18)}px`,
          height: "4px",
          background: palette.text,
          marginBottom: `${Math.round(height * 0.05)}px`,
        },
        children: "",
      },
    });
  }

  children.push({
    type: "div",
    props: {
      style: {
        display: "flex",
        color: palette.text,
        fontFamily: layout === "editorial_quote" ? palette.bodyFont : palette.displayFont,
        fontSize: `${fontSize}px`,
        lineHeight: layout === "editorial_quote" ? 1.25 : 1.08,
        textAlign: layout === "bottom_band" ? "left" : "center",
        textTransform: layout === "editorial_quote" ? "none" : "uppercase",
        maxWidth: `${Math.round(width * 0.82)}px`,
      },
      children: text,
    },
  });

  if (layout !== "top_masthead" && layout !== "editorial_quote") {
    children.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          position: "absolute",
          bottom: `${pad}px`,
          color: palette.muted,
          fontFamily: palette.displayFont,
          fontSize: `${Math.round(width * 0.028)}px`,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        },
        children: masthead,
      },
    });
  }

  const justify =
    layout === "bottom_band" ? "flex-end" : layout === "top_masthead" ? "flex-start" : "center";
  const align = layout === "bottom_band" ? "flex-start" : "center";

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          width: `${width}px`,
          height: `${height}px`,
          background: `linear-gradient(${layout === "editorial_quote" ? "160deg" : "145deg"}, ${palette.bgFrom}, ${palette.bgTo})`,
          padding: `${pad}px`,
          alignItems: align,
          justifyContent: justify,
          textAlign: layout === "bottom_band" ? "left" : "center",
          position: "relative",
        },
        children,
      },
    } as unknown as Parameters<typeof satori>[0],
    {
      width,
      height,
      fonts: [
        { name: "Anton", data: ANTON, weight: 400, style: "normal" },
        { name: "Playfair", data: SERIF, weight: 700, style: "normal" },
      ],
    },
  );

  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  const sharp = (await import("sharp")).default;
  return sharp(png).jpeg({ quality: 88 }).toBuffer();
}

/** Compose + store a slide; returns media id. */
export async function composeAndStoreSlide(
  brand: Brand,
  text: string,
  opts: {
    role: SlideRole;
    index: number;
    total: number;
    recentLayouts?: LayoutPrimitive[];
    layout?: LayoutPrimitive;
    width?: number;
    height?: number;
  },
): Promise<{ mediaId: string; layout: LayoutPrimitive }> {
  const layout =
    opts.layout ?? layoutForIndex(opts.index, opts.total, opts.recentLayouts ?? [], opts.role);
  const buf = await composeSlide({
    brand,
    text,
    role: opts.role,
    index: opts.index,
    total: opts.total,
    layout,
    recentLayouts: opts.recentLayouts,
    width: opts.width,
    height: opts.height,
  });
  const id = randomUUID();
  await query(
    `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
     values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
    [id, brand.id, id],
  );
  await putMedia(id, new Uint8Array(buf), "image/jpeg");
  return { mediaId: id, layout };
}

/** Roles for a typed carousel kind. */
export function rolesForCarouselKind(
  kind: "tip" | "before_after" | "steps" | "menu_offer",
  count: number,
): SlideRole[] {
  if (kind === "before_after") {
    return ["hook", "before", "after", "cta"].slice(0, Math.max(2, count)) as SlideRole[];
  }
  if (kind === "steps") {
    const roles: SlideRole[] = ["hook"];
    for (let i = 1; i < count - 1; i++) roles.push("step");
    if (count > 1) roles.push("cta");
    return roles.slice(0, count);
  }
  if (kind === "menu_offer") {
    const roles: SlideRole[] = ["hook"];
    for (let i = 1; i < count - 1; i++) roles.push(i % 2 === 0 ? "menu" : "offer");
    if (count > 1) roles.push("cta");
    return roles.slice(0, count);
  }
  // tip
  const roles: SlideRole[] = ["hook"];
  for (let i = 1; i < count - 1; i++) roles.push("tip");
  if (count > 1) roles.push("cta");
  return roles.slice(0, count);
}
