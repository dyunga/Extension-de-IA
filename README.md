# Visual Study Assistant

Visual Study Assistant is a Chromium MV3 extension with a local-only Fastify backend. On explicit user action, it captures the visible tab, sends the image to your own backend and Gemini API key, and displays a compact Spanish study hint.

Each installation uses its own extension ID, local client token, and Gemini key. The Gemini key never belongs in the extension build.

## Quick start

### 1. Prerequisites

- Node.js 22.12.0 or newer within Node 22, Node 24, or Node 26 and newer (`^22.12.0 || ^24.0.0 || >=26.0.0`), plus npm. Node 23 and 25 are not supported.
- Chrome, Edge, or Brave
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
- PowerShell for the commands below

### 2. Clone and install

Replace `<repository-url>` with this repository's GitHub clone URL, then run:

```powershell
git clone <repository-url> visual-study-assistant
Set-Location visual-study-assistant
npm ci
```

### 3. Generate one local client token

Generate a base64url token from 32 cryptographically random bytes. Keep the resulting `$token` for both the extension build and `server/.env`.

```powershell
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $bytes = New-Object byte[] 32
  $rng.GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
} finally {
  $rng.Dispose()
}
$token
```

Do not publish or commit this token. It is bundled into your local unpacked extension, so it is a local request-authentication layer, not a substitute for protecting the Gemini key.

### 4. Build the extension

```powershell
$env:VITE_API_ORIGIN = "http://127.0.0.1:8787"
$env:VITE_LOCAL_CLIENT_TOKEN = $token
npm run build -w extension
```

Only `VITE_API_ORIGIN` and `VITE_LOCAL_CLIENT_TOKEN` are extension build variables. **Never create a `VITE_GEMINI_API_KEY` variable or place the Gemini key anywhere under `extension/`.**

### 5. Load the unpacked extension and find its ID

1. Open the browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's `extension/dist` directory.
5. Copy the 32-character extension ID shown on the extension card.

Keep using the same checkout path when rebuilding. Moving the unpacked extension may change its generated ID; if it changes, update `EXTENSION_ORIGINS` and restart the backend.

### 6. Configure the local backend

Copy the server-only template:

```powershell
Copy-Item server/.env.example server/.env
```

Edit `server/.env` and replace these three placeholders:

```dotenv
EXTENSION_ORIGINS=chrome-extension://your-32-character-extension-id
GEMINI_API_KEY=your-own-google-ai-studio-key
LOCAL_CLIENT_TOKEN=the-exact-value-generated-in-step-3
```

The token in `LOCAL_CLIENT_TOKEN` must exactly match the token used as `VITE_LOCAL_CLIENT_TOKEN` when building the extension. The accepted format is the canonical, unpadded base64url encoding of exactly 32 bytes; alternate text encodings of the same bytes are rejected. `server/.env` is ignored by Git and must remain local.

### 7. Start the backend

For development:

```powershell
npm run dev -w server
```

For the production build:

```powershell
npm run build -w server
npm start -w server
```

The backend listens only on `127.0.0.1:8787` by default.

## Use the extension

- Pin the extension and click its toolbar icon, or press `Alt+A`.
- Both activation methods run the same MV3 action handler.
- If `Alt+A` conflicts with another shortcut, assign another shortcut on the browser-specific page:
  - Chrome: `chrome://extensions/shortcuts`
  - Edge: `edge://extensions/shortcuts`
  - Brave: `brave://extensions/shortcuts`
- The hint appears near the bottom center. Use `×` to cancel/dismiss it; a page click dismisses completed results.

The browser blocks extension scripting on restricted surfaces such as browser settings pages, extension stores, built-in viewers, and some local files. Open a normal `http://` or `https://` page and try again.

## Configuration reference

All backend settings belong in `server/.env`.

| Variable | Purpose |
|---|---|
| `HOST` | Fixed loopback address: `127.0.0.1`. Other bind addresses are rejected. |
| `PORT` | Local backend port. Default: `8787`. Keep it aligned with `VITE_API_ORIGIN`. |
| `EXTENSION_ORIGINS` | Comma-separated exact `chrome-extension://<id>` origins. Wildcards are rejected. |
| `LOCAL_CLIENT_TOKEN` | Canonical unpadded base64url encoding of exactly 32 random bytes; must match the extension build token. |
| `GEMINI_API_KEY` | Your server-side Google AI Studio key. Never expose it through `VITE_*`. |
| `GEMINI_MODEL` | Gemini model; default: `gemini-flash-lite-latest`. Availability and quotas vary by account/region. |
| `AI_TIMEOUT_MS` | Provider deadline, at most 45 seconds. |
| `MAX_IMAGE_BYTES` | Maximum decoded image size; default: 4 MiB. |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW` | Per-source analyze-request limit. Maximum count: 10,000; maximum window: 24 hours. |
| `RATE_LIMIT_MAX_ENTRIES` | Maximum in-memory limiter entries; default: 10,000, maximum: 100,000. |
| `TRUST_PROXY` | Leave `false` for direct local use. Accepts only `true` or `false`. |

## Troubleshooting

### The extension shows an error badge or no hint

1. Confirm the backend is running.
2. Confirm the page is not a restricted browser surface.
3. Open the extension card's **service worker** inspector for sanitized errors.
4. Rebuild and reload the unpacked extension after changing either `VITE_*` value.

### The backend returns 403

- Confirm `EXTENSION_ORIGINS` exactly matches the currently loaded extension ID.
- Confirm `LOCAL_CLIENT_TOKEN` exactly matches the token used for `VITE_LOCAL_CLIENT_TOKEN` during the latest build.
- Restart the backend after editing `server/.env`, then reload the unpacked extension after rebuilding.

The response intentionally does not reveal which authentication check failed.

### Gemini fails or times out

- Confirm `GEMINI_API_KEY` is valid for your own Google AI Studio project.
- Quota and model availability depend on the account, project, billing status, and region.
- For HTTP 429 responses, wait for quota reset or use another eligible project/key.
- The backend deadline is 45 seconds; the extension transport deadline is 50 seconds.

### Port 8787 is already in use

Choose another local port in `server/.env`, rebuild with the matching `VITE_API_ORIGIN`, and reload the extension. The current Playwright E2E fixture also binds `127.0.0.1:8787`; stop the backend before running E2E.

## Rotate credentials

### Rotate the local client token

1. Stop the backend.
2. Generate a new token with the command in step 3.
3. Update `LOCAL_CLIENT_TOKEN` in `server/.env`.
4. Rebuild with the same value in `VITE_LOCAL_CLIENT_TOKEN`.
5. Reload the unpacked extension and restart the backend.

### Rotate the Gemini key

Revoke/replace the key in Google AI Studio, update only `GEMINI_API_KEY` in `server/.env`, and restart the backend. The extension does not need rebuilding.

## Security model

- The backend binds only to loopback and rejects non-loopback host configuration.
- `/api/analyze` requires both an exact configured extension `Origin` and the matching local token before body decoding or provider work.
- CORS is browser policy, not authorization; the token adds protection against unrelated local web origins and direct unauthenticated requests.
- A user with access to the local browser profile or built extension can recover the local token. The Gemini key remains backend-only and is the credential that MUST stay secret.
- Request bodies, response bodies, authorization headers, local tokens, Gemini keys, screenshots, prompts, and model output are not intentionally logged or persisted.
- The extension requests only `activeTab`, `scripting`, and the exact configured local backend host permission.
- Model answers can be wrong. Verify important results independently.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Verification

```powershell
npm run typecheck
npm test
npm run lint
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $bytes = New-Object byte[] 32
  $rng.GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
} finally {
  $rng.Dispose()
}
$env:VITE_API_ORIGIN = "http://127.0.0.1:8787"
$env:VITE_LOCAL_CLIENT_TOKEN = $token
npm run build
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

Local E2E requires an installed Playwright Chromium and a free port 8787:

```powershell
npm run test:e2e
```

E2E is intentionally excluded from CI for now. The existing unpacked-extension test requires a headed Chromium environment and has a fixed port-8787 fixture; making both portable without weakening the real-extension test is outside this surgical hardening change. In CI, unavailable headed extension support previously produced a skip, which must not be treated as success.

Manual release checks remain necessary for real screenshot pixels, toolbar activation, `Alt+A`, shortcut collisions, restricted pages, and unpacked operation in Chrome, Edge, and Brave.
