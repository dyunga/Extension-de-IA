# Security Policy

## Report a vulnerability privately

Please do not disclose suspected vulnerabilities in a public issue, discussion, pull request, screenshot, or log.

If this repository has GitHub private vulnerability reporting enabled, use **Security → Report a vulnerability**. Otherwise, use a private contact channel explicitly listed by the repository owner or maintainer. If no private channel is available, open a minimal public issue asking the maintainer to enable a private reporting channel; do not include exploit details or secrets.

Include the affected version or commit, impact, reproduction steps, and a suggested remediation when possible. Remove API keys, local client tokens, extension IDs, screenshots, and personal data from the report.

## Scope and credential response

This project is designed for a local backend and unpacked browser extension. Reports involving loopback exposure, request authorization, secret leakage, unsafe logging, extension permissions, or dependency compromise are especially useful.

If a Gemini API key is exposed, revoke it in Google AI Studio immediately and replace `GEMINI_API_KEY` only in `server/.env`. If a local client token is exposed, regenerate it, update `server/.env`, rebuild the extension with the matching token, reload the extension, and restart the backend.
