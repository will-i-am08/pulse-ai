import 'server-only';
import { query, type Message } from '@pulse/shared';

/**
 * The owner ↔ Kip thread for a brand, oldest → newest, capped to the most
 * recent `limit`. Inbound = the owner; outbound = Kip.
 */
export async function listRecentMessages(brandId: string, limit = 40): Promise<Message[]> {
  const rows = await query<Message>(
    `select * from messages
      where brand_id = $1
      order by created_at desc
      limit $2`,
    [brandId, String(limit)],
  );
  return rows.reverse();
}
