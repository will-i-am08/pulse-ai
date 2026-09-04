// Runtime Google Business Profile API helpers (posting + reviews). Used by the
// worker/bot once a brand has connected Google. All calls are gated on the brand
// having google tokens + a location; until Google API access is granted these
// are exercised only in that connected state.
//
// NOTE: the v4 My Business endpoints below are the documented shapes; verify
// exact field names against real API access when GBP is approved.

async function refresh(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google client credentials not set");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as any;
  if (!res.ok || body.error) throw new Error(`google refresh: ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token as string;
}

/** A short-lived access token from the stored refresh token. */
export async function googleAccessToken(refreshToken: string): Promise<string> {
  return refresh(refreshToken);
}

/** Publish a local post to a Google Business Profile location. Returns the post id. */
export async function gbpCreatePost(
  accessToken: string,
  locationName: string, // accounts/{aid}/locations/{lid}
  input: { summary: string; mediaUrl?: string },
): Promise<string> {
  const post: Record<string, unknown> = {
    languageCode: "en",
    summary: input.summary,
    topicType: "STANDARD",
    ...(input.mediaUrl ? { media: [{ mediaFormat: "PHOTO", sourceUrl: input.mediaUrl }] } : {}),
  };
  const res = await fetch(`https://mybusiness.googleapis.com/v4/${locationName}/localPosts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(post),
  });
  const body = (await res.json()) as any;
  if (!res.ok || body.error) throw new Error(`gbp post: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
  return String(body.name ?? "gbp_post");
}

export type GbpReview = {
  reviewId: string;
  name: string; // full resource name (used to reply)
  reviewer: string;
  starRating: string; // ONE..FIVE
  comment: string;
};

/** Fetch reviews for a location. */
export async function gbpListReviews(accessToken: string, locationName: string): Promise<GbpReview[]> {
  const res = await fetch(`https://mybusiness.googleapis.com/v4/${locationName}/reviews`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json()) as any;
  if (!res.ok || body.error) throw new Error(`gbp reviews: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
  return (body.reviews ?? []).map((r: any) => ({
    reviewId: String(r.reviewId ?? r.name),
    name: String(r.name),
    reviewer: String(r.reviewer?.displayName ?? "A customer"),
    starRating: String(r.starRating ?? "THREE"),
    comment: String(r.comment ?? ""),
  }));
}

/** Post/update the reply to a review. */
export async function gbpReplyReview(accessToken: string, reviewName: string, comment: string): Promise<void> {
  const res = await fetch(`https://mybusiness.googleapis.com/v4/${reviewName}/reply`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ comment }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || body.error) throw new Error(`gbp reply: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
}
