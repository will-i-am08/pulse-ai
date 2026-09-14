import {
  query,
  type DesignMemoryKind,
  type DesignMemoryRef,
  type DesignMemoryStatus,
} from "@pulse/shared";

/** Persist a reference to an approved/published creative for design memory. */
export async function storeDesignMemoryRef(input: {
  brandId: string;
  mediaId?: string | null;
  postId?: string | null;
  kind?: DesignMemoryKind;
  status?: DesignMemoryStatus;
  notes?: string | null;
  score?: number | null;
}): Promise<DesignMemoryRef | null> {
  return queryOneDesign(
    `insert into design_memory (brand_id, media_id, post_id, kind, status, notes, score)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      input.brandId,
      input.mediaId ?? null,
      input.postId ?? null,
      input.kind ?? "creative",
      input.status ?? "approved",
      input.notes ?? null,
      input.score ?? null,
    ],
  );
}

function memoryKindForPost(format?: string | null): DesignMemoryKind {
  if (format === "carousel") return "carousel_slide";
  if (format === "story") return "story";
  return "creative";
}

/** Compact JSON-ish notes for approved creative learning (≤200 chars). */
export function buildApprovedCreativeMemoryNotes(opts: {
  post: {
    caption?: string | null;
    style_meta?: Record<string, unknown> | null;
  };
  source: "sms" | "dashboard" | "calendar";
}): string {
  const meta = opts.post.style_meta ?? {};
  const caption = (opts.post.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const payload: Record<string, unknown> = {
    source: opts.source,
    caption,
  };
  if (meta.photo_carousel === true) payload.photo_carousel = true;
  if (meta.researched_ideas != null) payload.researched_ideas = meta.researched_ideas;
  let notes = JSON.stringify(payload);
  if (notes.length > 200) {
    payload.caption = caption.slice(0, Math.max(0, 80 - (notes.length - 200)));
    notes = JSON.stringify(payload).slice(0, 200);
  }
  return notes;
}

/**
 * On approval, remember cover media — and for carousels with ≥3 slides, also the mid slide.
 * Non-throwing; at most two storeDesignMemoryRef calls.
 */
export async function recordApprovedCreativeMemory(opts: {
  brandId: string;
  post: {
    id: string;
    format?: string | null;
    caption?: string | null;
    media_ids?: string[] | null;
    style_meta?: Record<string, unknown> | null;
  };
  source: "sms" | "dashboard" | "calendar";
}): Promise<void> {
  try {
    const mediaIds = (opts.post.media_ids ?? []).filter(Boolean);
    if (!mediaIds.length) return;

    const kind = memoryKindForPost(opts.post.format);
    const notes = buildApprovedCreativeMemoryNotes({
      post: opts.post,
      source: opts.source,
    });

    const indices = [0];
    if (opts.post.format === "carousel" && mediaIds.length >= 3) {
      indices.push(Math.floor(mediaIds.length / 2));
    }

    for (const idx of indices) {
      const mediaId = mediaIds[idx];
      if (!mediaId) continue;
      await storeDesignMemoryRef({
        brandId: opts.brandId,
        mediaId,
        postId: opts.post.id,
        kind,
        status: "approved",
        notes,
      });
    }
  } catch {
    /* non-blocking design-memory learn */
  }
}

/** Recent visual refs for a brand (newest first). */
export async function listRecentDesignMemory(
  brandId: string,
  limit = 8,
): Promise<DesignMemoryRef[]> {
  return query<DesignMemoryRef>(
    `select * from design_memory
      where brand_id = $1
      order by created_at desc
      limit $2`,
    [brandId, Math.max(1, Math.min(40, limit))],
  );
}

/** Top-scoring visual refs (falls back to recent when scores are null). */
export async function listTopDesignMemory(
  brandId: string,
  limit = 6,
): Promise<DesignMemoryRef[]> {
  return query<DesignMemoryRef>(
    `select * from design_memory
      where brand_id = $1
      order by score desc nulls last, created_at desc
      limit $2`,
    [brandId, Math.max(1, Math.min(40, limit))],
  );
}

/** Mark a design-memory row as top / published / approved. */
export async function updateDesignMemoryStatus(
  id: string,
  status: DesignMemoryStatus,
  score?: number | null,
): Promise<void> {
  if (score == null) {
    await query(`update design_memory set status = $2 where id = $1`, [id, status]);
  } else {
    await query(`update design_memory set status = $2, score = $3 where id = $1`, [
      id,
      status,
      score,
    ]);
  }
}

async function queryOneDesign(
  sql: string,
  params: unknown[],
): Promise<DesignMemoryRef | null> {
  const rows = await query<DesignMemoryRef>(sql, params);
  return rows[0] ?? null;
}
