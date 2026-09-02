// One-off: send a proactive check-in to the first channel the bot can post in.
// Proves message-first (the weekly check-in the agent sends unprompted).
import { Client, GatewayIntentBits } from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN not set");
  process.exit(1);
}

const MESSAGE =
  "👋 Hey Will — it's your Pulse agent. Anything to post this week? " +
  "Send me a photo and I'll draft a caption in your brand's voice; reply “yes” and it goes live.";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  let sent = false;
  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch();
    for (const ch of channels.values()) {
      if (!ch || !ch.isTextBased() || !("send" in ch)) continue;
      try {
        await (ch as { send: (s: string) => Promise<unknown> }).send(MESSAGE);
        console.log(`SENT to #${(ch as { name?: string }).name ?? "?"} in "${guild.name}"`);
        sent = true;
        break;
      } catch {
        // no permission in this channel — try the next
      }
    }
    if (sent) break;
  }
  if (!sent) {
    console.log("NO_CHANNEL: the bot isn't in a server with a channel it can post to yet — invite it first.");
  }
  process.exit(sent ? 0 : 2);
});

client.login(token);
