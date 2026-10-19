## Exploration: secure-self-hosted-release

### Current State
The backend already binds to `127.0.0.1`, keeps Gemini keys server-side in ignored `server/.env`, enforces exact extension origins through CORS, validates and size-limits images, rate-limits requests, and returns/logs sanitized data. However, `POST /api/analyze` does not independently authorize callers: direct loopback clients bypass CORS. The limiter compares the full `request.url`, so query strings bypass it, and its per-IP map has no bounded expiry. The server build emits `dist/src/index.js` plus tests although package metadata points to `dist/index.js` and has no `start` script. E2E reserves port 8787, can skip on launch failures, and CI is absent.

### Recommended Threat Model
- Protect against remote network callers, arbitrary web pages, accidental local exposure, and opportunistic local processes that do not possess the installed extension bundle/configuration.
- Do not claim protection from the machine owner, malware running as that owner, or a local process that can read the unpacked extension/bundle: a `VITE_*` token is inspectable and is not a secret from that principal.
- Preserve the per-user, localhost-only backend and user-owned Gemini API key. This change introduces neither a shared backend nor repository-owner custody of keys.

### Affected Areas
- `server/src/config.ts` — validate a fixed-length, per-install local client credential and bounded limiter settings.
- `server/src/app.ts` — enforce exact `Origin` plus token before analysis; use timing-safe equality; route-match without query strings; prune/cap limiter state.
- `server/src/routes/analyze.ts` — keep authorization before image/provider work; retain sanitized responses.
- `extension/src/api-client.ts` — send the bundled local-client-token header without logging it.
- `extension/vite.config.ts` — require the build-time token only for the extension bundle.
- `server/test/{analyze,fixtures}.ts`, `extension/test/api-client.test.ts` — cover authorization, query variants, cleanup/cap behavior, and no credential leakage.
- `server/{package.json,tsconfig.json}` and a small server clean-build helper — emit source-only `dist/index.js` and provide `npm start`.
- `extension/{e2e/extension.spec.ts,playwright.config.ts,package.json}` — use a dynamically allocated fixture port and temporary E2E build, guaranteed cleanup, and no capability skip.
- `.github/workflows/ci.yml` — install Chromium/Xvfb and fail on focused or skipped E2E tests in CI.
- `.env.example`, `.gitignore`, `README.md` — document local token generation/build pairing, ignore Playwright artifacts and the historical internal verification report, and remove machine-specific paths.

### Approaches
1. **Origin enforcement only** — Reject `POST /api/analyze` unless its `Origin` exactly matches an allowed extension origin, in addition to CORS.
   - Pros: No new setup; stops ordinary browser cross-origin requests.
   - Cons: Raw local clients can forge an Origin header; does not provide a second authorization factor.
   - Effort: Low

2. **Exact Origin plus per-install local credential (recommended)** — Require both the exact extension `Origin` and `X-Local-Client-Token`; compare a validated 32-byte random token with `timingSafeEqual`. Generate it locally, retain the canonical value only in ignored `server/.env`, and inject the same value into the extension build as `VITE_LOCAL_CLIENT_TOKEN`.
   - Pros: Blocks unauthenticated direct loopback calls and forged-Origin-only callers; preserves localhost-only, BYOK architecture; explicit about its limited local-machine boundary.
   - Cons: One setup/build coupling; the bundle token is inspectable by the machine owner and must never be described as a durable secret.
   - Effort: Medium

3. **Native companion or OS credential store** — Move a credential outside the extension bundle.
   - Pros: Stronger separation from web-extension code.
   - Cons: A substantial new install/runtime architecture; does not protect against the local machine owner; disproportionate for this release.
   - Effort: High

### Recommendation
Adopt approach 2 as proportionate defense in depth. On every analysis request, first require an allowed exact Origin and a correctly sized `X-Local-Client-Token`; reject missing/invalid values with the existing generic public error and redact that header. Use Node's `crypto.timingSafeEqual` only after fixed-length decoding/validation, returning false for unequal lengths. Keep CORS as browser policy, not authorization.

The onboarding command should generate a cryptographically random 32-byte base64url token locally, write it only to ignored `server/.env`, and pass it to the extension build process as `VITE_LOCAL_CLIENT_TOKEN`; examples contain placeholders only. Rebuilding the extension is required after token rotation. No repository file, CI secret, shared service, or owner-managed key stores the token. Document that this protects against unauthenticated local callers, not the machine owner or malware that can inspect the installed bundle.

For rate limiting, match Fastify's matched route (`request.routeOptions.url`) rather than the raw URL. Prune expired entries periodically/on insertion and bound the map with a configured maximum, evicting the earliest-expiring entry when full. The route's current body, timeout, and rate limits remain in effect.

For production, compile only `server/src/**` with `rootDir: src`, clean `server/dist` before build, declare `start: node dist/index.js`, and add a smoke test for `build` then `start` with a controlled non-conflicting port. E2E must bind its fixture to port `0`, build a temporary extension for the allocated origin, close browser/server/temp directory in `finally`, set `forbidOnly: true` in CI, and remove `test.skip`; CI provisions the headed Chromium environment explicitly. Local manual backend use on 8787 remains unchanged.

### Blockers vs Nice-to-Have
| Priority | Scope | Rationale |
|---|---|---|
| Blocker | Exact Origin enforcement plus per-install token, timing-safe comparison, header redaction, and tests | Direct localhost requests currently reach the paid/provider-backed endpoint without backend authorization. |
| Blocker | Route-based limiter matching plus TTL pruning and maximum entry cap | Query strings bypass limits and arbitrary source addresses can grow memory indefinitely. |
| Blocker | Source-only clean server build and valid `start` contract with smoke coverage | The published backend cannot be started from declared package metadata. |
| Blocker | Isolated strict E2E and CI (`forbidOnly`, no skips) | The release gate collides with local use and can silently avoid browser coverage. |
| Blocker | Ignore test artifacts; remove README absolute path; prevent committing the existing MVP verify report containing an absolute temp path | Private repositories still need clean, portable, non-machine-specific initial history. The completed MVP artifact itself remains untouched. |
| Nice-to-have | Explicit limiter telemetry/counters without request content | Useful diagnostics, but not required to close the bypass or memory-growth risks. |
| Nice-to-have | Native-host credential storage | Higher isolation, but disproportionate and still not a defense against the machine owner. |

### Test and Rollback Strategy
- Unit/integration: allowed Origin + correct token succeeds; missing/wrong/length-invalid token and wrong/missing Origin fail before provider invocation; assert redacted logs/errors; query-string requests share one rate bucket; expired entries prune and entry cap holds.
- Build/runtime: assert `server/dist/index.js` is the only server entry layout needed, tests are absent from distribution, and `npm start` listens with a test port.
- E2E/CI: run with a developer backend already on 8787 to prove dynamic fixture isolation; any browser provisioning/launch failure fails CI; `test.only` fails CI; cleanup releases all temporary resources.
- Regression: retain tests for API-key server-only handling, exact origin allowlist, loopback binding, sanitized logs/errors, body/image/timeout/rate limits, and no image persistence.
- Rollback: revert this self-contained hardening change, restore the previous extension build only if its matching backend config is restored, and rotate the local token whenever a built extension copy is no longer trusted. Do not roll back to a public/shared backend.

### Estimated Changed Lines
Approximately **300–380 changed lines** across code, tests, CI, and documentation. This is within the 400-line review budget but near its limit; with `delivery_strategy: ask-always`, confirm whether to keep one focused release-hardening review or split CI/E2E hygiene from backend authorization/build hardening before apply.

### Risks
- A local client token can be extracted from an extension bundle; presenting it as a secret would be a security error. It is a layered request credential, not user authentication or malware defense.
- Token rotation requires rebuilding/reloading the extension and restarting the backend; mismatched copies fail closed.
- Enforcing Origin may reject non-extension diagnostic clients; tests and docs should prescribe the supported extension path rather than weaken enforcement.
- The existing MVP verification report cannot be edited under this change's boundary; it must be ignored from the initial repository history rather than rewritten.
- Headed extension E2E requires explicit CI display/browser provisioning; that is an intentional strict failure condition.

### Ready for Proposal
Yes — the security boundary and remediation scope are defined. One product decision remains: confirm whether the initial private repository should retain OpenSpec artifacts other than the completed MVP verification report, or exclude the historical `openspec/changes/visual-study-assistant-mvp/` directory entirely from its first commit.
