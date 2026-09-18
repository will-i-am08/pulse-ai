import 'server-only';
import { query } from '@pulse/shared';

export type SmsLeadSourceStat = {
  source: string;
  leads: number;
  converted: number;
};

/** Distinct campaign slugs that have actually texted in. Empty if the table isn't there yet. */
export async function listSmsLeadSources(): Promise<SmsLeadSourceStat[]> {
  try {
    return await query<SmsLeadSourceStat>(
      `select source,
              count(*)::int as leads,
              count(*) filter (where converted_at is not null)::int as converted
         from sms_leads
        where source is not null and source <> ''
        group by source
        order by leads desc, source asc`,
    );
  } catch (err) {
    console.warn('listSmsLeadSources: skipped', err instanceof Error ? err.message : err);
    return [];
  }
}
