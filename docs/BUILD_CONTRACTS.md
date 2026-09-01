# Build Contracts — read before writing code

This is the coordination spec for the parallel build. Four workstreams, **disjoint file ownership**, each building against the interfaces below. Do not edit files outside your owned paths. When you need another workstream's capability, import its package and code against the signatures here — they are frozen.

## Stack (locked)
- TypeScript, Node ≥20, ESM (`"type": "module"`), pnpm workspaces.
- `@pulse/shared` (already built) holds: domain types, `MessageChannel` interface, `getServerEnv()`, `encrypt/decrypt`, `serviceClient()`, `MEDIA_BUCKET`.
- Supabase = Postgres + Auth + Storage. Schema is `supabase/migrations/0001_init.sql` — treat table/column names there as canonical.
- Anthropic for drafting: `DRAFT_MODEL` (Haiku 4.5) with `FALLBACK_MODEL` (Sonnet 5).
- Twilio SMS/MMS behind `MessageChannel`. Meta Graph behind a mock/live adapter (`GRAPH_MODE`).
- Deploy: `apps/web` → Vercel (dashboard + inbound webhook). `apps/worker` → Railway (publish + scheduler).

## Ownership map
| Workstream | Owns (create/edit only here) | Package name |
|---|---|---|
| **A · Gateway** | `packages/channel-twilio/`, `packages/gateway/` | `@pulse/channel-twilio`, `@pulse/gateway` |
| **B · Orchestrator** | `packages/orchestrator/` | `@pulse/orchestrator` |
| **C · Worker** | `packages/graph/`, `apps/worker/` | `@pulse/graph`, `@pulse/worker` |
| **D · Dashboard** | `apps/web/` (all of it, incl. the webhook HTTP route) | `@pulse/web` |

All packages depend on `@pulse/shared` via `"workspace:*"`. Import cross-package by name, never by relative path across packages.

---

## Frozen interfaces

### A · `@pulse/channel-twilio`
Default export/class `TwilioChannel implements MessageChannel` (from `@pulse/shared`). Uses `TWILIO_*` env. `fetchMedia` uses Twilio basic auth. Exports `createTwilioChannel(): MessageChannel`.

### A · `@pulse/gateway`
```ts
// Handle a normalised inbound message end-to-end: route to brand, persist,
// capture media to Storage, and hand off to the orchestrator.
export function handleInbound(inbound: InboundMessage): Promise<{ brandId: string | null; messageId: string | null }>;

// Resolve a brand by inbound sender phone (E.164). null if unknown sender.
export function resolveBrandByPhone(from: string): Promise<Brand | null>;

// Download provider media and store it under `${brandId}/...` in MEDIA_BUCKET.
export function captureMedia(brandId: string, channel: MessageChannel, media: InboundMedia[]): Promise<MediaAsset[]>;

// Send an outbound message via the active channel and log it as an outbound Message row.
export function sendToBrand(brandId: string, body: string, mediaUrls?: string[]): Promise<void>;

// The active channel singleton (Twilio for now).
export function activeChannel(): MessageChannel;
```
`handleInbound` calls `@pulse/orchestrator`'s `processInbound` after persistence. Unknown sender → log and return `{brandId:null}` (never crash).

### B · `@pulse/orchestrator`
```ts
export type InboundContext = {
  brand: Brand;
  message: Message;            // the freshly-persisted inbound row
  newMedia: MediaAsset[];      // media captured from this message
};

// Decide + act on an inbound message. May draft a caption (→ creates a Post in
// 'pending_approval' and returns a reply), record a correction, answer a question,
// or flag as unclassified. Returns the reply text to send back to the approver.
export function processInbound(ctx: InboundContext): Promise<{ reply: string; postId?: string }>;

// Draft a caption for given media using brand voice + strategy notes. Pure-ish;
// used by processInbound and by proactive flows.
export function draftCaption(brandId: string, mediaIds: string[]): Promise<{ caption: string; proposedTime: string | null }>;

// Fold an approval-time edit into the brand voice profile + store a correction pair.
export function applyCorrection(brandId: string, postId: string, before: string, after: string): Promise<void>;

// Onboarding: given the operator's structured answers, seed brand_voice_profile + strategy notes.
export function seedBrandVoice(brandId: string, answers: Record<string, unknown>): Promise<void>;

// Build the LLM context window: last N messages + rolling summary.
export function buildConversationContext(brandId: string, limit?: number): Promise<string>;
```
Classification of inbound text (approval vs edit vs media vs question vs instruction) lives here. Low confidence → reply asking for clarification, never guess-and-act.

### C · `@pulse/graph`
```ts
export interface GraphAdapter {
  publish(input: {
    brand: Brand; platform: Platform; caption: string; mediaUrls: string[];
  }): Promise<{ externalPostId: string; permalink: string | null }>;
  fetchEngagement(brand: Brand, externalPostId: string, platform: Platform):
    Promise<Record<string, number>>;
  last24hCount(brand: Brand, platform: Platform): Promise<number>;
}
// Returns MockGraphAdapter when GRAPH_MODE=mock, LiveGraphAdapter when 'live'.
export function getGraphAdapter(): GraphAdapter;
```
Rate ceilings enforced by the worker using `last24hCount`: Instagram 100/24h, Facebook 25/Page/24h.

### C · `@pulse/worker`
Long-running Railway process. Uses `node-cron`. Two responsibilities:
1. **Publish loop** (every minute): pick `posts` where `status in ('approved','scheduled')` and `scheduled_at <= now()`; enforce rate limits; `getGraphAdapter().publish()`; on success → `published`, log, and `sendToBrand` a confirmation with permalink; on failure → retry with backoff (`retry_count`), then `failed` + alert operator via `sendToBrand(OPERATOR)`.
2. **Proactive triggers**: read `proactive_triggers`; fire `checkin` (skip if brand messaged in last 24h), `report` (weekly performance summary via `fetchEngagement`), `reminder` (no media in 10 days, once), `alert` (to operator). Each send goes through `@pulse/gateway.sendToBrand`.
Every publish/failure writes an `approval_log` row. Never publish a post that lacks a logged `approved` action — assert it.

### D · `@pulse/web` (Next.js App Router)
- Operator auth via Supabase Auth (email magic link). Middleware guards all routes except `/api/webhooks/*`, `/privacy`, `/login`.
- Webhook route `app/api/webhooks/twilio/route.ts`: verify signature via the channel, parse, call `@pulse/gateway.handleInbound`. Return TwiML/204 fast.
- Dashboard: brands list; brand detail (pending approvals with approve/edit/reject → on approve set `status='approved'` + schedule, log `approved`; on edit call `applyCorrection` then approve; on reject set `rejected`); post history; brand-voice profile editor; onboarding form calling `seedBrandVoice`.
- `/privacy` static page (needed for Meta App Review).
- Server-only imports (`@pulse/gateway`, `@pulse/orchestrator`) must never reach client components.

---

## Non-negotiables (apply to everyone)
- **Approval is absolute**: no code path sets a post to `publishing`/`published` without a prior `approval_log` row with `action='approved'`.
- **Auditability**: every draft, approval, edit, publish, failure → an `approval_log` row.
- **Security**: platform tokens only ever stored via `encrypt()`; decrypt only server-side at point of use. No cross-brand access — always filter by `brand_id`.
- **Resilience**: every external call (Twilio, Graph, Anthropic) wrapped in retry-with-backoff; failures surface, never silent.
- **Media**: never persist a provider's short-lived URL; download to `MEDIA_BUCKET` immediately.
- Every package: `tsconfig.json` extending `../../tsconfig.base.json`, a `typecheck` script, ESM.
