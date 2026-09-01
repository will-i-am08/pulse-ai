import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Approval is absolute: never publish a post without a logged `approved` action.
 * This is the runtime assertion the worker checks immediately before every publish.
 */
export async function hasApprovedLog(supabase: SupabaseClient, postId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("approval_log")
    .select("id")
    .eq("post_id", postId)
    .eq("action", "approved")
    .limit(1);
  if (error) throw new Error(`hasApprovedLog failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}
