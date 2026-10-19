# Private Multimodal Analysis Specification

## Purpose

Define the bounded private API and provider-neutral analysis contract.

## Requirements

### Requirement: Validated image request contract

The API MUST accept an exact JSON object containing `imageDataUrl`. The value MUST be a valid base64 JPEG or PNG data URL. Requests exceeding the configured body limit (default 6 MiB), malformed data, unknown fields, or decoded images over 4 MiB MUST be rejected before provider analysis.

#### Scenario: Valid request
- GIVEN an allowed caller sends a valid in-limit image data URL
- WHEN the API validates the request
- THEN it SHALL submit the decoded image for analysis and return a schema-valid `{ "message": string }` result

#### Scenario: Invalid or oversized request
- GIVEN malformed base64, an unsupported media type, or a decoded image over 4 MiB
- WHEN the API validates the request
- THEN it MUST reject it without invoking the provider

### Requirement: Bounded and sanitized service

The API MUST enforce a configured provider timeout and per-source rate limit. Transient provider HTTP 429 and 5xx failures SHOULD be retried within the configured timeout, while 400/401/403/404 failures MUST NOT be retried. Validation, limit, timeout, and provider failures MUST return stable sanitized client errors without leaking provider details, stack traces, secrets, or captured content.

#### Scenario: Timeout or provider failure
- GIVEN analysis exceeds the configured timeout or the provider fails
- WHEN the API handles the failure
- THEN the provider work MUST be cancelled where supported and a sanitized error MUST be returned

#### Scenario: Rate limit exceeded
- GIVEN a source exceeds its configured request allowance
- WHEN another request arrives within the limit window
- THEN the API MUST reject it without provider analysis

### Requirement: Restrictive extension-origin CORS

The API SHALL allow only exact configured `chrome-extension://` origins for approved distribution IDs, `POST`, and `Content-Type`, without credentials. It MUST NOT use wildcard, reflected, or regular-expression origins, and CORS MUST NOT be represented as caller authentication.

#### Scenario: Origin allow and deny
- GIVEN one exact allow-listed extension origin and one other origin
- WHEN each performs a preflight or request
- THEN only the allow-listed origin SHALL receive CORS authorization

### Requirement: Provider abstraction and secret isolation

Analysis MUST depend on a provider-neutral image-analysis contract. Provider choice, credentials, model, limits, and timeout SHALL come from backend environment configuration only; secrets MUST NOT enter extension artifacts or client responses.

#### Scenario: Provider substitution
- GIVEN a conforming alternate provider is configured
- WHEN a valid request is analyzed
- THEN the API contract and extension behavior MUST remain unchanged

### Requirement: No persistence

The system MUST NOT persist screenshots, data URLs, decoded images, provider outputs, or request history. Operational logs MAY contain request identity and safe metadata but MUST NOT contain image or response content.

#### Scenario: Completed and failed requests
- GIVEN successful, rejected, and failed analyses
- WHEN each request ends
- THEN no captured or generated content MUST remain in durable storage or logs

### Requirement: Backend verification

Automated tests MUST cover schema and size validation, CORS allow/deny, timeout/error mapping, rate limiting, provider substitution, response policy boundaries, and absence of persisted content.

#### Scenario: Backend quality gate
- GIVEN a release candidate
- WHEN configured typecheck, unit, and API integration suites run
- THEN all required checks MUST pass
