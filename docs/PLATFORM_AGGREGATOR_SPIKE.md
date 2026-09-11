# Platform aggregator spike — Postiz vs direct (LinkedIn + TikTok)

_Spike for Phase H outbound. Decision recorded in [`STATUS.md`](STATUS.md)._

## Question

For **LinkedIn Company Page** and **TikTok** organic outbound, should Kip route through a unified publisher (e.g. **Postiz**) or ship **direct adapters** mirroring the existing X / Threads pattern?

## Options on paper

| | **Direct adapters** (X/Threads shape) | **Postiz (or similar aggregator)** |
|---|---|---|
| Time-to-first mock SMS loop | Low — copy connect + `platformConfigured()` + mock publish | Medium — new vendor SDK/API, auth model, error mapping |
| Live publish control | Full (Posts API / Direct Post fields, AIGC flags, privacy UX) | Thinner — lowest-common-denominator creatives |
| App review / audit | Still ours (LinkedIn Marketing Developer; TikTok Content Posting audit) | May reduce *some* review surface; TikTok audit & LinkedIn org OAuth often still required of the product that owns the UX |
| Inbound / analyst | Same as today: best-effort omit until we own insights APIs | Aggregators rarely give full engagement parity; we'd still need direct later |
| Ops / margin | One more pair of env vars + token columns | Vendor cost, outage coupling, data residency |
| Caption / media fidelity | Native limits (LI ~3k, TT ~2200), video-first TikTok, multi-image LI | Risk of silent truncation or unsupported formats |
| Consistency with Kip | Matches Meta / X / Threads: SMS deep-link → tokens on brand → graph adapter | New publishing path beside `@pulse/graph` |

## Postiz specifically

- Already available as an integration candidate (28+ channels).
- Strong fit for **many** outbound-only channels where Kip won't own engagement.
- Weak fit when we need **SMS-native connect UX** (Company Page name confirm; TikTok privacy + music consent), **clear per-platform errors** in SMS, and **feature flags** like `TIKTOK_AUDIT_PASSED`.
- Does not remove TikTok's unaudited / Direct Post gating — Kip must still refuse or mock public posts until audit clears.

## Recommendation

**Ship direct adapters for LinkedIn + TikTok**, mirroring X/Threads:

1. `platformConfigured("<CLIENT_ID>")` mock fallback when the app or brand token is missing.
2. SMS deep-link OAuth (mock connect when `GRAPH_MODE=mock`).
3. Live clients that call documented endpoint shapes when tokens exist.
4. Revisit Postiz (or Buffer/Metricool) only for the *next* long-tail batch (Pinterest, YouTube Shorts, etc.) once LI/TT prove the outbound fan-out + failure isolation model.

Aggregator maths do **not** clearly win for these two: review/audit work remains, and Kip already has the connect → approve → publish → SMS confirmation loop to extend.

## Decision

**Direct.** Recorded in STATUS (Phase H0). No Postiz dependency in the Phase H path.
