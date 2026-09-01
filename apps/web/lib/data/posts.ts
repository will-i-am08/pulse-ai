import 'server-only';
import { serviceClient } from '@pulse/shared';
import type { Post, PostStatus } from '@pulse/shared';

export async function listPostsByStatus(brandId: string, statuses: PostStatus[]): Promise<Post[]> {
  const { data, error } = await serviceClient()
    .from('posts')
    .select('*')
    .eq('brand_id', brandId)
    .in('status', statuses)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listPostsByStatus: ${error.message}`);
  return (data ?? []) as Post[];
}

export async function getPost(postId: string): Promise<Post | null> {
  const { data, error } = await serviceClient().from('posts').select('*').eq('id', postId).maybeSingle();
  if (error) throw new Error(`getPost: ${error.message}`);
  return (data as Post | null) ?? null;
}

export async function updatePost(postId: string, patch: Partial<Post>): Promise<void> {
  const { error } = await serviceClient().from('posts').update(patch).eq('id', postId);
  if (error) throw new Error(`updatePost: ${error.message}`);
}
