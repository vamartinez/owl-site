# Requirements Document

## Introduction

This document specifies the requirements for implementing 16 missing API endpoints that the admin portal frontend already consumes but that have no backend handler implementation. The endpoints span four functional sections — Certifications, Site Access, Dashboard, and Reports — and are distributed across three existing Lambda service handlers (identity, access, reporting). Each endpoint requires Cognito authentication, RBAC permission enforcement, real DynamoDB queries, and CDK route definitions following the established patterns in the codebase.

## Glossary

- **Identity_Service**: The Lambda handler at `src/services/identity/handler.ts` responsible for worker profiles, certifications, and contractor management.
- **Access_Service**: The Lambda handler at `src/services/access/handler.ts` responsible for site access orchestration, token management, and scan sessions.
- **Reporting_Service**: The Lambda handler at `src/services/reporting/handler.ts` responsible for reports, daily summaries, and compliance analytics.
- **RBAC_Module**: The role-based access control module at `src/shared/rbac.ts` that enforces permission checks via `enforcePermission`.
- **Auth_Middleware**: The authentication module at `src/shared/auth-middleware.ts` that validates Cognito JWT tokens via `authenticateRequest`.
- **CDK_API_Stack**: The infrastructure-as-code file at `infra/lib/api-stack.ts` that defines API Gateway routes and Lambda integrations.
- **Tenant**: An organization using the platform, identified by `tenant_id` in the authenticated user context.
- **Certification**: A compliance document (e.g., safety training, trade license) associated with a worker that has a type, status, and expiry date.
- **Access_Decision**: A recorded outcome (allowed, conditional, denied) from the compliance decision engine when a worker attempts site entry.

## Requirements

### Requirement 1: Certification Statistics Endpoint

**User Story:** As a site_admin, I want to view aggregate certification statistics, so that I can monitor the overall certification health of my workforce.

#### Acceptance Criteria

1. WHEN a GET request is received at `/certifications/stats`, THE Identity_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/certifications/stats`, THE Identity_Service SHALL enforce the `certifications:read` permission using RBAC_Module.
3. WHEN the request is authorized, THE Identity_Service SHALL query DynamoDB to compute counts of active, pending-validation, expiring-within-30-days, and expired certifications scoped to the authenticated user's Tenant.
4. WHEN the request is authorized, THE Identity_Service SHALL return a JSON response containing `totalActive`, `pendingValidation`, `expiringSoon`, `expired`, and `byType` (array of type/count pairs) with HTTP status 200.
5. IF the authenticated user lacks the `certifications:read` permission, THEN THE Identity_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
6. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/certifications/stats` resource routed to the identity service Lambda integration with Cognito authorization.

### Requirement 2: Certification Catalog Endpoint

**User Story:** As a site_admin, I want to browse the catalog of certification types configured for my organization, so that I can understand what certifications are tracked.

#### Acceptance Criteria

1. WHEN a GET request is received at `/certifications/catalog`, THE Identity_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/certifications/catalog`, THE Identity_Service SHALL enforce the `certifications:read` permission using RBAC_Module.
3. WHEN the request includes optional `search` and `category` query parameters, THE Identity_Service SHALL filter certification types by name match and category.
4. WHEN the request is authorized, THE Identity_Service SHALL query DynamoDB for certification type definitions scoped to the authenticated user's Tenant and return a JSON response containing `certTypes` (array of certification type objects) and `total` count with HTTP status 200.
5. THE Identity_Service SHALL include `id`, `name`, `category`, `issuingAuthority`, `validityMonths`, `isRequired`, and `activeCount` fields for each certification type in the response.
6. IF the authenticated user lacks the `certifications:read` permission, THEN THE Identity_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
7. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/certifications/catalog` resource routed to the identity service Lambda integration with Cognito authorization.

### Requirement 3: Expiring Certifications Endpoint

**User Story:** As a site_admin, I want to list certifications that are expiring soon, so that I can proactively notify workers to renew them.

#### Acceptance Criteria

1. WHEN a GET request is received at `/certifications/expiring`, THE Identity_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/certifications/expiring`, THE Identity_Service SHALL enforce the `certifications:read` permission using RBAC_Module.
3. WHEN the request includes an optional `urgency` query parameter (number of days), THE Identity_Service SHALL filter certifications expiring within that number of days; WHILE no `urgency` parameter is provided, THE Identity_Service SHALL default to 30 days.
4. WHEN the request is authorized, THE Identity_Service SHALL query DynamoDB for certifications with expiry dates within the specified window, scoped to the authenticated user's Tenant, and return a JSON response containing `certifications` (array with `id`, `workerName`, `workerId`, `certType`, `expiryDate`, `daysRemaining`, `site`) and `total` count with HTTP status 200.
5. IF the authenticated user lacks the `certifications:read` permission, THEN THE Identity_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
6. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/certifications/expiring` resource routed to the identity service Lambda integration with Cognito authorization.

### Requirement 4: Pending Certification Validations Endpoint

**User Story:** As a site_admin, I want to list certifications awaiting validation, so that I can review and approve or reject uploaded documents.

#### Acceptance Criteria

1. WHEN a GET request is received at `/certifications/pending`, THE Identity_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/certifications/pending`, THE Identity_Service SHALL enforce the `certifications:validate` permission using RBAC_Module.
3. WHEN the request is authorized, THE Identity_Service SHALL query DynamoDB for certifications with status `pending_validation` scoped to the authenticated user's Tenant and return a JSON response containing `certifications` (array with `id`, `workerName`, `certType`, `uploadedAt`, `documentUrl`, `expiryDate`) and `total` count with HTTP status 200.
4. IF the authenticated user lacks the `certifications:validate` permission, THEN THE Identity_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
5. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/certifications/pending` resource routed to the identity service Lambda integration with Cognito authorization.

### Requirement 5: Live Site Access Endpoint

**User Story:** As a gate_operator, I want to see a real-time list of workers currently on site, so that I can monitor occupancy and compliance status.

#### Acceptance Criteria

1. WHEN a GET request is received at `/site-access/live`, THE Access_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/site-access/live`, THE Access_Service SHALL enforce the `access:read_decisions` permission using RBAC_Module.
3. WHEN the request is authorized, THE Access_Service SHALL query DynamoDB for scan sessions with check-in but no check-out, scoped to the authenticated user's Tenant, and return a JSON response containing `workers` (array with `id`, `workerName`, `site`, `checkInTime`, `contractor`, `complianceStatus`) and `totalOnSite` count with HTTP status 200.
4. IF the authenticated user lacks the `access:read_decisions` permission, THEN THE Access_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
5. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/site-access/live` resource routed to the access service Lambda integration with Cognito authorization.

### Requirement 6: Site Check-In Endpoint

**User Story:** As a gate_operator, I want to check in a worker by ID, so that the system evaluates compliance and records the access decision.

#### Acceptance Criteria

1. WHEN a POST request is received at `/site-access/check-in`, THE Access_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a POST request is received at `/site-access/check-in`, THE Access_Service SHALL enforce the `access:scan` permission using RBAC_Module.
3. WHEN the request body contains a valid `workerId` field, THE Access_Service SHALL look up the worker, evaluate compliance against site policies, and return a JSON response containing `decision` (allowed, conditional, or denied), `workerName`, `reasons` (array of strings), and `missingCerts` (array of certification type names) with HTTP status 200.
4. IF the request body is missing or the `workerId` field is empty, THEN THE Access_Service SHALL return HTTP 400 with error code `BAD_REQUEST`.
5. IF the authenticated user lacks the `access:scan` permission, THEN THE Access_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
6. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a POST method on the `/site-access/check-in` resource routed to the access service Lambda integration with Cognito authorization.

### Requirement 7: Recent Check-Ins Endpoint

**User Story:** As a gate_operator, I want to see the most recent check-in events, so that I can verify recent access activity at the gate.

#### Acceptance Criteria

1. WHEN a GET request is received at `/site-access/recent-checkins`, THE Access_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/site-access/recent-checkins`, THE Access_Service SHALL enforce the `access:read_decisions` permission using RBAC_Module.
3. WHEN the request is authorized, THE Access_Service SHALL query DynamoDB for the most recent scan sessions (limited to 10 entries) scoped to the authenticated user's Tenant and return a JSON response containing `checkIns` (array with `id`, `workerName`, `decision`, `timestamp`, `site`) with HTTP status 200.
4. IF the authenticated user lacks the `access:read_decisions` permission, THEN THE Access_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
5. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/site-access/recent-checkins` resource routed to the access service Lambda integration with Cognito authorization.

### Requirement 8: Access Rules Endpoint

**User Story:** As a site_admin, I want to view the configured access rules for my sites, so that I can understand what certifications are required for site entry.

#### Acceptance Criteria

1. WHEN a GET request is received at `/site-access/rules`, THE Access_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/site-access/rules`, THE Access_Service SHALL enforce the `access:read_decisions` permission using RBAC_Module.
3. WHEN the request is authorized, THE Access_Service SHALL query DynamoDB for access rule definitions scoped to the authenticated user's Tenant and return a JSON response containing `rules` (array with `id`, `name`, `site`, `requiredCerts`, `enforcementLevel`, `isActive`, `createdAt`) and `total` count with HTTP status 200.
4. IF the authenticated user lacks the `access:read_decisions` permission, THEN THE Access_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
5. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/site-access/rules` resource routed to the access service Lambda integration with Cognito authorization.

### Requirement 9: Access Rejections Endpoint

**User Story:** As a site_admin, I want to view access rejection events with filtering, so that I can identify patterns and resolve compliance gaps.

#### Acceptance Criteria

1. WHEN a GET request is received at `/site-access/rejections`, THE Access_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/site-access/rejections`, THE Access_Service SHALL enforce the `access:read_decisions` permission using RBAC_Module.
3. WHEN the request includes optional `search`, `reason`, and `period` query parameters, THE Access_Service SHALL filter rejection records accordingly.
4. WHEN the request is authorized, THE Access_Service SHALL query DynamoDB for scan sessions with result `denied`, scoped to the authenticated user's Tenant, and return a JSON response containing `rejections` (array with `id`, `workerName`, `site`, `reason`, `timestamp`, `missingRequirements`) and `total` count with HTTP status 200.
5. IF the authenticated user lacks the `access:read_decisions` permission, THEN THE Access_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
6. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/site-access/rejections` resource routed to the access service Lambda integration with Cognito authorization.

### Requirement 10: Visit Log Endpoint

**User Story:** As a site_admin, I want to view a historical log of all site visits with filtering, so that I can audit access patterns over time.

#### Acceptance Criteria

1. WHEN a GET request is received at `/site-access/visits`, THE Access_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/site-access/visits`, THE Access_Service SHALL enforce the `access:read_decisions` permission using RBAC_Module.
3. WHEN the request includes optional `search`, `decision`, and `period` query parameters, THE Access_Service SHALL filter visit records accordingly.
4. WHEN the request is authorized, THE Access_Service SHALL query DynamoDB for scan session records scoped to the authenticated user's Tenant and return a JSON response containing `visits` (array with `id`, `workerName`, `site`, `checkInTime`, `checkOutTime`, `duration`, `decision`) and `total` count with HTTP status 200.
5. IF the authenticated user lacks the `access:read_decisions` permission, THEN THE Access_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
6. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/site-access/visits` resource routed to the access service Lambda integration with Cognito authorization.

### Requirement 11: Dashboard KPIs Endpoint

**User Story:** As a tenant_admin, I want to view key performance indicators on the executive dashboard, so that I can monitor overall platform health at a glance.

#### Acceptance Criteria

1. WHEN a GET request is received at `/dashboard/kpis`, THE Reporting_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/dashboard/kpis`, THE Reporting_Service SHALL enforce the `reports:read` permission using RBAC_Module.
3. WHEN the request is authorized, THE Reporting_Service SHALL query DynamoDB to compute `totalActiveWorkers`, `siteCompliancePercent`, `pendingFindings`, `unresolvedEnforcements`, `certsExpiringIn30Days`, and `complianceTrend` (array of date/value pairs for the last 7 days) scoped to the authenticated user's Tenant, and return the result as JSON with HTTP status 200.
4. IF the authenticated user lacks the `reports:read` permission, THEN THE Reporting_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
5. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/dashboard/kpis` resource routed to the reporting service Lambda integration with Cognito authorization.

### Requirement 12: Dashboard Risks Endpoint

**User Story:** As a tenant_admin, I want to view open safety risks on the dashboard, so that I can prioritize remediation efforts.

#### Acceptance Criteria

1. WHEN a GET request is received at `/dashboard/risks`, THE Reporting_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/dashboard/risks`, THE Reporting_Service SHALL enforce the `reports:read` permission using RBAC_Module.
3. WHEN the request is authorized, THE Reporting_Service SHALL query DynamoDB for unresolved findings with severity classification, scoped to the authenticated user's Tenant, and return a JSON response containing `risks` (array with `id`, `title`, `severity`, `site`, `createdAt`) and `total` count with HTTP status 200.
4. IF the authenticated user lacks the `reports:read` permission, THEN THE Reporting_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
5. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/dashboard/risks` resource routed to the reporting service Lambda integration with Cognito authorization.

### Requirement 13: Dashboard Blocked Access Endpoint

**User Story:** As a tenant_admin, I want to view today's blocked access events on the dashboard, so that I can identify workers being denied entry.

#### Acceptance Criteria

1. WHEN a GET request is received at `/dashboard/blocked-access`, THE Reporting_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/dashboard/blocked-access`, THE Reporting_Service SHALL enforce the `reports:read` permission using RBAC_Module.
3. WHEN the request is authorized, THE Reporting_Service SHALL query DynamoDB for scan sessions with result `denied` from the current day, scoped to the authenticated user's Tenant, and return a JSON response containing `events` (array with `id`, `workerName`, `site`, `reason`, `timestamp`) and `total` count with HTTP status 200.
4. IF the authenticated user lacks the `reports:read` permission, THEN THE Reporting_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
5. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/dashboard/blocked-access` resource routed to the reporting service Lambda integration with Cognito authorization.

### Requirement 14: Dashboard Expiring Certifications Endpoint

**User Story:** As a tenant_admin, I want to view certifications expiring within 30 days on the dashboard, so that I can ensure workforce compliance continuity.

#### Acceptance Criteria

1. WHEN a GET request is received at `/dashboard/expiring-certs`, THE Reporting_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/dashboard/expiring-certs`, THE Reporting_Service SHALL enforce the `reports:read` permission using RBAC_Module.
3. WHEN the request is authorized, THE Reporting_Service SHALL query DynamoDB for certifications expiring within 30 days, scoped to the authenticated user's Tenant, and return a JSON response containing `certifications` (array with `id`, `workerName`, `certType`, `expiryDate`, `daysRemaining`) and `total` count with HTTP status 200.
4. IF the authenticated user lacks the `reports:read` permission, THEN THE Reporting_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
5. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/dashboard/expiring-certs` resource routed to the reporting service Lambda integration with Cognito authorization.

### Requirement 15: Compliance Summary Report Endpoint

**User Story:** As a tenant_admin, I want to view a platform-wide compliance summary report, so that I can assess overall organizational compliance posture.

#### Acceptance Criteria

1. WHEN a GET request is received at `/reports/compliance-summary`, THE Reporting_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/reports/compliance-summary`, THE Reporting_Service SHALL enforce the `reports:read` permission using RBAC_Module.
3. WHEN the request is authorized, THE Reporting_Service SHALL query DynamoDB to compute `overallPercent`, `totalSites`, `compliantSites`, `nonCompliantWorkers`, `trend` (array of date/value pairs for the last 30 days), and `bySite` (array of site/percent pairs) scoped to the authenticated user's Tenant, and return the result as JSON with HTTP status 200.
4. IF the authenticated user lacks the `reports:read` permission, THEN THE Reporting_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
5. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/reports/compliance-summary` resource routed to the reporting service Lambda integration with Cognito authorization.

### Requirement 16: Site Access Logs Report Endpoint

**User Story:** As a tenant_admin, I want to view a filterable report of all site access log entries, so that I can audit access decisions across all sites.

#### Acceptance Criteria

1. WHEN a GET request is received at `/reports/site-access-logs`, THE Reporting_Service SHALL authenticate the request using Auth_Middleware.
2. WHEN a GET request is received at `/reports/site-access-logs`, THE Reporting_Service SHALL enforce the `reports:read` permission using RBAC_Module.
3. WHEN the request includes optional `search`, `decision`, and `period` query parameters, THE Reporting_Service SHALL filter access log entries accordingly.
4. WHEN the request is authorized, THE Reporting_Service SHALL query DynamoDB for scan session records scoped to the authenticated user's Tenant and return a JSON response containing `logs` (array with `id`, `workerName`, `site`, `decision`, `timestamp`, `method`, `operator`) and `total` count with HTTP status 200.
5. IF the authenticated user lacks the `reports:read` permission, THEN THE Reporting_Service SHALL return HTTP 403 with error code `FORBIDDEN`.
6. WHEN the CDK_API_Stack is deployed, THE CDK_API_Stack SHALL define a GET method on the `/reports/site-access-logs` resource routed to the reporting service Lambda integration with Cognito authorization.
