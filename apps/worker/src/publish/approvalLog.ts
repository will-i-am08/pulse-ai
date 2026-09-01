import type { SupabaseClient } from "@supabase/supabase-js";
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
export async function writeApprovalLog(supabase: SupabaseClient, entry: ApprovalLogInput): Promise<void> {
  const { error } = await supabase.from("approval_log").insert({
    post_id: entry.postId,
    brand_id: entry.brandId,
    action: entry.action,
    actor: entry.actor ?? "system",
    before: entry.before ?? null,
    after: entry.after ?? null,
    note: entry.note ?? null,
  });
  if (error) throw new Error(`writeApprovalLog failed: ${error.message}`);
}
