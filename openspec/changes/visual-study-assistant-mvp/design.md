# Design: Visual Study Assistant MVP

## Technical Approach

Use npm workspaces with `extension/` and `server/`. An MV3 worker owns activation, capture, ordering, and transport; an on-demand React bundle owns one Shadow-DOM hint. Fastify validates images before an environment-configured Google Gemini adapter. Nothing is persisted.

## Architecture Decisions

| Decision | Choice and rationale | Rejected tradeoff |
|---|---|---|
| Least privilege | MV3 uses `activeTab`, `scripting`, one backend host, an action worker, and `_execute_action` on `Alt+A`. `chrome.action.onClicked` handles click and command. | Static scripts require broad hosts and run continuously; explicit activation justifies programmatic injection. |
| Capture ordering | Set loading in worker memory, run `captureVisibleTab(tab.windowId,{format:"jpeg",quality:80})`, then ensure/inject receiver and publish loading, then fetch. Thus the current request's hint cannot enter its capture and loading still precedes remote work. | Rendering loading first contradicts the unmodified screenshot requirement. A previously retained result can be captured until the user clicks the page or `×`; absolute exclusion of an already-visible prior result conflicts with “no pre-capture mutation.” |
| Ordering | `crypto.randomUUID()` per activation; `Map<tabId,{requestId,AbortController}>` aborts the prior fetch. The receiver accepts every `loading` as current and accepts `success/error` only when `requestId` equals current. | Counters do not survive worker restart; equality is sufficient and restart-safe. |
| Hint dismissal | While loading, webpage clicks are ignored so the eventual result/error remains visible; explicit `×` sends a typed cancellation message for the matching active request, aborts worker-side work, hides the UI, and suppresses late same-request states. After success/error, any page click or `×` dismisses. New loading clears the marker, cleans any old listener, and installs one listener. No timer. | A 12-second timer can hide unread content; permanent listeners risk leaks and duplicates. Treating loading page-click as cancellation can permanently hide the result. |
| Build | Vite multi-entry emits fixed `service-worker.js`/`content.js`; other assets may hash. A dependency-free Vite hook emits `manifest.json` from `manifest.config.ts`, validates build-time `VITE_API_ORIGIN`, and references only fixed entries. | Hashed entry names or a manually divergent manifest are fragile. |

## Data Flow

```text
action/Alt+A -> worker -> captureVisibleTab -> inject/ping -> loading
                    -> POST /api/analyze -> AIProvider -> success/error -> hint
```

Restricted/non-HTTP(S), Web Store, built-in viewer, and non-enabled `file:` tabs are rejected before capture/API. Injection/capture failures become sanitized extension-controlled action badge text (`ERR`, cleared after 3s) because no page surface is reliable.

## Interfaces / Contracts

Messages are `{type:"hint/loading",requestId}`, `{type:"hint/success",requestId,text}`, or `{type:"hint/error",requestId,code,message}`; `code` is `UNSUPPORTED|CAPTURE_FAILED|IMAGE_TOO_LARGE|TIMEOUT|RATE_LIMITED|SERVICE_UNAVAILABLE`. The API accepts only `{imageDataUrl:"data:image/jpeg|png;base64,..."}` and returns `{message}` or `{error:{code,message}}`; Fastify's generated request ID is response-header/log correlation only.

`AIProvider.analyzeImage(input:{bytes:Uint8Array,mime:"image/jpeg"|"image/png",signal:AbortSignal}): Promise<string>`. The Gemini adapter uses `@google/genai`, `models.generateContent`, `GEMINI_API_KEY`, and configurable `GEMINI_MODEL` (default `gemini-flash-lite-latest`). It sends the validated screenshot as an inline base64 image part with the original MIME type plus the established study prompt. The SDK receives the route abort signal through `config.abortSignal` when supported, while the route-level deadline still protects against ignored cancellation. The adapter retries only transient Gemini HTTP 429 and 5xx failures with bounded exponential backoff that observes the same abort signal, and it does not retry 400/401/403/404 account/model/configuration failures. The prompt says: prioritize centered visible questionnaires; output only `1: A · 2: C...` in visible order with no explanation; otherwise provide useful Spanish study help of at most 60 words. Server post-processing enforces non-empty output and the 60-word fallback cap.

Fastify uses `@fastify/cors` and an app-local per-source limiter; exact `EXTENSION_ORIGINS` (`chrome-extension://<id>`), POST/Content-Type, no credentials, IP keying, documented `TRUST_PROXY`, `RATE_LIMIT_*`, 6 MiB `bodyLimit`, and JSON schemas with `additionalProperties:false`. Base64 is canonical-decoded, MIME magic-checked, and limited by `MAX_IMAGE_BYTES` (4 MiB) before provider invocation. `AI_TIMEOUT_MS` defaults to 45s and is capped at 45s; the extension aborts superseded/canceled calls and applies a 50s transport timeout so the backend owns normal timeout responses. Central errors expose stable codes only. Logger serializers retain request ID/status/duration/byte count plus safe provider attempt metadata, never bodies, images, prompts, provider output, API keys, secrets, or stack traces in responses.

The initializer uses a document-global marker, one host, open ShadowRoot, React root, and runtime listener. A cleanup-aware visibility path owns one capture-phase `document` click listener, removing it before re-show and dismissal. While loading, that listener ignores page clicks; `×` calls `dismiss(requestId)`, sends `{type:"request/cancel",requestId}` to the worker, and late states for that canceled request stay hidden. After success/error, page clicks and `×` dismiss globally. Newer loading reopens and re-arms. Toolbar clicks are outside the document and the shortcut is keyboard-only, so activation cannot self-dismiss. No auto-dismiss timer exists. CSS provides bottom-center responsive layout, a translucent blurred shell, localized dark text backing for readability, and reduced-motion overrides.

## Intended File Structure

```text
package.json  tsconfig.base.json  .env.example
extension/{package.json,vite.config.ts,manifest.config.ts,src/{service-worker.ts,api-client.ts,messages.ts,content/{index.tsx,HintBar.tsx,hint-bar.css}},test/{worker.test.tsx,hint-bar.test.tsx},e2e/extension.spec.ts}
server/{package.json,src/{app.ts,index.ts,config.ts,routes/analyze.ts,lib/{image.ts,errors.ts,response-policy.ts},ai/{AIProvider.ts,gemini-provider.ts,prompt.ts}},test/{analyze.test.ts,gemini-provider.test.ts}}
```

## Testing Strategy

Vitest covers protocol/stale rejection, singleton/close/wrapping, page-click and `×` dismissal, hidden later states, re-show, listener cleanup, image limits, response caps, and aborts. Fastify `inject()` covers schemas, CORS, rate limits, sanitized failures, substitution, and safe logs. Playwright exercises injected UI with a stub API. Manually verify toolbar/shortcut gestures, capture pixels, collisions, restricted/file surfaces, and Chrome/Edge/Brave parity.

## Migration / Rollout

No migration. Deploy server first, configure exact IDs/origin and secrets, smoke-test, then distribute the extension. CORS is not authentication; IP limits provide only basic abuse resistance. Screenshots are sensitive and model answers can be wrong; use TLS, no persistence, bounded cost/latency, privacy disclosure, and credential revocation for rollback.

## Open Questions

None blocking.
