# Build Prompt: Ring Home Intelligence

## Role

You are a senior full-stack engineer, AI application architect, UX designer, and security-minded product engineer. Build **Ring Home Intelligence**, a proposed companion app for Amazon Ring that converts supported camera events into useful, personalized, context-aware household notifications.

Work methodically: inspect the existing repository and instructions first, identify the framework and current capabilities, then implement the product in the existing architecture. Do not replace working project structure without a clear reason. If no project exists, choose a maintainable, well-supported stack and document the choice.

## Product vision

Ring Home Intelligence helps a household understand **what happened, who may have arrived, whether a delivery likely occurred, and whether an event needs attention**—without overwhelming people with generic motion alerts.

The primary value proposition is:
- Fewer low-value notifications and less alert fatigue.
- Household-aware arrival messages such as “Alex arrived home.”
- Helpful delivery and package-event summaries.
- Neutral descriptions of unfamiliar visitors and their observable actions.
- Configurable, proportionate safety alerts based on behavior rather than assumed identity.
- Clear privacy, consent, uncertainty, and audit controls.

This is a product concept, not an official Amazon Ring product. Do not imply affiliation, endorsement, or existing Ring API support.

## Critical implementation rule: verify integrations first

Before implementing a Ring integration, inspect current official documentation and the repository's dependencies. Confirm what the available, authorized Ring APIs or integrations actually support, including event types, clip access, webhooks, authentication, and platform terms.

**Never invent endpoints, permissions, SDK methods, or access to video.** If Ring access is unavailable or the necessary feature is not officially supported, implement a clearly labeled mock/demo provider and a provider interface that can later be connected to a verified integration. Keep demo data separate from real user data. Document all assumptions and blockers.

Do not bypass access controls, scrape protected services, or request a user's Ring password. Use a supported authorization method where available.

## Core functional requirements

### 1. Event timeline and motion notifications
- Show a chronological event feed with timestamp, camera/zone, event type, concise summary, confidence where meaningful, and a link to the supported clip or event detail.
- Support event categories such as motion/person detected, package activity, household arrival, unfamiliar visitor, and behavior-based safety event—but only display categories actually supported by the configured provider.
- Let users filter by date, camera, person/profile, event category, and alert severity.
- Provide empty, loading, error, permission-denied, disconnected, and demo-mode states.
- Never fabricate a live event. Clearly label seeded/sample events as examples.

### 2. Household profiles and arrival experience
Create a household setup flow with illustrative example members:
- Alex — father
- Emily — mother
- Jack — son
- Sarah — daughter

These are sample/demo profiles only; do not assume they are the real user's family.

Each profile may include display name, optional relationship label, notification preference, enabled/disabled status, consent status, and supported recognition configuration. Minimize stored personal data.

Recognition must be implemented only if a permitted, technically supported method is verified. Do not silently add face recognition, biometric identification, or facial database matching. If no approved recognition method exists, offer a safe alternative such as manual event labeling, user-confirmed association, or another supported signal. Do not claim a person has been identified when the system only detects a person.

Example notifications:
- “Alex arrived home — Front door · 5:42 PM.”
- “Daughter Sarah arrived — Driveway · 5:58 PM.”
- “Jack may have arrived — match uncertain. Review event.”

Support household preferences:
- Notify on each recognized arrival.
- Use a quiet log instead of a push alert.
- Suppress routine alerts for selected profiles.
- Alert only for selected people, cameras, or time windows.
- Ask for review when confidence is below the configured threshold.

Never turn an uncertain match into a definitive identity claim.

### 3. Delivery and package activity
- Classify delivery or package events only when the provider or vision capability supports the task.
- Use multiple observable cues when available, such as a parcel being carried or placed, a package remaining at an entrance, or a delivery vehicle.
- Prefer careful wording:
  - “Possible delivery at your front door.”
  - “Package appears to have been left near the entrance.”
  - “Package activity detected; delivery company not confirmed.”
- Name a delivery company only when reliable evidence supports the label. A uniform, logo, or vehicle alone may be insufficient.
- Distinguish observations from inferences in both data and UI.

### 4. Unrecognized visitor descriptions
- When a visitor cannot be matched through a permitted and sufficiently reliable method, label the person as “unrecognized” or “not identified,” not “suspicious” by default.
- Where supported, summarize visible, non-sensitive details and actions, such as clothing color, carried objects, approaching the door, ringing the bell, placing a package, or leaving.
- Example: “Unrecognized person wearing a red jacket and carrying a backpack.”
- Avoid inferring identity, criminality, intent, personality, sensitive traits, or dangerousness from appearance.
- Provide a user feedback action to correct event labels and improve household preferences without training or storing biometric data unless explicitly authorized and lawful.

### 5. Behavior-based safety intelligence
Focus on observable actions and event patterns, such as:
- Repeated attempts to open a door.
- Prolonged activity near an entrance, based on a user-configurable threshold.
- Visible camera obstruction or tampering, where supported.
- Repeated visits within a configured time window.

Implement a configurable response ladder:
1. Low concern: log quietly or send a low-priority notification.
2. Needs attention: notify selected household members and offer the relevant event clip where available.
3. Higher concern: activate only explicitly configured, supported security routines or ask the user to confirm.
4. Emergency: provide information and let the user decide whether to contact appropriate local services.

Do not automatically contact police, publicly identify a person, unlock a door, confront a person, or take other consequential actions based only on uncertain AI classification. Never make an accusation based solely on an algorithmic score.

### 6. External identity and criminal-record lookups
**Do not implement unrestricted face-based internet searches, identity matching of strangers, or automatic criminal-record checks as a default feature.**

If a future, legitimate use case is proposed:
- Pause implementation and produce a feasibility, legal, privacy, and source-quality assessment first.
- Require an authorized, reliable data source and lawful basis.
- Require robust identity verification rather than resemblance.
- Show source, date, uncertainty, and limitations.
- Include human review, correction, and appeal mechanisms for consequential results.
- Never label a person a criminal based on a face match, clothing, an unverified website, or an AI inference.

For the MVP, leave this out and document it as a separately gated future research track.

### 7. Notification rules engine
Let users configure rules by:
- Event category.
- Camera or zone.
- Household profile.
- Time window / quiet hours.
- Confidence level.
- Severity.
- Desired action: push alert, in-app notification, quiet log, save clip if supported, or approved security routine if supported.

Show why a notification was generated (for example, “Rule: notify on package activity at the front door”). Include a test/preview mode. Prevent conflicting rules from producing uncontrolled notification storms; provide deduplication and cooldown settings.

### 8. Privacy, security, and account controls
- Use secure authentication appropriate to the chosen stack.
- Never store passwords or access tokens in plaintext or client-side source code.
- Apply least privilege and server-side authorization to all private resources.
- Protect household profiles, clips, event metadata, and settings.
- Provide consent/status controls, data export where feasible, deletion, retention settings, and clear descriptions of what is stored.
- Minimize collection and retention; default to collecting only what the product needs.
- Keep audit events for configuration changes and triggered automations.
- Make demo data visibly distinct and easy to reset.
- Do not send video or personal data to external AI providers without clear disclosure, appropriate authorization, and secure handling.
- Do not include secrets in logs, analytics, error messages, or source control.

## UX and design direction

Build a polished, accessible, responsive smart-home security dashboard. It should feel calm, trustworthy, modern, and easy to understand—not alarmist.

Suggested navigation:
- **Home** — summary of recent activity, household arrivals, packages, and priority alerts.
- **Activity** — searchable/filterable event timeline.
- **Household** — profiles, consent/status, and alert preferences.
- **Cameras & Zones** — configured cameras/zones from the verified provider or demo data.
- **Rules & Automations** — notification logic, quiet hours, and allowed actions.
- **Privacy & Settings** — integration status, data controls, retention, and audit log.

UI guidance:
- Use clear labels and short notification summaries.
- Visually distinguish confirmed provider events, model inferences, and uncertain matches.
- Do not use color alone to communicate severity.
- Make camera/connection state and demo mode visible.
- Include responsive layouts, keyboard accessibility, readable contrast, and helpful empty/error states.
- Use sample cards for Alex, Emily, Jack, Sarah, a possible delivery, an unfamiliar visitor, and a behavior alert. Mark all sample content as demo data.
- Do not copy official Ring branding or imply the app is an official Ring interface. A neutral smart-home visual identity is preferred.

## Suggested high-level architecture

Keep components modular and replaceable:

1. **Provider adapter** — interface for verified Ring event sources; demo/mock adapter when no supported integration is available.
2. **Event normalization** — common schema for timestamps, camera/zone, event type, evidence references, provider source, and confidence.
3. **Analysis service** — optional supported event classification and neutral description generation.
4. **Household context service** — profile preferences and permitted user-confirmed associations.
5. **Rules engine** — deterministic, testable notification and automation decisions.
6. **Notification service** — in-app/push delivery through configured providers.
7. **Audit and privacy layer** — consent, retention, deletion, access control, and action history.
8. **Frontend** — responsive dashboard and setup flows.

Suggested normalized event fields:
- `id`
- `provider`
- `providerEventId` (if available)
- `timestamp`
- `cameraId` / `zoneId`
- `eventType`
- `summary`
- `observations` (objective, non-sensitive details)
- `inference` (optional, explicitly labeled)
- `confidence` (optional and calibrated; never treated as proof)
- `householdProfileId` (optional, only for a permitted reliable match or user-confirmed association)
- `evidenceReference` (provider-owned reference; avoid copying media unnecessarily)
- `ruleId` (optional)
- `demo` (boolean)

Use a database schema appropriate to the selected stack. Validate all external/provider data. Keep provider-specific code out of the UI.

## Engineering requirements

- First inspect the repository, package files, README, existing tests, and build instructions.
- Write a short implementation plan before major changes.
- Use the project's existing conventions unless they are unsafe or clearly unsuitable.
- Use typed interfaces and input validation where the stack supports them.
- Add unit tests for event normalization, rules, confidence thresholds, deduplication, retention behavior, and permission checks.
- Add integration tests for provider adapter behavior using mocks.
- Add UI tests for the most important flows if a test framework exists.
- Handle API failures, rate limits, expired authorization, missing clips, and disconnected cameras gracefully.
- Add logging that supports debugging without leaking personal information.
- Include `.env.example` with placeholder names only, never real secrets.
- Include database migrations or schema setup and seed/demo data.
- Document how to install, configure, run, test, and build the app.
- Do not claim tests passed unless you actually ran them.
- Do not leave core buttons inert. If a feature cannot work without external credentials or unsupported APIs, provide a clear setup/disabled state and explain why.

## Recommended implementation sequence

### Phase 0 — Repository and integration discovery
1. Inspect the codebase and identify the stack.
2. Verify official Ring integration options and current terms.
3. List confirmed capabilities, unsupported capabilities, credentials needed, and risks.
4. Decide whether the app can use a real provider or must start in demo mode.

### Phase 1 — Working MVP shell
1. Build responsive navigation and Home dashboard.
2. Implement the event timeline with seeded demo data.
3. Add filters, event details, empty/error/loading states, and visible demo labels.
4. Add household profiles and preferences.

### Phase 2 — Rules and notification experience
1. Implement deterministic notification rules and quiet hours.
2. Add example household arrival, possible delivery, unfamiliar visitor, and behavior alerts.
3. Add deduplication, rule explanations, and event audit history.
4. Test rule conflicts and uncertain-match behavior.

### Phase 3 — Provider adapter and supported AI
1. Implement only verified provider capabilities.
2. Keep demo provider available for local development.
3. Add supported event analysis, clearly separating observation from inference.
4. Add robust authorization, disconnect, and error handling.

### Phase 4 — Hardening
1. Run tests, type checks, lint, and production build.
2. Review privacy/security controls and data retention.
3. Check accessibility and responsive behavior.
4. Update documentation with actual implementation status and known limitations.

## Definition of done

The task is complete when:
- The app runs using documented commands.
- The main screens and core flows are implemented.
- Demo mode works without real Ring credentials and is clearly labeled.
- No fake Ring integration or unsupported recognition is presented as real.
- Household preferences and notification rules affect displayed behavior.
- Uncertain matches are handled cautiously.
- No stranger identity lookup or criminal labeling is implemented by default.
- Tests, lint/type checks, and build have been run where available, with truthful results documented.
- README documentation explains setup, architecture, supported capabilities, privacy behavior, and limitations.

## Final response from the coding agent

When finished, report:
1. What was implemented.
2. The app stack and architecture.
3. How to run it locally.
4. Tests and build commands actually executed, including outcomes.
5. Which features use demo data versus verified live integrations.
6. Any blockers, missing credentials, unsupported Ring capabilities, or remaining risks.
7. The next recommended implementation step.

**Start by inspecting the repository and verifying integration feasibility. Then build the smallest complete, polished, testable MVP rather than pretending every proposed feature is already supported.**
