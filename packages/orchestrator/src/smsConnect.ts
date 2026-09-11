import { smsConnectUrl, type Brand } from "@pulse/shared";

/** True when IG + FB page tokens are already linked for publishing. */
export function isMetaConnected(brand: Brand): boolean {
  return Boolean(brand.ig_user_id && brand.fb_page_id && brand.platform_tokens_encrypted);
}

/** Human status of Meta connection for SMS. */
export function metaConnectStatusMessage(brand: Brand): string {
  if (isMetaConnected(brand)) {
    const ig = brand.ig_username ? `@${brand.ig_username}` : "Instagram";
    const fb = brand.fb_page_name ? brand.fb_page_name : "Facebook";
    return `You're already connected: ${ig} + ${fb}. Say "reconnect Instagram" if you want to switch accounts.`;
  }
  return "Instagram and Facebook aren't connected yet.";
}

/**
 * Build the one-tap SMS deep-link reply for Meta connect / reconnect.
 * Ads purpose is scaffolded for Phase F.
 */
export function connectLinkMessage(brand: Brand, purpose: "meta" | "ads"): string {
  if (purpose === "ads") {
    const link = smsConnectUrl(brand.id, "ads");
    return (
      `Ad account connect isn't live yet, but here's your reserved link for when it is:\n${link}\n\n` +
      `I'll text you when ads are ready to switch on.`
    );
  }
  if (isMetaConnected(brand)) {
    const link = smsConnectUrl(brand.id, "meta");
    return (
      `${metaConnectStatusMessage(brand)}\n\n` +
      `To reconnect with a different account, tap this (expires in 15 min):\n${link}`
    );
  }
  const link = smsConnectUrl(brand.id, "meta");
  return (
    `One tap to connect Instagram + Facebook — I'll take it from there:\n${link}\n\n` +
    `(Link expires in 15 minutes. If it does, just ask me again and I'll send a fresh one.)`
  );
}
