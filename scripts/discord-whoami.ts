import { Client, GatewayIntentBits } from "discord.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once("ready", async () => {
  for (const g of client.guilds.cache.values()) {
    let tag = "";
    try {
      const owner = await g.fetchOwner();
      tag = owner.user.tag;
    } catch {
      /* ignore */
    }
    console.log(`GUILD "${g.name}" ownerId=${g.ownerId} owner=${tag}`);
  }
  process.exit(0);
});
client.login(process.env.DISCORD_BOT_TOKEN);
