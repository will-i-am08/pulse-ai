import { query } from "@pulse/shared";
import type { ApprovalAction } from "@pulse/shared";

export interface ApprovalLogInput {
  postId: string | null;
  brandId: string;
  action: ApprovalAction;
  actor?: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}

/** Every draft/approval/edit/publish/failure gets an approval_log row (auditability). */
export async function writeApprovalLog(entry: ApprovalLogInput): Promise<void> {
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, before, after, note)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      entry.postId,
      entry.brandId,
      entry.action,
      entry.actor ?? "system",
      entry.before !== undefined ? JSON.stringify(entry.before) : null,
      entry.after !== undefined ? JSON.stringify(entry.after) : null,
      entry.note ?? null,
    ],
  );
}
