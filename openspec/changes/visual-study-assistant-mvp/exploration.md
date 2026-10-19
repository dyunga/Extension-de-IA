## Exploration: visual-study-assistant-mvp

### Current State
The repository contains only OpenSpec bootstrap files: no product code, package manager, tests, or build configuration exists. This is a greenfield MV3 extension plus Fastify service.

The smallest safe flow is: action click or command → service worker resolves the invoking tab → injects/reuses one content-script hint bar and sends `loading` → `captureVisibleTab(windowId, { format: "jpeg", quality: 80 })` → service-worker `fetch` to the private API → `AIProvider.analyzeImage()` → message the same content-script instance with a Spanish answer (trimmed to 60 words) or a generic error.

**Proposed boundaries and structure**

| Boundary | Responsibility | Minimal structure |
|---|---|---|
| Extension shell | Manifest, action/command entry, MV3 lifecycle | `apps/extension/manifest.json`, `src/service-worker.ts` |
| Page UI | One Shadow-DOM host, React hint bar, no page data access | `src/content/index.tsx`, `HintBar.tsx`, `hint-bar.css` |
| Extension transport | Typed messages, capture/data-URL conversion, API client | `src/shared/messages.ts`, `src/shared/api.ts` |
| HTTP service | Validation, size/rate/timeout/error policy | `apps/api/src/server.ts`, `routes/analyze.ts` |
| AI adapter | Provider-independent image analysis | `ai/AIProvider.ts`, `ai/gemini-provider.ts` |

The bar is an idempotent, top-frame-only component: a fixed bottom-centered Shadow Root, translucent fit-content surface (`min-width`, `max-width`, wrapping text, dynamic height), icon/text/close button, and a reduced-motion-aware subtle entrance/transition. It must use `textContent`/React text rendering, never provider HTML. A document marker plus a single message listener prevents duplicate roots; each request has an ID, and only the newest request may replace the loading state.

**Permissions and activation**

| Manifest item | Decision | Reason |
|---|---|---|
| `activeTab` | Required | A click or extension command grants temporary access to the invoked active tab; it authorizes capture and event-driven injection without broad site access. |
| `scripting` | Required | Required for `chrome.scripting.executeScript()` programmatic injection. |
| `tabs` | Not needed | `tabs` only exposes sensitive tab metadata; the action/command supplies the tab and its `windowId`. |
| `commands` | Manifest key, not a permission | Declare `_execute_action` with suggested `Alt+A`; it triggers the action handler rather than `commands.onCommand`. `Alt+A` is a valid suggestion but may be unavailable because OS/Chrome/another extension wins; check `commands.getAll()` after install and let users remap it. |
| Page host permissions | Not needed | `activeTab` is sufficient for an explicit invocation on a supported page. Avoid `<all_urls>`. |
| Backend host permission | Required | Declare only the configured API origin (and explicit localhost development origin if applicable) because service-worker cross-origin `fetch` requires it. |
| `file:///` | Optional, only if local files are in scope | Local-file capture requires the user to enable file access. It is not covered by normal web-page support. |

**Injection choice and supported surfaces**

Programmatic injection is preferred over a static content script. The hint bar is needed only after an explicit capture, avoids persistent broad page access and startup work, and works with `activeTab` plus `scripting`. The service worker should first send a typed message; on a no-receiver failure, inject the bundled content script once, then resend. A static script would require broad match patterns/host access and unnecessarily runs on every matching navigation.

| Surface | Capture | Hint bar / MVP outcome |
|---|---|---|
| Normal `http`/`https` top-level pages | Supported after explicit activation | Supported. |
| `file:` pages | Only with user-enabled file access | Treat as unsupported unless explicitly enabled and tested. |
| Browser-internal pages (`chrome:`, `edge:`, `brave:` and new-tab/settings) | `captureVisibleTab` documentation permits sensitive-page capture with `activeTab` | Do **not** promise UI injection: `activeTab` does not grant restricted-page script access, so report a discreet unsupported-surface error. |
| Chrome Web Store | Do not promise | Script injection is restricted; return the same discreet unsupported-surface error. |
| Chromium built-in PDF viewer | Do not promise | It is browser-controlled extension/internal content; a viewport capture may be possible in a given browser, but the bar cannot be relied upon to inject. Treat it as unsupported for MVP. |

### Affected Areas
- `openspec/changes/visual-study-assistant-mvp/exploration.md` — exploration artifact for this greenfield change.
- `apps/extension/` — new Vite/React MV3 client, manifest, service worker, and injected hint bar.
- `apps/api/` — new TypeScript/Fastify backend and provider adapter.
- `apps/*/test/` — new unit, API integration, and browser-flow test setup.

### Approaches
1. **Event-scoped activeTab and programmatic injection** — Inject the React content script only after action/keyboard activation; keep API calls in the service worker.
   - Pros: Least privilege; no page-wide static script; directly satisfies explicit-action flow and one-instance UI.
   - Cons: Must handle injection/message races and unsupported browser-controlled surfaces.
   - Effort: Medium.

2. **Static content script on broad matches** — Preload the hint-bar listener everywhere and message it on activation.
   - Pros: Simpler message delivery after navigation.
   - Cons: Needs broad host access, increases review/privacy surface, and performs work on every page despite a strictly on-demand product.
   - Effort: Low.

### Recommendation
Choose event-scoped `activeTab` + `scripting` injection. Use a single `_execute_action` command for both `Alt+A` and the toolbar click, so both paths share Chrome's action activation semantics.

Send JSON `{ imageDataUrl }` from the service worker, using JPEG quality ~80 rather than PNG. Base64 expands data by roughly one third: set a Fastify route `bodyLimit` around 6 MiB and independently reject data URLs whose decoded image exceeds 4 MiB (and reject non-JPEG/PNG input). This is a deliberately conservative MVP limit: high-DPI/4K viewports can exceed it and must receive a discreet error, not be stored or retried. Chrome caps `captureVisibleTab` at two calls per second; additionally coalesce to one in-flight analysis per tab and use a monotonically increasing request ID so late answers cannot overwrite newer loading state.

The service worker cannot rely on globals: Chrome may terminate it after 30 seconds idle, when a `fetch` takes over 30 seconds to arrive, or when an event runs over five minutes. Keep each invocation self-contained, use an `AbortController` (for example 20 seconds), and treat a revived worker/no content-script receiver as a normal recoverable case. Do not persist screenshots, responses, or job history; an in-memory per-tab guard is advisory and resets safely.

Use `AIProvider.analyzeImage()` with a Google Gemini adapter using the official `@google/genai` SDK. Gemini accepts text plus inline base64 image parts with MIME type. Configure `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-flash-lite-latest`), `AI_TIMEOUT_MS`, `MAX_IMAGE_BYTES`, `RATE_LIMIT_MAX`, and `RATE_LIMIT_WINDOW_MS` only on the backend. The prompt must demand compact direct questionnaire answers or one useful Spanish study hint, and backend post-processing must cap fallback output at 60 words. The key never enters the extension build.

**Backend policy:** use Fastify v5 JSON-schema validation for an exact request shape and response schema; a fixed endpoint; `@fastify/rate-limit` keyed by source IP (document proxy trust); abort the provider call on timeout; log request IDs and safe metadata only, never data URLs; and a root error handler that maps provider/validation failures to sanitized Spanish-safe client codes. CORS must be a strict environment allow-list of exact `chrome-extension://<extension-id>` origins (one stable development ID and production IDs per browser distribution) with `POST`/`Content-Type` only and no credentials. Do not use `*`, origin reflection, regexes, or treat CORS as authentication: direct callers can forge/omit `Origin`, so no-login MVP rate limiting is only basic abuse protection.

**Testing viable from an empty directory:** establish TypeScript type-check/lint/unit tests for word limiting, image validation, message/request ordering, UI singleton/close behavior, provider timeout/error mapping, and CORS allow/deny. Add Fastify `inject()` integration tests for body limits, schema, rate limiting, and no-persistence behavior. Add one Playwright or Puppeteer Chromium E2E suite that loads the unpacked built extension with a fixed test ID, stubs the backend/provider, verifies action/command loading→result/error, duplicate invocation ordering, and a normal page. Manual compatibility checks remain necessary in Chrome, Edge, and Brave for action, shortcut collision, restricted surfaces, and file-access toggling.

### Risks
- The requested `Alt+A` can be overridden or unavailable; only an action command suggestion and post-install collision detection are reliable.
- `captureVisibleTab` can capture sensitive content after explicit activation; private-service transport, no persistence, privacy disclosure, and strict server logging are mandatory.
- A browser can capture a surface where it cannot inject the hint UI; browser-internal pages, the Web Store, and built-in PDF viewing must be explicitly excluded from MVP acceptance scenarios.
- A fixed extension ID is needed for strict production CORS; Chromium distributions may have different IDs. CORS is not an API-authentication boundary.
- High-resolution images, provider cost/latency, vision inaccuracies, and service-worker suspension require explicit rejection, timeout, ordering, and user-safe error behavior.

### Ready for Proposal
Yes — propose the least-privilege programmatic-injection architecture, supported-surface exclusions, 6 MiB JSON/4 MiB decoded image limit, strict origin configuration, and the no-auth abuse limitation as explicit MVP constraints. The proposal/spec/design must include the backend deployment origin and browser-distribution extension IDs as configuration decisions.
