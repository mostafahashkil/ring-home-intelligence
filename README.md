# Ring Home Intelligence (concept)

A companion app that turns supported camera events into calm, household-aware notifications. It shows who probably
arrived, whether a delivery likely happened, and whether anything needs attention, without a stream of generic motion alerts.

> **Not an official Amazon or Ring product.** This app is not affiliated with or endorsed by Amazon or Ring. It talks to Ring only through
> the official [Ring Partner API](https://developer.amazon.com/docs/ring/api-documentation.html), and it never asks for a Ring password.

It runs in **demo mode** out of the box, with an example household (Alex, Emily, Jack and Sarah), five cameras and a day of sample events.
All demo content is labeled "Demo" and kept separate from real data.

---

## Quick start

Requirements: Node.js 22.12 or newer, and npm. Nothing else is needed locally: development uses an embedded SQLite file. When deployed to Netlify, the app uses Netlify Database (managed Postgres) instead. See [Deploying to Netlify](#deploying-to-netlify).

```bash
npm install
cp .env.example .env.local        # optional in development; required values are listed below
npm run dev                       # http://localhost:3000
```

1. Open http://localhost:3000. On first run you are sent to **/setup** to create the owner account.
2. You land on **Home** in demo mode. Try **Home → Try a sample event**, open events in **Activity**, edit **Rules**, or use **Rules → Test mode**.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit, integration and UI tests (Vitest), on in-memory SQLite. To run them on Postgres: `TEST_DATABASE_URL=postgres://… npx vitest run --no-file-parallelism` |
| `npm run lint` | ESLint (next/core-web-vitals and TypeScript rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Apply schema migrations. These also run automatically on startup. |
| `npm run db:reset-demo` | Delete and re-seed demo data. Real data is untouched. |

### Configuration (`.env.local`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_ENCRYPTION_KEY` | In production | 32-byte base64 key. Encrypts Ring tokens at rest with AES-256-GCM. In development, a key file is generated in `./data` if this is unset. |
| `APP_BASE_URL` | Recommended | Public base URL, used to show the webhook URL to register |
| `DATABASE_PATH` | No | SQLite file path for local development (default `./data/rhi.db`) |
| `NETLIFY_DB_URL` | Set by Netlify | Postgres connection string. Netlify sets it automatically once Netlify Database is provisioned. When it is present, the app uses Postgres instead of SQLite. |
| `RING_CLIENT_ID`, `RING_CLIENT_SECRET` | For Ring | Issued during Ring AppStore partner onboarding |
| `RING_HMAC_SIGNING_KEY` | For webhooks | Verifies the `X-Signature` header on Ring webhooks |
| `RING_OAUTH_REDIRECT_URI`, `RING_OAUTH_SCOPE` | For "Connect Ring" | Partner-initiated OAuth with PKCE. Ring offers this by invitation only. |
| `RING_ACCESS_TOKEN` or `RING_REFRESH_TOKEN` | Dev shortcut | A token from the Ring Developer Playground, the same approach as Ring's `ring-api-helloworld` sample |

Secrets go only in environment variables. `.env*`, the database and the key files are git-ignored.

---

## What works today

| Area | Status |
| --- | --- |
| Event timeline with filters (date, camera, person, category, severity, text, demo on/off), event detail, and empty, loading, error, permission-denied, disconnected and demo states | ✅ |
| Household profiles: consent status, enable/disable, notification mode, camera and time limits, per-person review threshold | ✅ |
| Arrivals from **user-confirmed labels**. Demo-only simulated signals show how uncertain matches are handled. | ✅ |
| Uncertain matches go to **"Review event"** and never become a definitive identity | ✅ |
| Package and delivery wording that keeps observations separate from inferences. No carrier is ever named. | ✅ |
| Unrecognized visitors described neutrally. They are never called "suspicious". | ✅ |
| Behavior patterns: repeated visits and prolonged activity (works with Ring data), plus door-handle attempts and camera obstruction (demo only) | ✅ |
| Four-step response ladder. Nothing happens automatically: no police contact, unlocking or confrontation. | ✅ |
| Deterministic rules engine: category, camera, person, time window, confidence, severity, priority, quiet hours, deduplication and cooldown. Every decision shows **"Why this notification?"**. | ✅ |
| Rule conflict warnings and a **Test mode** preview | ✅ |
| In-app notification center, plus browser notifications for push-level alerts while the app is open | ✅ |
| Privacy: data export, event and full deletion, retention settings, a "what we store" page, audit log, and redacted logs | ✅ |
| Accounts: owner and member roles, scrypt passwords, hashed session tokens, login throttling, and server-side permission checks on every action | ✅ |
| Ring: webhook ingestion (HMAC-verified, idempotent), device and status sync, Event History import, PKCE OAuth, token refresh, on-demand clip playback | ✅ Implemented against the documentation. **Not yet run against live Ring credentials.** |

## Themes

Choose an appearance from the palette button in the top bar. The choice is saved per browser in a cookie, so pages load already themed.

| Theme | Look |
| --- | --- |
| **Calm** (default) | Neutral green-gray with flat bordered cards |
| **Sky** | Bright, airy home-security style: light gray background, white cards with soft shadows, white top bar, charcoal text, a calm blue accent and uppercase primary buttons |

Each theme has Light, Dark and System (follows the device) modes. Themes are sets of CSS color and shape variables in
`src/app/globals.css` (`[data-palette]` / `[data-mode]` on `<html>`). To add a theme, add a token block there and an entry in
`src/lib/theme.ts`. Sky takes its feel from popular home-security apps but uses no company's logo or wordmark.

## What uses demo data and what uses Ring

| Feature | Demo provider | Ring Partner API |
| --- | --- | --- |
| Motion, person, vehicle and package events | Sample events | `motion_detected` `sub_type` (`human`, `vehicle`, `package_delivery`, `other_motion`, `motion`). The device needs Smart Alerts turned on in the Ring app. |
| Doorbell presses | Sample events | `button_press` webhook and history `ding` |
| Camera online/offline | Sample events | `device_online`/`device_offline` webhooks and `GET /v1/devices/{id}/status` |
| Household arrivals | Simulated match confidence | **Only from your own labels.** Ring does not identify people. |
| Clothing and carried-object descriptions | Written for the demo | **Not available.** Video is not sent to external AI. |
| Door-handle attempts and tamper detection | Demo signals | **Not available** |
| Prolonged activity | Sample durations | Calculated from Event History `start` and `end` |
| Recordings | None | MP4 streamed on demand through `POST /v1/devices/{id}/media/video/download`. Not stored. |
| Sirens, locks and other security routines | None | **Not available.** Ring's partner scope (`ava.v1:read`) is read-only. |

The **Cameras & Zones** page shows this table inside the app for each provider. Full API details, assumptions and blockers are in
[docs/RING_INTEGRATION.md](docs/RING_INTEGRATION.md).

---

## Deploying to Netlify

The repo includes `netlify.toml`, and the `@netlify/database` dependency makes Netlify provision a managed Postgres database on the first deploy.
Serverless instances are short-lived and don't share a disk, so all state (accounts, sessions, events, settings) has to live in that
shared database. Schema migrations run automatically, under an advisory lock, the first time an instance connects.

Set these environment variables on the site:

- `APP_ENCRYPTION_KEY` (required, mark it secret)
- `APP_BASE_URL` (the site's URL)
- the Ring variables, if you use Ring

---

## Architecture

**Stack:** Next.js 16 (App Router, React 19, server components and server actions), TypeScript (strict), Tailwind CSS, a database layer
(`src/lib/db`) with two backends: SQLite through better-sqlite3 locally, and Postgres through Netlify Database when deployed. Also zod
for validation, and Vitest with Testing Library.

Why this stack: the app runs as a single process with nothing else to install. Server components keep provider tokens and household data
on the server, and Ring's API must be called server-to-server anyway because it blocks browser CORS.

```
Provider adapters ──► Ingest pipeline ─────────────────────────────────────► SQLite / Postgres
 (Ring webhook,        validate (zod) → normalize → household association     events, notifications,
  Ring history sync,   → rules engine (pure) → store + notify + audit         profiles, rules, audit,
  Demo provider)       → behavior detection → derived events                  encrypted tokens
                                                                               │
UI (server components + small client islands) ◄────────────────────────────────┘
```

| Module | Path |
| --- | --- |
| Provider interface | `src/lib/providers/types.ts` |
| Ring adapter (client, OAuth, webhook, provider) | `src/lib/providers/ring/*` |
| Demo adapter and fixtures | `src/lib/providers/demo.ts` |
| Normalized event schema and domain types | `src/lib/domain/types.ts` |
| Event normalization (Ring `sub_type` mapping) | `src/lib/events/normalize.ts` |
| Household association (no biometrics) | `src/lib/household/*` |
| Rules engine (pure and deterministic) | `src/lib/rules/engine.ts` |
| Behavior detection | `src/lib/behavior/detect.ts` |
| Pipeline | `src/lib/pipeline.ts` |
| Privacy: retention, export, deletion | `src/lib/privacy/*` |
| Auth: passwords, sessions, roles | `src/lib/auth/*` |
| Schema migrations | `src/lib/db/migrations.ts` |

**Rules evaluation order:** uncertain match → review. Then the highest-priority matching rule, or the response ladder or quiet log if no rule
matches. Then profile preferences, quiet hours (push becomes in-app below "Higher concern"), deduplication, and cooldown/storm control. Each
event produces at most one notification, so overlapping rules cannot multiply alerts.

**Normalized event fields:** `id`, `provider`, `providerEventId`, `timestamp`, `endTimestamp`, `cameraId`, `zoneId`, `eventType`,
`providerType`, `summary`, `observations[]` (each with its source: provider, demo or system), `inference` (label and basis), `confidence`,
`severity`, `association`, `householdProfileId`, `evidenceReference` (provider-owned recording pointer), `signals`, `ruleId`, `decision`,
`feedback[]`, `derivedFrom[]`, `demo`.

---

## Privacy and security behavior

- **Stored:** event metadata, profiles (display name, optional relationship, preferences, consent), rules, settings, accounts (email and
  scrypt hash), an audit log, and Ring tokens encrypted with AES-256-GCM.
- **Not stored:** video and images, faces or biometrics, the Ring password, and Ring user name or email (only the account ID is kept).
- **Retention:** events and notifications are purged after N days (default 30), and the audit log after 365 days. Purges run hourly and when
  you save retention settings.
- **Consent:** automated (demo) signals need consent set to "granted". Withdrawing consent removes the person's labels from past events.
- **Access control:** every page, server action and API route checks the session server-side. Members can view and label events; only owners
  can change rules, the household, settings, integrations or data.
- **Webhooks:** HMAC-SHA256 is verified over the raw body before parsing. Ring retries are deduplicated by `meta.request_id`, and events are
  ignored if their `account_id` doesn't match the linked account.
- **Logs and audit:** tokens, codes, nonces, signatures, passwords and emails are redacted.
- **Headers:** `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, and a permissions policy. Cookies are HttpOnly and SameSite=Lax,
  and Secure in production.
- **Deliberately excluded:** face recognition, identity lookups of strangers, and criminal-record checks. See
  [docs/FUTURE_RESEARCH.md](docs/FUTURE_RESEARCH.md).

## Testing

`npm test` runs 82 tests in 7 files:

- **Rules engine:** matching, priority tie-breaks, time windows across midnight, uncertain-match review, per-profile thresholds, profile
  preferences, quiet hours, deduplication, cooldown, the response ladder, emergency guidance and conflict detection.
- **Normalization:** every documented Ring `sub_type`, unknown sub-types passed through, evidence and clip duration rules, demo labeling.
- **Ring adapter integration (mocked HTTP):** 429 with `Retry-After`, refresh on 401, 503 device offline, 416/425 media errors, encrypted
  token storage and rotation, expired refresh, the PKCE flow with single-use state, device and history sync, and webhook/history merging.
- **Webhook:** HMAC verification against the documented payload (including tampered and re-serialized bodies), parsing, and lifecycle events.
- **Pipeline:** first-run seeding, idempotency, demo-flag spoofing, no automatic association for real events, the consent gate, derived
  behavior events and audit entries.
- **Privacy and auth:** retention, export without secrets, factory reset, permissions, password hashing, lockout, and session expiry and
  revocation.
- **UI (jsdom):** demo, uncertain and confirmed labels on event cards, and severity shown as text.

## Known limitations

- **Not tested against a live Ring account.** All Ring calls follow the published documentation and are covered by mocked tests. Live use
  needs partner onboarding (client ID, secret and HMAC key), a public HTTPS URL for webhooks, US devices, and a Ring base plan on those devices.
- **One-way (Ring-AppStore-driven) account linking is not implemented.** The docs don't specify the exact request Ring sends to the Token
  Exchange URL, and this app doesn't guess it. Partner-initiated OAuth with PKCE (invitation only) and the developer-token shortcut are
  implemented instead.
- **Push alerts** are browser notifications shown while the app is open. No third-party push service is connected.
- **Single household per installation.** Accounts share one household.
- **Ring Event History** imports the newest page per filter on each sync. Pagination beyond the first page isn't followed yet.
- **Multi-camera devices:** history events carry no camera module, so clips for history-only events request the device's default module.
