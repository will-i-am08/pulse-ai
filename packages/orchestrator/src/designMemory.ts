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
