import { smsConnectUrl, type Brand, platformLabel } from "@pulse/shared";
import { adsEnabled, isAdsConnected, brandFeatures } from "./adsFeatures.js";

export function isMetaConnected(brand: Brand): boolean {
  return Boolean(brand.ig_user_id && brand.fb_page_id && brand.platform_tokens_encrypted);
}

/** OAuth finished but Page/IG not chosen yet — connect is incomplete. */
export function isMetaConnectPartial(brand: Brand): boolean {
  return Boolean(brand.platform_user_token_encrypted) && !isMetaConnected(brand);
}

export function isLinkedInConnected(brand: Brand): boolean {
  return Boolean(brand.linkedin_org_id && brand.linkedin_tokens_encrypted);
}

export function isTikTokConnected(brand: Brand): boolean {
  return Boolean(brand.tiktok_open_id && brand.tiktok_tokens_encrypted);
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
  if (isLinkedInConnected(brand)) {
    lines.push(`LinkedIn: ${brand.linkedin_org_name ?? brand.linkedin_org_id}.`);
  } else {
    lines.push("LinkedIn: not connected.");
  }
  if (isTikTokConnected(brand)) {
    lines.push(`TikTok: ${brand.tiktok_display_name ?? brand.tiktok_open_id}.`);
  } else {
    lines.push("TikTok: not connected.");
  }
  if (isAdsConnected(brand)) {
    const name = brand.ad_account_name ?? brand.ad_account_id ?? "ad account";
    lines.push(`Ad account: ${name} (${adsEnabled(brand) ? "ads on" : "ads connected but feature off"}).`);
  } else {
    lines.push("Ad account: not connected.");
  }
  return lines.join(" ");
}

export type ConnectPurpose = "meta" | "ads" | "linkedin" | "tiktok" | "crm";

export function connectLinkMessage(brand: Brand, purpose: ConnectPurpose): string {
  if (purpose === "crm") {
    const link = smsConnectUrl(brand.id, "crm");
    return `CRM webhook settings (expires in 15 min): ${link}. Or text me: set crm webhook https://hooks.zapier.com/…`;
  }
  if (purpose === "ads") {
    if (isAdsConnected(brand)) {
      const link = smsConnectUrl(brand.id, "ads");
      const name = brand.ad_account_name ?? brand.ad_account_id ?? "your ad account";
      const flag = adsEnabled(brand) ? "Ads are on." : 'Ads feature is off — say "enable ads" to spend.';
      return `You're linked to ${name}. ${flag} To reconnect a different ad account, tap this (expires in 15 min): ${link}`;
    }
    const link = smsConnectUrl(brand.id, "ads");
    return `One tap to connect your Meta ad account — I'll text you when it's linked: ${link} (expires in 15 min). If it does, just ask me again.`;
  }
  if (purpose === "linkedin") {
    if (isLinkedInConnected(brand)) {
      const link = smsConnectUrl(brand.id, "linkedin");
      const name = brand.linkedin_org_name ?? "your Company Page";
      return `LinkedIn is connected: ${name}. To reconnect a different Page, tap this (expires in 15 min): ${link}`;
    }
    const link = smsConnectUrl(brand.id, "linkedin");
    return `One tap to connect your LinkedIn Company Page — I'll confirm the page name here when it's linked: ${link} (expires in 15 min).`;
  }
  if (purpose === "tiktok") {
    if (isTikTokConnected(brand)) {
      const link = smsConnectUrl(brand.id, "tiktok");
      const name = brand.tiktok_display_name ?? "your TikTok";
      return `TikTok is connected: ${name}. To reconnect or update privacy / music consent, tap this (expires in 15 min): ${link}`;
    }
    const link = smsConnectUrl(brand.id, "tiktok");
    return `One tap to connect TikTok — you'll confirm privacy level and music consent on the next screen: ${link} (expires in 15 min).`;
  }
  if (isMetaConnected(brand)) {
    const link = smsConnectUrl(brand.id, "meta");
    return `${metaConnectStatusMessage(brand)} To reconnect with a different account, tap this (expires in 15 min): ${link}`;
  }
  const link = smsConnectUrl(brand.id, "meta");
  return `One tap to connect Instagram + Facebook — I'll take it from there: ${link} (expires in 15 min). If it does, just ask me again and I'll send a fresh one.`;
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

/** Clear owner-facing SMS when a LinkedIn/TikTok caption or consent cap trips. */
export function platformCapErrorSms(platform: string, errMessage: string): string {
  const name = platformLabel(platform);
  if (/caption too long|too long \(max/i.test(errMessage)) {
    const max = platform === "linkedin" ? 3000 : platform === "tiktok" ? 2200 : null;
    return max
      ? `${name} rejected that caption — it has to be under ${max} characters. Shorten it and say "yes" again.`
      : `${name} rejected that caption as too long. Shorten it and try again.`;
  }
  if (/admin of that Company Page|need to be an admin/i.test(errMessage)) {
    return `LinkedIn needs a Company Page admin — reconnect with an admin account. Say "connect LinkedIn" for a fresh link.`;
  }
  if (/partner approval|Marketing Developer Platform/i.test(errMessage)) {
    return `LinkedIn app partner approval is still pending — organic posts can't go live until LinkedIn clears it.`;
  }
  if (/rate\/cap|rate.?limit|posting limit/i.test(errMessage)) {
    return `${name} hit a posting limit — wait a bit and try again.`;
  }
  if (/music|consent|privacy|unaudited|audit/i.test(errMessage)) {
    return `${name} needs a privacy / music consent refresh before I can post. Say "connect TikTok" for a fresh link.`;
  }
  if (/video|photo|media|needs a video/i.test(errMessage)) {
    return `${name} needs a video (or photo) for that post — text-only isn't supported there. Send media and try again.`;
  }
  return `${name} publish failed: ${errMessage.slice(0, 160)}`;
}
