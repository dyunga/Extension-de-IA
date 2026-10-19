# Tasks: Visual Study Assistant MVP

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,500–2,200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Workspace → API → MV3 worker → Shadow UI → E2E/docs |
| Delivery strategy | ask-always |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Rollback boundary |
|---|---|---|---|
| 1 | Workspace tooling | PR 1 | Root tooling only. |
| 2 | Secure API/provider | PR 2 | `server/` only. |
| 3 | MV3 capture/transport | PR 3 | Worker/manifest only. |
| 4 | Shadow hint UI | PR 4 | Content bundle only. |
| 5 | E2E and docs | PR 5 | Tests/docs only. |

## Phase 1: Workspace Foundation

- [x] 1.1 Create root `package.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, and npm workspaces for `server/` and `extension/`.
- [x] 1.2 Configure root ESLint, Vitest, Playwright, and build/typecheck/lint/test/test:e2e scripts; run each on the new workspace.

## Phase 2: Private Analysis API

- [x] 2.1 Create `server/src/{config.ts,app.ts,index.ts}` with env validation, 6 MiB body limit, exact-origin CORS, IP limits, `TRUST_PROXY` guidance, and metadata-only logs.
- [x] 2.2 Add `server/src/lib/{image.ts,errors.ts,response-policy.ts}` for canonical JPEG/PNG decoding, magic/4 MiB limits, stable errors, and 60-word Spanish fallback caps.
- [x] 2.3 Add `server/src/ai/{AIProvider.ts,gemini-provider.ts,prompt.ts}` and `routes/analyze.ts`: Gemini inline base64 image analysis, abort timeout, provider substitution, and direct `1: A · 2: C` questionnaire answers without reasoning.
- [x] 2.4 Add `server/test/{analyze.test.ts,gemini-provider.test.ts}` for schemas, limits, CORS, rate limits, timeout/failure sanitization, substitution, Gemini model/prompt/MIME/base64 payloads, response caps, empty responses, and safe logs, including failed/rejected paths.

## Phase 3: MV3 Capture and Transport

- [x] 3.1 Create `extension/{package.json,vite.config.ts,manifest.config.ts}` for fixed `service-worker.js`/`content.js`, validated `VITE_API_ORIGIN`, and least-privilege MV3 action/command permissions.
- [x] 3.2 Implement `extension/src/{messages.ts,api-client.ts,service-worker.ts}`: reject restricted tabs, JPEG viewport capture, per-tab UUID/abort ordering, post-capture loading, 50-second extension transport timeout coordinated with the backend 45-second default/maximum, and `ERR` badge fallback.
- [x] 3.3 Add `extension/test/worker.test.ts` for equivalent click/shortcut flows, no pre-capture UI, stale/abort handling, restricted/file surfaces, recovery, and API errors.

## Phase 4: Isolated Hint UI

- [x] 4.1 Create `extension/src/content/{index.tsx,HintBar.tsx,styles.ts,hint-bar.css}` with one open Shadow DOM host, text-only states, responsive bottom bar, and reduced-motion styling.
- [x] 4.2 Implement request-id filtering and state-aware dismissal: page clicks while loading do not suppress eventual success/error, loading `×` cancels/dismisses the matching active request, page clicks after success/error dismiss, cleanup removes the sole capture listener, stale same-request states remain suppressed after cancel, and new loading re-arms without a timer.
- [x] 4.3 Add `extension/test/hint-bar.test.tsx` for singleton/isolation, wrapping, state order, stale updates, loading-click preservation, page-click-after-result/`×` dismissal, cleanup, re-show, and no auto-dismiss.

## Phase 5: End-to-End Verification and Documentation

- [x] 5.1 Create `extension/e2e/extension.spec.ts` with strict automated Chromium coverage available here: unpacked MV3 load/service-worker wiring, deterministic manifest/output checks, content receiver injection on a local allowed page, Shadow-DOM hint display, and page-click dismissal; missing Chromium installation fails as setup evidence, while real toolbar/shortcut/capture-pixel behavior remains manual.
- [x] 5.2 Add `README.md` setup, secrets, build/load-unpacked, command matrix, privacy/no-persistence, restrictions, and credential-revocation rollback.
- [x] 5.3 Run all configured automated checks; record that Chrome/Edge/Brave toolbar/shortcut, collision, capture-pixel, restricted, and file-surface validation remain required manual checks, not passed evidence.

## Provider Migration Evidence

- [x] Replaced the OpenAI adapter and dependency with the official `@google/genai` Gemini SDK.
- [x] Preserved the `AIProvider.analyzeImage()` abstraction and migrated `POST /api/analyze` success responses to `{ "message": string }`.
- [x] Moved provider configuration to server-only `GEMINI_API_KEY` and `GEMINI_MODEL`; removed obsolete OpenAI env names from runtime config and `.env.example`.
- [x] Documented exact Google AI Studio key setup, free-tier quota/429 caveats, key rotation, and the rule that keys never go in extension/Vite variables.
- [x] Updated the verified default Gemini model to `gemini-flash-lite-latest` and documented that `EXTENSION_ORIGINS` is backend-only configuration copied from the installed extension ID.
- [x] Added bounded Gemini retries for transient 429/5xx failures while preserving sanitized public errors and no-retry behavior for 400/401/403/404.
