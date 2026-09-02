import { queryOne } from "@pulse/shared";

/**
 * Approval is absolute: never publish a post without a logged `approved` action.
 * This is the runtime assertion the worker checks immediately before every publish.
 */
export async function hasApprovedLog(postId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `select id from approval_log where post_id = $1 and action = $2 limit 1`,
    [postId, "approved"],
  );
  return row !== null;
}
