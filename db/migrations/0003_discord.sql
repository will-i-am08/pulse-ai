-- 0003_discord.sql — Discord as an interim messaging channel.
-- A brand can be addressed over Discord (a channel/DM id) as well as by phone.

alter table brands add column if not exists discord_channel_id text;
create index if not exists idx_brands_discord on brands (discord_channel_id);
