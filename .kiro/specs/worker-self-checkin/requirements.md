# Requirements Document

## Introduction

This feature delivers the product's documented "killer workflow" (`ideas.txt`, §3): a construction worker arriving at a jobsite scans a persistent QR code posted at the gate, or opens a one-time SMS magic link, and — with no staff member involved and no Cognito session — is told within a few seconds whether they may enter the site today. The system verifies the worker's identity, evaluates their certifications and the site's access policy through the existing Compliance Decision Engine, and returns an explainable allow / conditional / deny outcome scoped to what a worker is permitted to see per `docs/ROLES.md`.

Today the platform only exposes a staff-operated check-in terminal (`/site-access`, `CheckIn.tsx`), where a gate operator enters or scans a worker ID on the worker's behalf. Every `/access/*` route requires Cognito authentication (`docs/API-ROUTES.md`), so a worker's own phone has no way to self-check-in. The only unauthenticated public routes in the entire API are `POST /leads` (marketing) and the contractor-forms `GET|POST /public/forms/{token}` family — the latter being a proven, audited public-token pattern this feature deliberately reuses rather than inventing new public-endpoint infrastructure.

This spec is a follow-up breakout from the `production-readiness-audit` spec (Requirement 7). It reuses three concrete building blocks that already exist in the codebase:

- The **public UUID token** pattern from `contractor-forms-qr` (`token_publico` resolved via a `TOKEN#{token}` GSI, client-side QR generation with `qrcode`, mobile-first public view, `rate-limiter.ts` + `sanitizer.ts` abuse protection).
- The **Compliance Decision Engine** (`packages/backend/src/services/decision-engine/`), which already produces an `allow` / `conditional` / `deny` result plus an audit-grade `ExplainabilityPayload`, and is already invoked with `DecisionType.SITE_ACCESS` by the authenticated `access-service`.
- The **notification-service** (`packages/backend/src/services/notification/handler.ts`, SES + SNS) for delivering SMS magic links.

The scope of this spec is a public, worker-facing self-service check-in surface. It does not replace the existing staff-operated gate terminal; both coexist.

## Glossary

- **Self_Checkin_Service**: The backend module (Lambda + DynamoDB) responsible for resolving public check-in tokens, verifying worker identity without a staff session, invoking the Decision Engine, applying role-scoped explainability, and recording the check-in event.
- **Public_Checkin_Page**: The public, mobile-first, unauthenticated web page rendered when a worker scans a QR code or opens an SMS link, where the worker identifies themselves and receives their access decision.
- **Site_Checkin_Token**: A non-guessable persistent UUID v4 token bound to a single site, encoded into a QR code posted physically at that site's gate. Resolves to the Public_Checkin_Page without identifying any particular worker.
- **SMS_Magic_Link_Token**: A non-guessable single-use, short-lived UUID v4 token bound to a specific worker and site, delivered by SMS, that both identifies the worker and grants a one-time check-in attempt.
- **Worker_Identity_Verification**: The step where a worker arriving via a Site_Checkin_Token proves who they are without a Cognito session, using a knowledge-based challenge (last 4 digits of registered phone number plus date of birth) or by having arrived through an already-identifying SMS_Magic_Link_Token.
- **Decision_Engine**: The existing Compliance Decision Engine (`packages/backend/src/services/decision-engine/`), invoked with `DecisionType.SITE_ACCESS`, which returns a `DecisionResponse` containing `decision` (`allowed` / `conditional` / `denied`), `reasons`, `rules_applied`, `policy_version_used`, and an `ExplainabilityPayload`.
- **Worker_Explainability_View**: The subset of a decision's explanation that a worker is permitted to see per `docs/ROLES.md`: reasons and required actions only, excluding rule references, evidence references, and policy version detail.
- **Access_Decision**: The `allowed` / `conditional` / `denied` outcome returned by the Decision_Engine for a check-in attempt, recorded as an immutable `DecisionRecord` and a `ScanSession`.
- **Checkin_Event**: The persisted record of a self-service check-in attempt (scan session), including worker, site, timestamp, origin channel (QR or SMS), device metadata, and the resulting Access_Decision reference.
- **Worker**: A construction worker performing a self-service check-in. Has no Cognito account and is never authenticated as a platform user during this flow.
- **Site_Admin**: A user with role `site_admin` (or `tenant_admin` / `platform_admin`) who generates a site's check-in QR token and may trigger SMS magic links, per `docs/ROLES.md`.
- **Rate_Limiter**: The per-IP abuse-protection module reused from `contractor-forms-qr` (`rate-limiter.ts`), applied to every public self-check-in endpoint.
- **Sanitizer**: The input-sanitization module reused from `contractor-forms-qr` (`sanitizer.ts`), applied to all worker-supplied input before evaluation or storage.

## Requirements

### Requirement 1: Generate a persistent per-site check-in QR token

**User Story:** As a Site_Admin, I want to generate a persistent QR code for a site, so that I can post it physically at the gate and let arriving workers check themselves in without staff involvement.

#### Acceptance Criteria

1. WHEN a Site_Admin requests a check-in QR token for a site they are authorized to manage, THE Self_Checkin_Service SHALL generate a Site_Checkin_Token as a UUID v4 bound to that site and tenant, and return the absolute public check-in URL in the form `/check-in/{site_checkin_token}`.
2. THE Self_Checkin_Service SHALL make the Site_Checkin_Token resolvable to exactly one site within one tenant, using the same `TOKEN#{token}` GSI lookup pattern already established by `contractor-forms-qr`, so no tenant or site is inferable from the token value itself.
3. WHERE a site already has an active Site_Checkin_Token, THE Self_Checkin_Service SHALL return the existing token rather than silently creating a duplicate, unless the Site_Admin explicitly requests regeneration.
4. WHEN a Site_Admin requests regeneration of a site's token, THE Self_Checkin_Service SHALL issue a new Site_Checkin_Token and invalidate the previous one, so that previously printed QR codes stop resolving.
5. IF the requester does not have role `platform_admin`, `tenant_admin`, or `site_admin` per `docs/ROLES.md`, THEN THE Self_Checkin_Service SHALL reject the request with an authorization error.
6. THE Public_Checkin_Page frontend SHALL generate the QR image client-side from the public URL using the existing `qrcode` library (matching the `contractor-forms-qr` pattern) and offer it for download as a PNG of at least 300x300 pixels.
7. IF a Site_Admin requests a token for a site that does not exist or does not belong to their tenant, THEN THE Self_Checkin_Service SHALL reject the request with a not-found error and SHALL NOT reveal whether the site exists in another tenant.

### Requirement 2: Public QR-based check-in without a staff session

**User Story:** As a Worker arriving at a site, I want to scan the gate QR code and open a check-in page on my own phone, so that I can start the check-in process without a staff member operating a terminal for me.

#### Acceptance Criteria

1. WHEN a Worker opens `/check-in/{site_checkin_token}` for a valid, active Site_Checkin_Token, THE Public_Checkin_Page SHALL render the site name and an identity-verification prompt without requiring any authentication or account registration.
2. THE Public_Checkin_Page SHALL render with a mobile-first responsive design operable without horizontal scrolling on viewports from 320px wide, targeting iOS Safari and Android Chrome (latest 2 versions each).
3. WHEN a Worker opens the page with a Site_Checkin_Token that is unknown, expired, or invalidated, THE Public_Checkin_Page SHALL show a generic "This check-in link is no longer valid" message and SHALL NOT reveal whether the token ever existed.
4. THE public check-in endpoints (token resolution, identity verification, decision retrieval) SHALL be processed without requiring an `Authorization` header, consistent with the `contractor-forms-qr` public-endpoint pattern.
5. IF the Public_Checkin_Page cannot reach the Self_Checkin_Service within 10 seconds or receives a network error, THEN THE Public_Checkin_Page SHALL show a retryable error message and preserve any input the Worker already entered.
6. THE Self_Checkin_Service SHALL scope every token resolution and check-in evaluation to the tenant and site the token is bound to, so a token for one site can never produce a decision against another site.

### Requirement 3: Worker identity verification without a Cognito session

**User Story:** As a Worker checking in via a gate QR code, I want to prove who I am using information only I would know, so that the system can evaluate my personal eligibility without me having a platform login.

#### Acceptance Criteria

1. WHEN a Worker submits an identity challenge on the Public_Checkin_Page consisting of the last 4 digits of their registered phone number and their date of birth, THE Self_Checkin_Service SHALL attempt to match exactly one Worker record within the token's tenant.
2. THE Self_Checkin_Service SHALL apply the Sanitizer to all Worker-supplied identity input before matching or storage.
3. IF the identity challenge matches no Worker, or matches more than one Worker, THEN THE Self_Checkin_Service SHALL return a single generic "We could not verify your identity" result that does not disclose whether the phone digits, the date of birth, or neither matched, to avoid confirming the existence of any worker record.
4. THE Self_Checkin_Service SHALL apply the Rate_Limiter to identity-verification attempts per IP and per Site_Checkin_Token, so repeated failed challenges cannot be used to enumerate worker records.
5. IF a Worker exceeds the identity-verification attempt limit, THEN THE Public_Checkin_Page SHALL show a message indicating they must wait before trying again, including the remaining wait time.
6. WHEN a Worker arrives through a valid SMS_Magic_Link_Token, THE Self_Checkin_Service SHALL treat the worker as already identified by that token and SHALL NOT require the phone-plus-date-of-birth challenge again.
7. THE Self_Checkin_Service SHALL NOT create, issue, or require any Cognito session, token, or user account for the Worker at any point in the check-in flow.

### Requirement 4: SMS magic-link check-in

**User Story:** As a Worker, I want to receive an SMS with a link that opens my check-in page already knowing who I am, so that I can check in with a single tap without entering identifying details.

#### Acceptance Criteria

1. WHEN a Site_Admin (or an authorized scheduled process) requests an SMS check-in link for a specific Worker at a specific site, THE Self_Checkin_Service SHALL generate an SMS_Magic_Link_Token as a single-use UUID v4 bound to that worker, site, and tenant, and send it to the Worker's registered phone number via the existing notification-service (SNS).
2. THE Self_Checkin_Service SHALL set an expiration on each SMS_Magic_Link_Token, after which opening the link SHALL show the same generic "no longer valid" message defined in Requirement 2.3.
3. WHEN a Worker opens a valid SMS_Magic_Link_Token, THE Public_Checkin_Page SHALL proceed directly to the Access_Decision step for that worker and site without an identity challenge, per Requirement 3.6.
4. WHEN an SMS_Magic_Link_Token is used to complete a check-in attempt, THE Self_Checkin_Service SHALL mark the token consumed so it cannot be reused, matching the single-use token-consumption behavior already used by the access-service for magic-link token types.
5. IF the notification-service fails to deliver the SMS, THEN THE Self_Checkin_Service SHALL surface a delivery-failure result to the requesting Site_Admin and SHALL NOT report the link as sent.
6. IF the requester of an SMS link does not have role `platform_admin`, `tenant_admin`, or `site_admin`, THEN THE Self_Checkin_Service SHALL reject the request with an authorization error.
7. THE Self_Checkin_Service SHALL apply the Rate_Limiter to SMS-link issuance per worker and per IP to prevent SMS-flooding abuse.

### Requirement 5: Decision-engine integration producing an explainable decision

**User Story:** As a Worker who has been identified, I want the system to evaluate my certifications against the site's policy and tell me whether I can enter, so that I know my status immediately and without staff intervention.

#### Acceptance Criteria

1. WHEN a Worker has been identified (via identity challenge or SMS_Magic_Link_Token) for a given site, THE Self_Checkin_Service SHALL invoke the Decision_Engine with `decision_type = SITE_ACCESS`, `subject_type = worker`, the resolved `subject_id` (worker), the token's `site_id`, and the tenant, reusing the existing `evaluateDecision` integration the access-service already uses.
2. THE Self_Checkin_Service SHALL return the Decision_Engine's `allowed`, `conditional`, or `denied` result to the Public_Checkin_Page within a few seconds of a successful identity step.
3. WHEN the Decision_Engine returns an error result, THE Self_Checkin_Service SHALL treat the check-in as `denied` and surface the engine's returned reason, matching the access-service's existing error handling.
4. IF the Decision_Engine is unavailable or the evaluation throws, THEN THE Self_Checkin_Service SHALL return a `denied` decision with the reason "system temporarily unable to evaluate", matching the access-service's existing fallback behavior, rather than allowing entry by default.
5. WHEN a check-in attempt is evaluated, THE Self_Checkin_Service SHALL record an immutable DecisionRecord and a Checkin_Event (scan session) capturing worker, site, timestamp, origin channel (QR or SMS), and the Access_Decision reference, consistent with how the access-service records scan sessions today.
6. THE Self_Checkin_Service SHALL preserve the existing Decision_Engine contract unchanged (`DecisionResponse` shape, reasons, policy version, audit-grade explainability payload) and SHALL NOT require modifications to the Decision_Engine to serve worker self-check-in.

### Requirement 6: Role-scoped explainability for the worker

**User Story:** As a Worker, I want to see the reasons for my decision and what I need to do about it, without being shown internal rule references or policy internals, so that the explanation is useful to me and consistent with what my role is allowed to see.

#### Acceptance Criteria

1. WHEN the Public_Checkin_Page displays an Access_Decision, THE Self_Checkin_Service SHALL return only the Worker_Explainability_View — reasons and required actions — per the `docs/ROLES.md` rule that a `worker` / `gate_operator` sees "only reasons and required actions".
2. THE Self_Checkin_Service SHALL exclude rule references (`rule_references`), evidence references (`evidence_references`), and policy version references from the payload returned to the Public_Checkin_Page, even though the underlying stored DecisionRecord retains the full audit-grade ExplainabilityPayload.
3. WHEN a decision is `conditional`, THE Public_Checkin_Page SHALL display the specific required actions the Worker must take (for example, missing or expired certifications) drawn from the decision reasons, so the Worker knows how to become compliant.
4. WHEN a decision is `denied`, THE Public_Checkin_Page SHALL display the reasons for denial in worker-appropriate language without exposing admin-grade detail.
5. WHEN a decision is `allowed`, THE Public_Checkin_Page SHALL display a clear confirmation that the Worker may enter the site.
6. THE role-scoping of the returned explainability SHALL be enforced server-side by the Self_Checkin_Service, so the full payload is never transmitted to the public client and cannot be recovered by inspecting the network response.

### Requirement 7: Abuse protection for public endpoints

**User Story:** As a Site_Admin, I want the public check-in endpoints protected against automated abuse and enumeration, so that the self-service surface cannot be used to harvest worker data or flood the system.

#### Acceptance Criteria

1. THE Self_Checkin_Service SHALL apply the Rate_Limiter (reused from `contractor-forms-qr`, `rate-limiter.ts`) to every public endpoint (token resolution, identity verification, decision retrieval, SMS-link issuance), keyed by originating IP and by token.
2. IF a client exceeds a public endpoint's rate limit, THEN THE Public_Checkin_Page SHALL show a wait-and-retry message including the remaining wait time in minutes, and THE Self_Checkin_Service SHALL reject the request until the window resets.
3. THE Self_Checkin_Service SHALL apply the Sanitizer (reused from `contractor-forms-qr`, `sanitizer.ts`) to all Worker-supplied input to prevent XSS, script injection, and SQL injection before any evaluation or storage.
4. THE Self_Checkin_Service SHALL implement bot protection consistent with `contractor-forms-qr` (header validation and automated-submission-pattern detection) on the public check-in endpoints.
5. THE public error responses for invalid tokens, failed identity verification, and non-existent sites SHALL be uniform and non-disclosive, so that response differences cannot be used to enumerate valid tokens, workers, or sites.
6. THE Self_Checkin_Service SHALL record an audit entry for each check-in attempt (successful or rejected) including origin IP, origin channel, token reference, and outcome, following the immutable audit-logging pattern already used elsewhere in the platform.

### Requirement 8: Scope boundary and reuse discipline

**User Story:** As the Product Owner, I want this feature to reuse the platform's proven patterns rather than reinvent public-endpoint infrastructure, so that it inherits the security and reliability already audited in existing modules.

#### Acceptance Criteria

1. THE design and implementation of this feature SHALL reuse the `contractor-forms-qr` public-token, rate-limiter, and sanitizer patterns rather than introducing a new public-authentication mechanism.
2. THE feature SHALL reuse the existing Decision_Engine (`evaluateDecision`) and notification-service (SES/SNS) rather than duplicating decision logic or message delivery.
3. THE feature SHALL NOT alter or degrade the existing staff-operated `/site-access` check-in terminal; the public self-service flow and the staff terminal SHALL coexist.
4. THE Public_Checkin_Page SHALL be authored in English, consistent with the platform's target language (per `production-readiness-audit` Requirement 8), even though the reused `contractor-forms-qr` module is authored in Spanish.
5. WHERE this spec depends on the `production-readiness-audit` competitive-parity findings (for example, whether the public check-in submission should be offline-tolerant, per that spec's Requirement 9.6), THE design phase of this spec SHALL resolve that decision explicitly rather than deferring it silently.
