import type { AccountType, Brand } from "@pulse/shared";

/** True when the brand signed up as a personal (not business) account. */
export function isPersonalAccount(brand: Pick<Brand, "account_type"> | null | undefined): boolean {
  return brand?.account_type === "personal";
}

export function accountTypeOf(brand: Pick<Brand, "account_type"> | null | undefined): AccountType {
  return brand?.account_type === "personal" ? "personal" : "business";
}

/**
 * Personal accounts skip ICP / ads / offer-framing strategy work.
 * Niche plans and organic posting still run — just lighter.
 */
export function personalStrategySkipSms(): string {
  return (
    "You're on a personal account, so I skip ICP, ads, and offer framing. " +
    "Say \"propose a content plan\" for a lighter niche plan, or send a photo and we'll post."
  );
}

/** Hard refuse when a personal account tries to enable Meta ads. */
export function personalAdsRefuseSms(): string {
  return (
    "Ads aren't available on personal accounts — Kip keeps those for business brands. " +
    "I can still plan niche content and post organically. Want a content plan?"
  );
}

/** Soft refuse for ICP / strategy research prompts on personal accounts. */
export function personalIcpRefuseSms(): string {
  return (
    "ICP and offer strategy are for business accounts. " +
    "On personal we keep it lighter — niche plan + posts. Try \"propose a content plan\"."
  );
}
