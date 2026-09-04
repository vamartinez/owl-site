# Implementation Plan: worker-self-checkin

## Overview

Implementation of the public, worker-facing self-service check-in surface — the product's documented "killer workflow": a worker scans a persistent gate QR code (or opens a one-time SMS magic link), proves their identity without any staff member and without a Cognito session, and within a few seconds is told whether they may enter the site today, with an explanation scoped to what a worker is allowed to see per `docs/ROLES.md`.

The implementation follows the established project patterns: TypeScript throughout, CDK for infrastructure, Lambda handlers with method + resource routing, and React + TanStack Query on the frontend. The core discipline is **reuse, not reinvention**: the feature reuses the `contractor-forms-qr` public UUID-token pattern (`TOKEN#{token}` GSI, client-side `qrcode` generation, `rate-limiter.ts` + `sanitizer.ts` abuse protection), the existing Compliance Decision Engine (`evaluateDecision`), the `access-service`'s `recordScanSession`, and the notification-service (`sendSms`). A new `self-checkin-service` Lambda hosts both the authenticated admin endpoints (generate/regenerate QR token, send SMS link) and the public unauthenticated endpoints (token resolution, identity verification, decision retrieval). The existing staff-operated gate terminal is untouched; both flows coexist.

This is a standalone spec authored for its own separate implementation pass; its tasks are not gated by any live deploy of the parent orchestration.

## Tasks

- [ ] 1. Infrastructure — CDK tables, Lambda, and API Gateway routes
  - [ ] 1.1 Add DynamoDB table definitions to data-stack
    - Add `CheckinTokens` table with PK/SK, GSI1 (`TOKEN#{token}`) and GSI2 (`SITE#{site_id}`), PAY_PER_REQUEST, `ttl` attribute, and point-in-time recovery in prod
    - Add `SelfCheckinAuditLog` table with PK/SK, GSI1 (tenant), `expiresAt` TTL attribute, and `RemovalPolicy.RETAIN`, following the `FormAuditLog` shape
    - Export both table references for use in api-stack
    - _Requirements: 1.2, 7.6_

  - [ ] 1.2 Add Self Check-In Service Lambda function to api-stack
    - Create `self-checkin-service` Lambda (256 MB, 29s timeout) following the `formsServiceFn` definition
    - Grant read/write on `CheckinTokens`, `ScanSessions`, `SelfCheckinAuditLog`, `RateLimits`
    - Grant read on `Workers`, `Sites`, `Policies`, `DecisionRecords`
    - Grant SNS publish for SMS delivery
    - Pass all table names, the notification topic/config, and public domain as environment variables
    - _Requirements: 1.1, 4.1, 5.1_

  - [ ] 1.3 Add authenticated API Gateway routes for the Self Check-In Service
    - Add `POST /sites/{siteId}/checkin-token` and `POST /sites/{siteId}/checkin-token/regenerate` with the Cognito authorizer
    - Add `POST /checkin/sms-link` with the Cognito authorizer
    - Wire all three routes to the self-checkin-service Lambda integration
    - _Requirements: 1.1, 1.4, 4.1_

  - [ ] 1.4 Add public API Gateway routes for the Self Check-In Service
    - Add `GET /public/check-in/{token}` and `POST /public/check-in/{token}/verify` under the existing `/public` resource, without an authorizer, mirroring `/public/forms/{token}`
    - Wire both routes to the self-checkin-service Lambda integration
    - _Requirements: 2.4_

- [ ] 2. Backend core — types, RBAC, handler routing, audit module
  - [ ] 2.1 Create domain types and interfaces
    - Create `packages/backend/src/services/self-checkin/types.ts`
    - Define `CheckinTokenKind` (`site_persistent` | `sms_magic_link`), `CheckinTokenStatus` (`active` | `invalidated` | `consumed`), `CheckinOrigin` (`self_qr` | `self_sms`), and the `CheckinToken`, `WorkerView`, and `SelfCheckinAuditEntry` interfaces
    - _Requirements: 1.1, 3.6, 5.5_

  - [ ] 2.2 Add RBAC permissions for the self-checkin module
    - Add `access:manage_checkin_token` and `access:send_checkin_link` permissions to `rbac.ts`
    - Assign both permissions to `platform_admin`, `tenant_admin`, and `site_admin` only
    - Ensure `supervisor`, `cso`, `gate_operator`, and `worker` receive neither permission
    - _Requirements: 1.5, 4.6_

  - [ ] 2.3 Write unit test for RBAC assignment
    - Assert `access:manage_checkin_token` and `access:send_checkin_link` are granted to `platform_admin`, `tenant_admin`, `site_admin` and denied to `supervisor`, `cso`, `gate_operator`, `worker`
    - _Requirements: 1.5, 4.6_

  - [ ] 2.4 Create the authenticated route group in the handler router
    - Create `packages/backend/src/services/self-checkin/handler.ts`
    - Implement routing by `httpMethod` + `resource` for the authenticated endpoints
    - Route each through `authenticateRequest` → `enforcePermission` and return structured responses via `createSuccessResponse` / `badRequest` / `notFound` / `forbidden`
    - _Requirements: 1.1, 1.5_

  - [ ] 2.5 Create the public route group in the handler router
    - Route `/public/check-in/*` endpoints without auth, gated instead by rate-limiter + bot detection
    - Ensure no `Authorization` header is required and no Cognito session is consulted
    - _Requirements: 2.4, 3.7_

  - [ ] 2.6 Implement the self-checkin audit module
    - Create `packages/backend/src/services/self-checkin/audit.ts`
    - Implement `logCheckinAudit(params)` that writes an immutable entry to `SelfCheckinAuditLog`
    - Capture `action`, `origin_channel`, `token_ref`, `outcome`, `ip_address`, `timestamp` (ISO 8601 UTC), and `tenant_id`
    - Set `expiresAt` TTL to 365 days from creation
    - _Requirements: 7.6_

  - [ ] 2.7 Write property test for the audit module
    - **Property: Every check-in attempt (allowed, denied, or rejected) records exactly one immutable audit entry with origin IP, origin channel, token reference, and outcome**
    - **Validates: Requirements 7.6**

- [ ] 3. Backend checkin-token module — site token lifecycle and SMS token
  - [ ] 3.1 Implement site check-in token generation and reuse
    - Create `packages/backend/src/services/self-checkin/checkin-token.ts`
    - Implement `POST /sites/{siteId}/checkin-token`: validate the site exists and belongs to the requester's tenant
    - Generate a UUID v4 `site_persistent` token bound to the site + tenant, or return the existing active token found via GSI2 rather than creating a duplicate
    - Return the token and absolute public URL `/check-in/{token}`
    - Reject with a non-disclosive 404 if the site does not exist or belongs to another tenant
    - _Requirements: 1.1, 1.2, 1.3, 1.7_

  - [ ] 3.2 Implement site token regeneration and invalidation
    - Implement `POST /sites/{siteId}/checkin-token/regenerate`
    - Flip the previous active site token to `invalidated` and issue a new UUID v4 token
    - Ensure previously printed QR codes stop resolving
    - _Requirements: 1.4_

  - [ ] 3.3 Implement token resolution via the TOKEN#{token} GSI
    - Implement `resolveToken(token)` querying `CheckinTokens.GSI1` on `TOKEN#{token}`
    - Return a resolved token only when `status === 'active'` (and, for SMS tokens, `expires_at` in the future and not consumed)
    - For every other case return a single uniform "not valid" outcome
    - Scope resolution to the token's bound `tenant_id` and `site_id`
    - _Requirements: 2.3, 2.6, 4.2, 7.5_

  - [ ] 3.4 Implement SMS single-use token generation and consumption
    - Implement generation of a single-use `sms_magic_link` UUID v4 token bound to worker + site + tenant with `expires_at` and `ttl`
    - Implement `consumeToken(token)` that sets `status = 'consumed'` + `consumed_at`, mirroring `access-service`'s `markTokenUsed` semantics
    - Reject reuse of a consumed token
    - _Requirements: 4.1, 4.2, 4.4_

  - [ ] 3.5 Write property tests for token lifecycle
    - **Property: For any token whose status is not `active` (or SMS token past `expires_at`), resolution returns the uniform "no longer valid" outcome**
    - **Property: An SMS magic-link token that has been consumed can never be resolved or reused**
    - **Validates: Requirements 2.3, 4.4, 7.5**

- [ ] 4. Backend identity-verify module
  - [ ] 4.1 Implement the phone-last4 + date-of-birth challenge
    - Create `packages/backend/src/services/self-checkin/identity-verify.ts`
    - Apply `sanitizeInput` to the last-4-phone and date-of-birth inputs before matching
    - Match, scoped to the token's tenant, for exactly one Worker whose stored phone ends in those 4 digits and whose DOB matches
    - _Requirements: 3.1, 3.2_

  - [ ] 4.2 Implement the exactly-one-match, non-disclosive result
    - Return the resolved `worker_id` only on an exact single match
    - Return the identical generic "We could not verify your identity" result for both zero matches and more-than-one match
    - Ensure the response never reveals whether the phone digits, the DOB, or neither matched
    - _Requirements: 3.3_

  - [ ] 4.3 Handle the SMS flow identified-worker path
    - When the resolved token is a valid `sms_magic_link` token, treat the worker as already identified and skip the phone + DOB challenge
    - _Requirements: 3.6_

  - [ ] 4.4 Ensure no Cognito session is ever created for the worker
    - Confirm the identity-verify and handler paths never create, issue, or require a Cognito session, token, or user account for the worker
    - _Requirements: 3.7_

  - [ ] 4.5 Enforce the per-token+IP identity-attempt rate limit
    - Gate verification attempts with `checkRateLimit('CHECKIN#{token}', ip)` so repeated failed challenges cannot enumerate worker records
    - When the limit trips, return the wait-and-retry response including remaining wait time
    - _Requirements: 3.4, 3.5_

  - [ ] 4.6 Write property test for identity non-disclosure
    - **Property: For any pair of failed identity challenges (any zero-match input, any multi-match input), the verify response body is byte-identical**
    - **Validates: Requirements 3.3, 7.5**

- [ ] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Backend decision-engine integration and scan-session recording
  - [ ] 6.1 Integrate evaluateDecision for identified workers
    - Invoke the existing `evaluateDecision` with `decision_type = SITE_ACCESS`, `subject_type = 'worker'`, the resolved `subject_id`, the token's `site_id`, and the tenant, exactly the way `access-service` calls it
    - Return the engine's `allowed` / `conditional` / `denied` result and reasons
    - _Requirements: 5.1, 5.2_

  - [ ] 6.2 Implement engine-error and deny-on-unavailable handling
    - On an engine error result, treat the check-in as `denied` and surface the engine's returned reason
    - On the engine being unavailable or throwing, return `denied` with reason "system temporarily unable to evaluate" (never allow-by-default)
    - Preserve the existing Decision_Engine contract unchanged
    - _Requirements: 5.3, 5.4, 5.6_

  - [ ] 6.3 Record a scan session for every check-in attempt
    - Call the existing `recordScanSession` with `scanner_type` `'qr'` or `'sms'`, an additive `origin_channel` (`self_qr` | `self_sms`), `token_ref` = `CheckinTokens.token_id`, and `decision_ref` = the engine's `decision_id`
    - Ensure the additive attribute does not affect the existing staff flow
    - _Requirements: 5.5, 8.3_

  - [ ] 6.4 Write unit test for scan-session origin_channel recording
    - Assert the QR flow records `origin_channel = self_qr` and the SMS flow records `origin_channel = self_sms`, with `token_ref` and `decision_ref` populated
    - _Requirements: 5.5_

  - [ ] 6.5 Write property test for deny-on-unavailable
    - **Property: For any engine error or thrown exception, the check-in result is `denied` with the correct reason and a scan session plus audit entry are still recorded**
    - **Validates: Requirements 5.4, 5.5**

- [ ] 7. Backend server-side explainability scoping
  - [ ] 7.1 Implement the toWorkerView filter
    - Create `packages/backend/src/services/self-checkin/explainability-scope.ts`
    - Implement `toWorkerView(response)` returning only `decision`, `reasons`, and `required_actions` (derived from reasons, the way `access-service` extracts `missingCerts`)
    - Strip `rule_references`, `evidence_references`, `policy_version_used`/policy version fields, `decision_id`, `rules_applied`, and the explanation-level marker
    - Ensure the filter runs in the Lambda before serialization so the full payload is never transmitted to the public client
    - _Requirements: 6.1, 6.2, 6.6_

  - [ ] 7.2 Wire the worker-scoped result into the verify response
    - Return the `toWorkerView` payload from `POST /public/check-in/{token}/verify`
    - Ensure `conditional` includes specific required actions, `denied` includes worker-appropriate reasons, and `allowed` includes a clear confirmation
    - _Requirements: 6.3, 6.4, 6.5_

  - [ ] 7.3 Write unit test for required-action derivation
    - Assert `required_actions` is correctly derived from `conditional`/`denied` decision reasons (e.g., missing/expired certifications) and is empty for `allowed`
    - _Requirements: 6.1, 6.3_

  - [ ] 7.4 Write property test for explainability non-leakage
    - **Property: For any `DecisionResponse`, `toWorkerView` never emits a rule reference, evidence reference, policy version, or decision id**
    - **Validates: Requirements 6.2, 6.6**

- [ ] 8. Backend abuse protection wiring
  - [ ] 8.1 Wire the rate limiter into every public endpoint
    - Reuse `forms/rate-limiter.ts` `checkRateLimit` on token resolution, identity verification, decision retrieval, and SMS-link issuance
    - Key limits by IP and by token (`RATELIMIT#CHECKIN#{token}`) and by worker + IP for SMS issuance (`RATELIMIT#CHECKINSMS#{worker_id}`)
    - Return `429` with `retry_after_seconds` when a limit trips
    - _Requirements: 3.4, 4.7, 7.1, 7.2_

  - [ ] 8.2 Wire the sanitizer and bot detection into public endpoints
    - Reuse `forms/sanitizer.ts` `sanitizeInput` / `sanitizeFormAnswers` on all worker-supplied input before evaluation or storage
    - Reuse `detectBot` for header validation, honeypot field, and rapid-submission detection on the public endpoints
    - _Requirements: 7.3, 7.4_

  - [ ] 8.3 Ensure uniform, non-disclosive public error responses
    - Ensure invalid-token, failed-identity, and non-existent-site responses are uniform so response differences cannot be used to enumerate tokens, workers, or sites
    - Return the same uniform message for bot-detected requests as for rate-limit rejections
    - _Requirements: 7.5_

  - [ ] 8.4 Write property test for rate-limit enforcement
    - **Property: For any sequence of N public requests from one IP within the window, requests beyond the configured limit are rejected with `429`**
    - **Validates: Requirements 7.1, 7.2**

- [ ] 9. Backend SMS magic-link flow
  - [ ] 9.1 Implement the SMS-link dispatch module
    - Create `packages/backend/src/services/self-checkin/sms-link.ts`
    - Build the public URL `/check-in/{sms_magic_link_token}` and dispatch it via the existing notification-service SMS channel (`sendSms`, SNS)
    - Generate the single-use token via the checkin-token module (bound to worker + site + tenant, with expiry)
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 9.2 Implement the authenticated send-SMS-link endpoint
    - Implement `POST /checkin/sms-link`: validate the requester has `access:send_checkin_link`
    - On SNS acceptance return `{ sent: true, expires_at }`; on delivery failure return `sent: false` and do NOT report the link as sent
    - Apply the SMS-issuance rate limit per worker and per IP
    - _Requirements: 4.5, 4.6, 4.7_

  - [ ] 9.3 Write property test for SMS delivery-failure reporting
    - **Property: When the notification-service reports a delivery failure, the endpoint result is `sent: false` and never reports the link as sent**
    - **Validates: Requirements 4.5**

- [ ] 10. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Frontend admin — QR panel, send-link button, hooks
  - [ ] 11.1 Create the site-checkin feature directory and API hooks
    - Create `packages/admin-portal/src/features/site-checkin/`
    - Implement TanStack Query hooks `useSiteCheckinToken`, `useRegenerateCheckinToken`, and `useSendCheckinSmsLink`
    - Add API client functions for the three authenticated endpoints
    - _Requirements: 1.1, 4.1_

  - [ ] 11.2 Implement the SiteCheckinQrPanel component
    - Create `features/site-checkin/SiteCheckinQrPanel.tsx`, shown on the Site detail page
    - Call `POST /sites/{siteId}/checkin-token` and render the QR client-side with `qrcode.toDataURL(url, { width: 300 })`
    - Offer PNG download at ≥ 300×300 pixels
    - _Requirements: 1.6_

  - [ ] 11.3 Add the token-regeneration action to the QR panel
    - Provide a "Regenerate" action wired to `useRegenerateCheckinToken` that re-renders the QR from the new token and warns that previously printed codes stop working
    - _Requirements: 1.4_

  - [ ] 11.4 Implement the SendCheckinLinkButton component
    - Create `features/site-checkin/SendCheckinLinkButton.tsx` on the Worker detail page
    - Call `POST /checkin/sms-link` and surface a delivery-failure result when the notification-service reports the SMS was not sent
    - _Requirements: 4.1, 4.5_

- [ ] 12. Frontend public — Public_Checkin_Page, challenge, decision
  - [ ] 12.1 Create the public check-in route and page shell
    - Create `packages/admin-portal/src/features/public-checkin/PublicCheckinPage.tsx`
    - Add route `/check-in/:token` outside `AppLayout` (lazy-loaded), mirroring `/public/forms/:token`
    - Add the public API client functions and hook for `GET /public/check-in/{token}` and `POST /public/check-in/{token}/verify`
    - _Requirements: 2.4_

  - [ ] 12.2 Implement token resolution and flow orchestration on the page
    - Orchestrate the flow: resolve token → (challenge | skip) → decision, calling `GET /public/check-in/{token}`
    - Render the site name and the appropriate next step for valid tokens; show the generic "This check-in link is no longer valid" message for unknown/expired/invalidated tokens
    - _Requirements: 2.1, 2.3_

  - [ ] 12.3 Implement the IdentityChallengeForm component
    - Create `features/public-checkin/IdentityChallengeForm.tsx` with last-4-phone and date-of-birth inputs (QR flow only)
    - Include a hidden honeypot field and capture `page_load_ts` for the backend `detectBot` check
    - Submit to `POST /public/check-in/{token}/verify`; show a rate-limit wait-and-retry message including remaining wait time
    - _Requirements: 3.1, 3.5, 7.2, 7.4_

  - [ ] 12.4 Implement the DecisionResult component
    - Create `features/public-checkin/DecisionResult.tsx`
    - Render `allowed` (clear "you may enter" confirmation), `conditional` (specific required actions), and `denied` (worker-appropriate reasons) using only the role-scoped payload
    - _Requirements: 6.3, 6.4, 6.5_

  - [ ] 12.5 Implement mobile-first responsive layout and network handling
    - Ensure the page is responsive and operable without horizontal scroll from 320px, targeting iOS Safari and Android Chrome (latest 2 versions)
    - Apply a 10-second request timeout; on network error show a retryable message and preserve entered input
    - Author all copy in English
    - _Requirements: 2.2, 2.5, 8.4_

  - [ ] 12.6 Handle the SMS flow (challenge skipped)
    - When `GET /public/check-in/{token}` returns `requires_identity: false`, proceed directly to the decision step and submit `verify` without identity fields
    - _Requirements: 3.6, 4.3_

- [ ] 13. Testing — unit, integration, and frontend coverage
  - [ ] 13.1 Write unit tests for token resolution and reuse
    - Cover active/invalidated/expired/consumed resolve outcomes, site-token reuse (existing active token returned, not duplicated), and regeneration invalidating the previous token
    - _Requirements: 1.3, 1.4, 2.3_

  - [ ] 13.2 Write unit tests for reused-module wiring
    - Assert via spies that `checkRateLimit`, `sanitizeInput`, and `detectBot` are invoked on the public paths, confirming reuse rather than reimplementation
    - _Requirements: 7.1, 7.3, 7.4_

  - [ ] 13.3 Write integration test for the full QR flow
    - Generate site token → resolve → identity challenge → decision, asserting a `ScanSession` is recorded with `origin_channel = self_qr` and `decision_ref` set
    - _Requirements: 2.1, 3.1, 5.5_

  - [ ] 13.4 Write integration test for the full SMS flow
    - Send link → open (challenge skipped) → decision → token marked `consumed` → second open rejected
    - _Requirements: 3.6, 4.3, 4.4_

  - [ ] 13.5 Write integration test for coexistence with the staff terminal
    - Assert the staff `POST /site-access/check-in` flow is unchanged and still records its own scan sessions
    - _Requirements: 8.3_

  - [ ] 13.6 Write frontend test for the QR panel
    - Assert the client-side QR encodes the correct public URL and downloads a PNG ≥ 300×300, and that regeneration re-renders from the new token
    - _Requirements: 1.4, 1.6_

  - [ ] 13.7 Write frontend test for the public page responsiveness and copy
    - Assert the page is operable without horizontal scroll from 320px and that all copy is in English
    - _Requirements: 2.2, 8.4_

  - [ ] 13.8 Write frontend test for the network-error path
    - Assert a network error or 10-second timeout shows a retryable message and preserves the input the worker already entered
    - _Requirements: 2.5_

  - [ ] 13.9 Write frontend test for the SMS delivery-failure result
    - Assert the SendCheckinLinkButton surfaces a delivery-failure result and does not report the link as sent when the endpoint returns `sent: false`
    - _Requirements: 4.5_

- [ ] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each leaf task references specific requirements for traceability.
- Checkpoints ensure incremental validation.
- Property-based tests use `fast-check` (the framework already used by `contractor-forms-qr`), minimum 100 iterations each, and validate the universal correctness properties from the design's Testing Strategy: identity non-disclosure, explainability non-leakage, uniform invalid-token response, and rate-limit enforcement.
- Unit tests validate specific examples and edge cases.
- The design specifies TypeScript throughout — backend Lambda, CDK infrastructure, and React frontend.
- QR generation is client-side only (no backend QR service needed).
- The feature reuses `evaluateDecision`, `recordScanSession`, `rate-limiter.ts`, `sanitizer.ts`, and the notification-service `sendSms` rather than duplicating them.
- Offline submission queuing is explicitly out of scope; the public page requires connectivity and shows a retryable error on network failure.
- The existing staff-operated `/site-access` terminal is untouched; both flows coexist.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 3, "tasks": ["2.7", "3.1", "3.3"] },
    { "id": 4, "tasks": ["3.2", "3.4", "4.1", "4.3", "4.4"] },
    { "id": 5, "tasks": ["3.5", "4.2", "4.5", "4.6"] },
    { "id": 6, "tasks": ["6.1", "6.2", "6.3", "7.1"] },
    { "id": 7, "tasks": ["6.4", "6.5", "7.2", "7.3", "7.4", "8.1", "8.2", "8.3"] },
    { "id": 8, "tasks": ["8.4", "9.1", "9.2"] },
    { "id": 9, "tasks": ["9.3", "11.1", "12.1", "12.2"] },
    { "id": 10, "tasks": ["11.2", "11.3", "11.4", "12.3", "12.4", "12.5", "12.6"] },
    { "id": 11, "tasks": ["13.1", "13.2", "13.3", "13.4", "13.5", "13.6", "13.7", "13.8", "13.9"] }
  ]
}
```
