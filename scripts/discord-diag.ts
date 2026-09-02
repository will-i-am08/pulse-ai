import { Client, GatewayIntentBits, PermissionsBitField } from "discord.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`bot: ${client.user?.tag} | guilds: ${client.guilds.cache.size}`);
  for (const g of client.guilds.cache.values()) {
    console.log(`GUILD "${g.name}" (${g.id})`);
    const me = await g.members.fetchMe().catch(() => null);
    const chans = await g.channels.fetch().catch(() => null);
    if (!chans) { console.log("  (could not fetch channels)"); continue; }
    for (const ch of chans.values()) {
      if (!ch) continue;
      const canSend =
        me && "permissionsFor" in ch
          ? ch.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages)
            ? "SEND=yes"
            : "SEND=no"
          : "n/a";
      console.log(`  · #${ch.name} [type=${ch.type}] textBased=${ch.isTextBased?.() ?? false} ${canSend}`);
    }
  }
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
