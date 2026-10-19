# Proposal: Visual Study Assistant MVP

## Intent

Deliver a least-privilege Chromium extension that analyzes the visible viewport only when invoked. Centered questionnaires take priority: reveal all detected correct options compactly. Otherwise, summarize or explain the main relevant content.

## Scope

### In Scope
- Trigger silent full-viewport capture through `Alt+A` or the toolbar action, without pre-capture page mutation or selection UI.
- On questionnaires, return direct answers such as `1: A · 2: C`; do not include reasoning. On other content, return a concise summary or explanation.
- Send captures through an MV3 service worker to a private Fastify service and provider-neutral multimodal AI adapter; validate inputs, bound requests, sanitize errors, and persist nothing.
- Inject/reuse one closeable Shadow-DOM hint bar with loading, success, and error states on supported pages.

### Out of Scope
- Answer reasoning, chat, history, login, database, sidebar, selection tools, persistence, and broad host access.
- Support guarantees for browser-internal pages, Web Stores, built-in viewers, or local files, where Chromium may prohibit injection.
- Production-grade caller authentication beyond strict CORS configuration and basic IP rate limiting.

## Capabilities

### New Capabilities
- `viewport-study-capture`: Explicit activation, visible-viewport capture, supported-surface handling, and request ordering.
- `study-response-policy`: Questionnaire prioritization/direct-answer formatting and fallback concise study behavior.
- `transient-hint-bar`: Singleton Shadow-DOM loading/success/error UI and close behavior.
- `private-multimodal-analysis`: Validated private API, provider abstraction, timeout/rate/error policy, and no persistence.

### Modified Capabilities
- None.

## Approach

Use `_execute_action` for both entry paths, `activeTab` plus `scripting` for event-scoped injection, and `captureVisibleTab` for JPEG capture. The service worker calls a fixed Fastify endpoint with roughly 6 MiB request/4 MiB decoded-image limits, delegating to `AIProvider.analyzeImage()`. Request IDs and one in-flight request per tab prevent stale results. Secrets, strict extension-origin allow-lists, and metadata-only logs remain server-side.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/extension/` | New | MV3 shell, capture orchestration, transport, and hint bar |
| `apps/api/` | New | Fastify endpoint, policies, and AI adapter |
| `apps/*/test/` | New | Unit, integration, and browser-flow coverage |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Restricted surfaces capture but reject UI injection | High | Detect/report unsupported surfaces honestly |
| Shortcut collision or unavailable `Alt+A` | Medium | Keep toolbar action and support remapping |
| Sensitive capture, abuse, latency, or wrong answers | Medium | Explicit activation, no persistence, limits, timeout, rate limiting |

## Rollback Plan

Disable distribution and backend access, remove both packages, and revoke provider credentials. No data migration is needed.

## Dependencies

- Stable extension IDs and backend origin per Chromium distribution; multimodal provider credentials.

## Success Criteria

- [ ] On supported pages, click and shortcut complete capture → analysis → one reusable result bar.
- [ ] Questionnaire and non-questionnaire responses follow the defined priority and formatting without answer explanations.
- [ ] Unsupported surfaces, oversize images, timeouts, and provider failures produce discreet errors without persistence.
- [ ] Manifest permissions and runtime dependencies remain minimal.
