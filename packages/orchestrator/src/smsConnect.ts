import { smsConnectUrl, type Brand } from "@pulse/shared";
import { adsEnabled, isAdsConnected, brandFeatures } from "./adsFeatures.js";

export function isMetaConnected(brand: Brand): boolean {
  return Boolean(brand.ig_user_id && brand.fb_page_id && brand.platform_tokens_encrypted);
}

export function metaConnectStatusMessage(brand: Brand): string {
  const lines: string[] = [];
  if (isMetaConnected(brand)) {
    const ig = brand.ig_username ? `@${brand.ig_username}` : "Instagram";
    const fb = brand.fb_page_name ? brand.fb_page_name : "Facebook";
    lines.push(`Publishing: ${ig} + ${fb}.`);
  } else {
    lines.push("Instagram and Facebook aren't connected yet.");
  }
  if (isAdsConnected(brand)) {
    const name = brand.ad_account_name ?? brand.ad_account_id ?? "ad account";
    lines.push(`Ad account: ${name} (${adsEnabled(brand) ? "ads on" : "ads connected but feature off"}).`);
  } else {
    lines.push("Ad account: not connected.");
  }
  return lines.join(" ");
}

export function connectLinkMessage(brand: Brand, purpose: "meta" | "ads"): string {
  if (purpose === "ads") {
    if (isAdsConnected(brand)) {
      const link = smsConnectUrl(brand.id, "ads");
      const name = brand.ad_account_name ?? brand.ad_account_id ?? "your ad account";
      const flag = adsEnabled(brand) ? "Ads are on." : 'Ads feature is off — say "enable ads" to spend.';
      return `You're linked to ${name}. ${flag}\n\nTo reconnect a different ad account, tap this (expires in 15 min):\n${link}`;
    }
    const link = smsConnectUrl(brand.id, "ads");
    return `One tap to connect your Meta ad account — I'll text you when it's linked:\n${link}\n\n(Link expires in 15 minutes. If it does, just ask me again.)`;
  }
  if (isMetaConnected(brand)) {
    const link = smsConnectUrl(brand.id, "meta");
    return `${metaConnectStatusMessage(brand)}\n\nTo reconnect with a different account, tap this (expires in 15 min):\n${link}`;
  }
  const link = smsConnectUrl(brand.id, "meta");
  return `One tap to connect Instagram + Facebook — I'll take it from there:\n${link}\n\n(Link expires in 15 minutes. If it does, just ask me again and I'll send a fresh one.)`;
}

export function looksLikeAdsToggle(body: string): "enable" | "disable" | null {
  if (/\b(enable|turn on|switch on|start)\b.{0,20}\bads\b|\bads\b.{0,20}\b(on|enabled)\b/i.test(body)) return "enable";
  if (/\b(disable|turn off|switch off|stop)\b.{0,20}\bads\b|\bads\b.{0,20}\b(off|disabled)\b/i.test(body)) return "disable";
  return null;
}

export function adsFeatureStatusLine(brand: Brand): string {
  const f = brandFeatures(brand);
  const connected = isAdsConnected(brand);
  if (f.ads && connected) return "Ads are on and your ad account is connected.";
  if (f.ads && !connected) return 'Ads are on, but no ad account yet — say "connect ad account" for a link.';
  if (!f.ads && connected) return 'Ad account is connected; ads feature is off. Say "enable ads" to allow spend.';
  return 'Ads are off. Say "enable ads" then "connect ad account" when you\'re ready.';
}
