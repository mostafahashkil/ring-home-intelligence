# Ring integration: verified capabilities, assumptions and blockers

Sources reviewed on 2026-10-14:
- https://developer.amazon.com/docs/ring/develop.html
- https://developer.amazon.com/docs/ring/api-documentation.html
- https://github.com/AmazonAppDev/ring-api-helloworld, Ring's official sample app

No Ring MCP server was available in this environment, so everything below comes from the public documentation.

## Confirmed by the documentation and implemented

| Capability | Endpoint or mechanism | Where in code |
| --- | --- | --- |
| Token exchange and refresh | `POST https://oauth.ring.com/oauth/token`, form-encoded, `grant_type=authorization_code \| refresh_token`. Access tokens last about 4 h, refresh tokens about 30 days and rotate on refresh. | `providers/ring/auth.ts` |
| Partner-initiated OAuth with PKCE (invitation only) | `https://account.ring.com/account/integrations/partner-link/authorize`, S256, `scope=ava.v1:read` | `auth.ts`, `api/ring/oauth/*` |
| User account ID | `GET /v1/users/me` → `data.id`. Name and email are ignored and never stored. | `client.ts` |
| Devices | `GET /v1/devices`, `GET /v1/devices/{id}/status` (`attributes.online`), `GET /v1/devices/{id}/capabilities` (`video`, `components.items[].component_id`) | `client.ts`, `provider.ts` |
| Event History | `GET /v1/history/devices/{id}/events?event_types=…`. Event types are `motion` (subtypes human, vehicle, animal, other_motion), `ding` and `on_demand`, with `start`/`end` in epoch ms. | `provider.ts`, `webhook.ts` |
| Webhooks v1.1 | `X-Signature: sha256=<hex HMAC-SHA256(raw body)>`. Respond with 200 within 5 s. Deduplicate on `meta.request_id`. Types: `motion_detected` (`attributes.sub_type`), `button_press`, `device_*` and `app_integration_*`. | `webhook.ts`, `api/ring/webhook` |
| Recorded clips | `POST /v1/devices/{id}/media/video/download` with `{timestamp, duration, components?}`. 416 and 425 are retryable for about 2 minutes after the event. Don't request a range before it has ended plus 5 s. | `client.ts`, `api/events/[id]/clip` |
| Rate limits and errors | 100 req/s per client. On 429, back off and honor `Retry-After`. 503 means the device is offline. | `client.ts` |

## `sub_type` mapping

| Ring | App category | Notes |
| --- | --- | --- |
| `human` | Unrecognized visitor ("Person detected — not identified") | Becomes an arrival only if a household member labels it |
| `package_delivery` | Package activity ("Possible delivery…") | Marked as an inference. No carrier is named. |
| `vehicle` | Vehicle | |
| `motion`, `other_motion`, anything unknown | Motion | Unknown values are kept in `providerType`, per Ring's "open vocabulary" guidance |
| history `animal` | Motion ("Animal motion") | |
| `button_press` / history `ding` | Doorbell press | |

## Not supported by Ring's API

The app never pretends to offer these for real events:

- Identifying people or household members, and face matching
- Clothing or carried-object descriptions
- Naming a delivery carrier
- Door-handle attempts and tamper or obstruction detection
- Any actuation (sirens, locks, lights). The approved scope is read-only.

## Assumptions

1. Device list `attributes.name` is present. The app falls back to "Ring device" if it isn't.
2. A device whose `capabilities.attributes.video` is null (for example a chime) has no motion history or recordings.
3. History filtered by `motion.human` returns events whose `event_type` is still `motion`. The app takes the sub-type from the query that
   returned the event.
4. A webhook and the matching history record for the same real event fall within ±5 s of each other at the same camera, and the app merges
   them on that basis.
5. `video/download` without `video_options` returns the device's default codec and resolution. The documentation lists these options as
   optional.

## Blockers to going live

- **Partner onboarding:** a Ring Developer Portal app with a client ID, client secret and HMAC signing key.
- **A public HTTPS endpoint** for the webhook URL and OAuth redirect URI. Localhost cannot receive Ring webhooks.
- **Test accounts:** up to 10 staging users, an active Ring Protection or base plan, and US-located devices.
- **Partner-initiated OAuth is invitation only.** Without it, use the developer-token shortcut (`RING_REFRESH_TOKEN`) or implement one-way
  linking (below).
- **One-way account linking** (Ring AppStore → Token Exchange URL → Account Link URL with HMAC nonce → `POST` + `PATCH
  /v1/accounts/me/app-integrations`) is documented, but the exact body Ring POSTs to the partner's Token Exchange URL is not shown in text.
  It was left unimplemented rather than guessed. The nonce algorithm itself is fully specified (HMAC-SHA256 of `"<time>:<account_id>"`,
  URL-safe base64 with no padding, 10-minute window), so this is the recommended next step once a staging app exists to confirm the
  request format.
- **Ring AppStore program requirements, content policy and Computer Vision Guidelines** must be reviewed before any store submission.
