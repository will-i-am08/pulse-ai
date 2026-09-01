# @pulse/channel-twilio

Twilio SMS/MMS adapter implementing the `MessageChannel` interface from `@pulse/shared`.

- `TwilioChannel` — sends outbound SMS/MMS via the Twilio SDK, verifies inbound webhook
  signatures with `twilio.validateRequest`, parses Twilio's form-encoded webhook body into
  an `InboundMessage` (`From`/`To`/`Body`/`NumMedia`/`MediaUrl{n}`/`MediaContentType{n}`/`MessageSid`),
  and downloads inbound media using Twilio account-SID/auth-token basic auth so callers never
  depend on Twilio's short-lived media URLs.
- `createTwilioChannel()` — factory returning a `MessageChannel`.

Reads `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` via `getServerEnv()`
from `@pulse/shared`. Env is validated lazily inside each method, so importing this package
does not require Twilio env vars to be set.

## Tests

`pnpm --filter @pulse/channel-twilio test` (vitest) — covers `parseInbound` for the 0-media
and 2-media cases, plus a defensive case for a malformed `NumMedia` count.
