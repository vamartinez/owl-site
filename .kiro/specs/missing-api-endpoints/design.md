# Technical Design: Missing API Endpoints

## Overview

This design covers 16 missing API endpoints distributed across three existing Lambda handlers (Identity, Access, Reporting). Each endpoint follows the established patterns: Cognito authentication via `authenticateRequest`, RBAC enforcement via `enforcePermission`, DynamoDB queries scoped by tenant, and structured JSON responses via `createSuccessResponse`/error helpers.

## Architecture

### Service Distribution

| Service | New Endpoints | Route Prefix |
|---------|--------------|--------------|
| Identity (`src/services/identity/handler.ts`) | 4 | `/certifications/*` |
| Access (`src/services/access/handler.ts`) | 6 | `/site-access/*` |
| Reporting (`src/services/reporting/handler.ts`) | 6 | `/dashboard/*`, `/reports/*` |

### Request Flow

```
Client → API Gateway (Cognito Authorizer) → Lambda Handler
  → authenticateRequest(event)
  → enforcePermission(user, permission)
  → DynamoDB Query (tenant-scoped)
  → createSuccessResponse(200, data)
```

All endpoints follow this identical pipeline. Failures at any stage short-circuit with the appropriate error response (401, 403, 400, 500).

## Components and Interfaces

### 1. Identity Service — Certification Endpoints

Four new route branches added to the existing `handleApiEvent` function in `identity/handler.ts`:

```typescript
// New routes in identity/handler.ts handleApiEvent()
if (httpMethod === 'GET' && resource === '/certifications/stats') {
  return handleCertificationStats(user);
}
if (httpMethod === 'GET' && resource === '/certifications/catalog') {
  return handleCertificationCatalog(user, queryStringParameters);
}
if (httpMethod === 'GET' && resource === '/certifications/expiring') {
  return handleExpiringCertifications(user, queryStringParameters);
}
if (httpMethod === 'GET' && resource === '/certifications/pending') {
  return handlePendingCertifications(user);
}
```

#### Handler: `handleCertificationStats`

- Permission: `certifications:read`
- Query: Scan Certifications table with `PK = TENANT#{tenant_id}`, aggregate by status
- Uses GSI1 (`GSI1PK: TENANT#{tid}`, `GSI1SK: CERT#{expiry_date}#{cid}`) to efficiently find expiring certs
- Response shape:

```typescript
interface CertificationStatsResponse {
  totalActive: number;
  pendingValidation: number;
  expiringSoon: number;
  expired: number;
  byType: Array<{ type: string; count: number }>;
}
```

#### Handler: `handleCertificationCatalog`

- Permission: `certifications:read`
- Query: Certifications table for type definitions, filtered by optional `search` (name substring) and `category`
- Response shape:

```typescript
interface CertificationCatalogResponse {
  certTypes: Array<{
    id: string;
    name: string;
    category: string;
    issuingAuthority: string;
    validityMonths: number;
    isRequired: boolean;
    activeCount: number;
  }>;
  total: number;
}
```

#### Handler: `handleExpiringCertifications`

- Permission: `certifications:read`
- Query: Uses GSI1 on Certifications table with `GSI1PK = TENANT#{tid}` and `GSI1SK BETWEEN CERT#{today} AND CERT#{today + urgency_days}`
- Default urgency: 30 days
- Response shape:

```typescript
interface ExpiringCertificationsResponse {
  certifications: Array<{
    id: string;
    workerName: string;
    workerId: string;
    certType: string;
    expiryDate: string;
    daysRemaining: number;
    site: string;
  }>;
  total: number;
}
```

#### Handler: `handlePendingCertifications`

- Permission: `certifications:validate`
- Query: Certifications table with `PK = TENANT#{tid}#WORKER#{wid}` filtered by `status = pending_validation` (uses FilterExpression across all workers in tenant via GSI1)
- Response shape:

```typescript
interface PendingCertificationsResponse {
  certifications: Array<{
    id: string;
    workerName: string;
    certType: string;
    uploadedAt: string;
    documentUrl: string;
    expiryDate: string;
  }>;
  total: number;
}
```

### 2. Access Service — Site Access Endpoints

Six new route branches added to the existing `handler` function in `access/handler.ts`:

```typescript
// New routes in access/handler.ts handler()
if (httpMethod === 'GET' && resource === '/site-access/live') {
  return handleLiveAccess(user);
}
if (httpMethod === 'POST' && resource === '/site-access/check-in') {
  return handleCheckIn(event, user);
}
if (httpMethod === 'GET' && resource === '/site-access/recent-checkins') {
  return handleRecentCheckIns(user);
}
if (httpMethod === 'GET' && resource === '/site-access/rules') {
  return handleAccessRules(user);
}
if (httpMethod === 'GET' && resource === '/site-access/rejections') {
  return handleRejections(user, queryStringParameters);
}
if (httpMethod === 'GET' && resource === '/site-access/visits') {
  return handleVisits(user, queryStringParameters);
}
```

#### Handler: `handleLiveAccess`

- Permission: `access:read_decisions`
- Query: ScanSessions table with `PK = TENANT#{tid}`, filter `check_in_time IS NOT NULL AND check_out_time IS NULL`
- Response shape:

```typescript
interface LiveAccessResponse {
  workers: Array<{
    id: string;
    workerName: string;
    site: string;
    checkInTime: string;
    contractor: string;
    complianceStatus: string;
  }>;
  totalOnSite: number;
}
```

#### Handler: `handleCheckIn`

- Permission: `access:scan`
- Validation: `workerId` required in body (Zod schema)
- Logic: Look up worker → evaluate compliance against site policies → record decision
- Response shape:

```typescript
interface CheckInResponse {
  decision: 'allowed' | 'conditional' | 'denied';
  workerName: string;
  reasons: string[];
  missingCerts: string[];
}
```

#### Handler: `handleRecentCheckIns`

- Permission: `access:read_decisions`
- Query: ScanSessions table with `PK = TENANT#{tid}`, `ScanIndexForward: false`, `Limit: 10`
- Response shape:

```typescript
interface RecentCheckInsResponse {
  checkIns: Array<{
    id: string;
    workerName: string;
    decision: string;
    timestamp: string;
    site: string;
  }>;
}
```

#### Handler: `handleAccessRules`

- Permission: `access:read_decisions`
- Query: Policies table with `PK = TENANT#{tid}`, filter for access rule type
- Response shape:

```typescript
interface AccessRulesResponse {
  rules: Array<{
    id: string;
    name: string;
    site: string;
    requiredCerts: string[];
    enforcementLevel: string;
    isActive: boolean;
    createdAt: string;
  }>;
  total: number;
}
```

#### Handler: `handleRejections`

- Permission: `access:read_decisions`
- Query: ScanSessions table with `PK = TENANT#{tid}`, filter `result = 'denied'`
- Optional filters: `search` (worker name substring), `reason`, `period` (date range)
- Response shape:

```typescript
interface RejectionsResponse {
  rejections: Array<{
    id: string;
    workerName: string;
    site: string;
    reason: string;
    timestamp: string;
    missingRequirements: string[];
  }>;
  total: number;
}
```

#### Handler: `handleVisits`

- Permission: `access:read_decisions`
- Query: ScanSessions table with `PK = TENANT#{tid}`
- Optional filters: `search` (worker name), `decision`, `period` (date range)
- Response shape:

```typescript
interface VisitsResponse {
  visits: Array<{
    id: string;
    workerName: string;
    site: string;
    checkInTime: string;
    checkOutTime: string | null;
    duration: string | null;
    decision: string;
  }>;
  total: number;
}
```

### 3. Reporting Service — Dashboard & Report Endpoints

Six new route branches added to the existing `handleApiEvent` function in `reporting/handler.ts`:

```typescript
// New routes in reporting/handler.ts handleApiEvent()
if (httpMethod === 'GET' && resource === '/dashboard/kpis') {
  return handleDashboardKpis(user);
}
if (httpMethod === 'GET' && resource === '/dashboard/risks') {
  return handleDashboardRisks(user);
}
if (httpMethod === 'GET' && resource === '/dashboard/blocked-access') {
  return handleDashboardBlockedAccess(user);
}
if (httpMethod === 'GET' && resource === '/dashboard/expiring-certs') {
  return handleDashboardExpiringCerts(user);
}
if (httpMethod === 'GET' && resource === '/reports/compliance-summary') {
  return handleComplianceSummary(user);
}
if (httpMethod === 'GET' && resource === '/reports/site-access-logs') {
  return handleSiteAccessLogs(user, queryStringParameters);
}
```

#### Handler: `handleDashboardKpis`

- Permission: `reports:read`
- Queries: Workers table (count active), Certifications GSI1 (expiring in 30d), Findings table (unresolved), ScanSessions (compliance trend over 7 days)
- Response shape:

```typescript
interface DashboardKpisResponse {
  totalActiveWorkers: number;
  siteCompliancePercent: number;
  pendingFindings: number;
  unresolvedEnforcements: number;
  certsExpiringIn30Days: number;
  complianceTrend: Array<{ date: string; value: number }>;
}
```

#### Handler: `handleDashboardRisks`

- Permission: `reports:read`
- Query: Findings table with `PK = TENANT#{tid}`, filter `status != 'resolved'`
- Response shape:

```typescript
interface DashboardRisksResponse {
  risks: Array<{
    id: string;
    title: string;
    severity: string;
    site: string;
    createdAt: string;
  }>;
  total: number;
}
```

#### Handler: `handleDashboardBlockedAccess`

- Permission: `reports:read`
- Query: ScanSessions table with `PK = TENANT#{tid}`, filter `result = 'denied' AND timestamp >= today_start`
- Response shape:

```typescript
interface DashboardBlockedAccessResponse {
  events: Array<{
    id: string;
    workerName: string;
    site: string;
    reason: string;
    timestamp: string;
  }>;
  total: number;
}
```

#### Handler: `handleDashboardExpiringCerts`

- Permission: `reports:read`
- Query: Certifications GSI1 with `GSI1PK = TENANT#{tid}` and `GSI1SK BETWEEN CERT#{today} AND CERT#{today+30d}`
- Response shape:

```typescript
interface DashboardExpiringCertsResponse {
  certifications: Array<{
    id: string;
    workerName: string;
    certType: string;
    expiryDate: string;
    daysRemaining: number;
  }>;
  total: number;
}
```

#### Handler: `handleComplianceSummary`

- Permission: `reports:read`
- Queries: Sites table (count), Workers + Certifications (compliance per site), ScanSessions (30-day trend)
- Response shape:

```typescript
interface ComplianceSummaryResponse {
  overallPercent: number;
  totalSites: number;
  compliantSites: number;
  nonCompliantWorkers: number;
  trend: Array<{ date: string; value: number }>;
  bySite: Array<{ site: string; percent: number }>;
}
```

#### Handler: `handleSiteAccessLogs`

- Permission: `reports:read`
- Query: ScanSessions table with `PK = TENANT#{tid}`
- Optional filters: `search` (worker name), `decision`, `period` (date range)
- Response shape:

```typescript
interface SiteAccessLogsResponse {
  logs: Array<{
    id: string;
    workerName: string;
    site: string;
    decision: string;
    timestamp: string;
    method: string;
    operator: string;
  }>;
  total: number;
}
```

## CDK Route Definitions

New resources and methods added to `infra/lib/api-stack.ts`:

```typescript
// ─── API Routes: Certifications (Identity Service) ────────────────────────
const certifications = this.api.root.addResource('certifications');

const certStats = certifications.addResource('stats');
certStats.addMethod('GET', identityIntegration, authorizedMethodOptions);

const certCatalog = certifications.addResource('catalog');
certCatalog.addMethod('GET', identityIntegration, authorizedMethodOptions);

const certExpiring = certifications.addResource('expiring');
certExpiring.addMethod('GET', identityIntegration, authorizedMethodOptions);

const certPending = certifications.addResource('pending');
certPending.addMethod('GET', identityIntegration, authorizedMethodOptions);
```

```typescript
// ─── API Routes: Site Access (Access Service) ─────────────────────────────
const siteAccess = this.api.root.addResource('site-access');

const siteAccessLive = siteAccess.addResource('live');
siteAccessLive.addMethod('GET', accessIntegration, authorizedMethodOptions);

const siteAccessCheckIn = siteAccess.addResource('check-in');
siteAccessCheckIn.addMethod('POST', accessIntegration, authorizedMethodOptions);

const siteAccessRecentCheckins = siteAccess.addResource('recent-checkins');
siteAccessRecentCheckins.addMethod('GET', accessIntegration, authorizedMethodOptions);

const siteAccessRules = siteAccess.addResource('rules');
siteAccessRules.addMethod('GET', accessIntegration, authorizedMethodOptions);

const siteAccessRejections = siteAccess.addResource('rejections');
siteAccessRejections.addMethod('GET', accessIntegration, authorizedMethodOptions);

const siteAccessVisits = siteAccess.addResource('visits');
siteAccessVisits.addMethod('GET', accessIntegration, authorizedMethodOptions);
```

```typescript
// ─── API Routes: Dashboard (Reporting Service) ────────────────────────────
const dashboard = this.api.root.addResource('dashboard');

const dashboardKpis = dashboard.addResource('kpis');
dashboardKpis.addMethod('GET', reportingIntegration, authorizedMethodOptions);

const dashboardRisks = dashboard.addResource('risks');
dashboardRisks.addMethod('GET', reportingIntegration, authorizedMethodOptions);

const dashboardBlockedAccess = dashboard.addResource('blocked-access');
dashboardBlockedAccess.addMethod('GET', reportingIntegration, authorizedMethodOptions);

const dashboardExpiringCerts = dashboard.addResource('expiring-certs');
dashboardExpiringCerts.addMethod('GET', reportingIntegration, authorizedMethodOptions);

// ─── API Routes: Reports additions (Reporting Service) ────────────────────
const reportsComplianceSummary = reports.addResource('compliance-summary');
reportsComplianceSummary.addMethod('GET', reportingIntegration, authorizedMethodOptions);

const reportsSiteAccessLogs = reports.addResource('site-access-logs');
reportsSiteAccessLogs.addMethod('GET', reportingIntegration, authorizedMethodOptions);
```

## Data Models

### DynamoDB Access Patterns

| Endpoint | Table | Key Condition | Filter/Index |
|----------|-------|---------------|--------------|
| GET /certifications/stats | Certifications | GSI1PK = `TENANT#{tid}` | Aggregate by status field |
| GET /certifications/catalog | Certifications | PK = `TENANT#{tid}`, SK begins_with `CERTTYPE#` | FilterExpression on name/category |
| GET /certifications/expiring | Certifications | GSI1PK = `TENANT#{tid}`, GSI1SK BETWEEN range | None |
| GET /certifications/pending | Certifications | GSI1PK = `TENANT#{tid}` | FilterExpression: status = pending_validation |
| GET /site-access/live | ScanSessions | PK = `TENANT#{tid}` | FilterExpression: check_out_time IS NULL |
| POST /site-access/check-in | Workers, Certifications, Policies, ScanSessions | Multiple lookups | Compliance evaluation |
| GET /site-access/recent-checkins | ScanSessions | PK = `TENANT#{tid}` | Limit 10, ScanIndexForward: false |
| GET /site-access/rules | Policies | PK = `TENANT#{tid}`, SK begins_with `POLICY#` | FilterExpression: type = access_rule |
| GET /site-access/rejections | ScanSessions | PK = `TENANT#{tid}` | FilterExpression: result = denied |
| GET /site-access/visits | ScanSessions | PK = `TENANT#{tid}` | Optional filters on decision/period |
| GET /dashboard/kpis | Workers, Certifications, Findings, ScanSessions | Multiple queries | Aggregation logic |
| GET /dashboard/risks | Findings | PK = `TENANT#{tid}` | FilterExpression: status != resolved |
| GET /dashboard/blocked-access | ScanSessions | PK = `TENANT#{tid}` | FilterExpression: result = denied AND timestamp >= today |
| GET /dashboard/expiring-certs | Certifications | GSI1PK = `TENANT#{tid}`, GSI1SK BETWEEN range | None |
| GET /reports/compliance-summary | Sites, Workers, Certifications, ScanSessions | Multiple queries | Aggregation logic |
| GET /reports/site-access-logs | ScanSessions | PK = `TENANT#{tid}` | Optional filters |

### Shared Filter Utility

A reusable filter helper for `search`, `decision`/`reason`, and `period` parameters:

```typescript
interface FilterParams {
  search?: string;
  decision?: string;
  reason?: string;
  period?: string; // 'today' | '7d' | '30d' | '90d'
}

function buildFilterExpression(params: FilterParams): {
  filterExpression?: string;
  expressionAttributeValues?: Record<string, unknown>;
} {
  // Builds DynamoDB FilterExpression from query params
}

function getPeriodStartDate(period: string): string {
  // Converts period string to ISO date
}
```

## Error Handling

All endpoints follow the established error handling pattern:

| Condition | Response | Helper |
|-----------|----------|--------|
| Missing/invalid Authorization header | 401 UNAUTHORIZED | `authenticateRequest` returns error |
| User lacks required permission | 403 FORBIDDEN | `enforcePermission` returns error |
| Missing required body field (check-in) | 400 BAD_REQUEST | `badRequest(message)` |
| Unexpected server error | 500 INTERNAL_ERROR | `internalError(message)` |

Error responses use the standard `ErrorResponse` shape:

```typescript
{
  code: string;       // e.g., 'FORBIDDEN', 'BAD_REQUEST'
  message: string;
  request_id: string;
  timestamp: string;
  details?: Record<string, unknown>;
}
```

### Shared Types

All handlers use the existing shared types:

- `AuthenticatedUser` from `auth-middleware.ts` — provides `user_id`, `tenant_id`, `role`
- `ApiGatewayEvent` from `auth-middleware.ts` — Lambda proxy event shape
- `ApiGatewayResponse` from `error-handler.ts` — standardized response shape
- `Permission` from `rbac.ts` — union of all valid permission strings
- `Role` from `types/common.ts` — enum of platform roles

### New Zod Schema (Check-In)

```typescript
const checkInSchema = z.object({
  workerId: z.string().min(1, 'workerId is required'),
});
```

This is the only new endpoint that accepts a request body. All other endpoints are GET requests with optional query parameters.

## Testing Strategy

### Unit Tests (Example-Based)

- Authentication rejection: verify 401 for missing/invalid tokens (1 test per service)
- CDK route existence: CDK synth assertions for all 16 routes
- Check-in happy path: specific example with known worker/policy data
- Response shape validation: verify all required fields present for each endpoint

### Property-Based Tests

- RBAC enforcement across all role/endpoint combinations (Property 1)
- Tenant isolation with multi-tenant mock data (Property 2)
- Stats aggregation invariants (Property 3)
- Expiry window filtering with random dates and urgency values (Property 4)
- Catalog search filtering with random search terms (Property 5)
- Status filtering for pending/rejected/unresolved queries (Properties 6, 10, 13)
- Live session invariant (Property 7)
- Input validation with random invalid bodies (Property 8)
- Limit and ordering for recent check-ins (Property 9)
- KPI and compliance summary value bounds (Properties 12, 15)

### Integration Tests

- End-to-end request through API Gateway with Cognito token (1-2 per service)
- DynamoDB query correctness with seeded test data

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: RBAC enforcement denies unauthorized users

*For any* endpoint and *for any* user whose role lacks the required permission for that endpoint, the handler SHALL return HTTP 403 with error code `FORBIDDEN` and the response body SHALL not contain any tenant data.

**Validates: Requirements 1.2, 1.5, 2.2, 2.6, 3.2, 3.5, 4.2, 4.4, 5.2, 5.4, 6.2, 6.5, 7.2, 7.4, 8.2, 8.4, 9.2, 9.5, 10.2, 10.5, 11.2, 11.4, 12.2, 12.4, 13.2, 13.4, 14.2, 14.4, 15.2, 15.4, 16.2, 16.5**

### Property 2: Tenant isolation in query results

*For any* authenticated request to any endpoint, all items in the response SHALL belong exclusively to the authenticated user's tenant. No data from other tenants SHALL appear in the response.

**Validates: Requirements 1.3, 2.4, 3.4, 4.3, 5.3, 7.3, 8.3, 9.4, 10.4, 11.3, 12.3, 13.3, 14.3, 15.3, 16.4**

### Property 3: Certification stats aggregation correctness

*For any* set of certifications belonging to a tenant, the stats response SHALL satisfy: `totalActive + pendingValidation + expiringSoon + expired` equals the total number of certifications, and the sum of all `byType[].count` values equals the total number of certifications.

**Validates: Requirements 1.3, 1.4**

### Property 4: Expiry window filtering

*For any* urgency value N (defaulting to 30) and *for any* set of certifications, all certifications in the expiring endpoint response SHALL have an expiry date that is both in the future and within N days from the current date. No certification expiring outside this window SHALL appear.

**Validates: Requirements 3.3, 3.4, 14.3**

### Property 5: Catalog search filter correctness

*For any* catalog query with a `search` parameter and/or `category` parameter, all returned certification types SHALL match the search substring (case-insensitive) in their name AND match the specified category. No non-matching items SHALL appear.

**Validates: Requirements 2.3, 2.4**

### Property 6: Pending certifications status invariant

*For any* response from the pending certifications endpoint, all returned certifications SHALL have status equal to `pending_validation`. No certification with any other status SHALL appear.

**Validates: Requirements 4.3**

### Property 7: Live access session invariant

*For any* response from the live access endpoint, all returned workers SHALL have a non-null `checkInTime` and a null `checkOutTime`. The `totalOnSite` count SHALL equal the length of the `workers` array.

**Validates: Requirements 5.3**

### Property 8: Check-in input validation

*For any* POST request to `/site-access/check-in` where the request body is missing or the `workerId` field is empty/absent, the handler SHALL return HTTP 400 with error code `BAD_REQUEST`.

**Validates: Requirements 6.4**

### Property 9: Recent check-ins limit and ordering

*For any* response from the recent check-ins endpoint, the `checkIns` array SHALL contain at most 10 entries, and they SHALL be ordered by timestamp descending (most recent first).

**Validates: Requirements 7.3**

### Property 10: Rejection filter correctness

*For any* response from the rejections endpoint (with or without filters), all returned records SHALL have a decision result of `denied`. When `search`, `reason`, or `period` filters are applied, all returned records SHALL additionally satisfy those filter criteria.

**Validates: Requirements 9.3, 9.4**

### Property 11: Visit filter correctness

*For any* response from the visits endpoint with `search`, `decision`, or `period` filters applied, all returned records SHALL satisfy all active filter criteria simultaneously.

**Validates: Requirements 10.3, 10.4**

### Property 12: KPI value invariants

*For any* response from the dashboard KPIs endpoint, the following invariants SHALL hold: `totalActiveWorkers >= 0`, `0 <= siteCompliancePercent <= 100`, `pendingFindings >= 0`, `unresolvedEnforcements >= 0`, `certsExpiringIn30Days >= 0`, and `complianceTrend` SHALL contain exactly 7 entries.

**Validates: Requirements 11.3**

### Property 13: Dashboard risks unresolved invariant

*For any* response from the dashboard risks endpoint, all returned findings SHALL have an unresolved status (not `resolved`).

**Validates: Requirements 12.3**

### Property 14: Blocked access day-scoping invariant

*For any* response from the dashboard blocked-access endpoint, all returned events SHALL have a timestamp within the current calendar day AND a decision result of `denied`.

**Validates: Requirements 13.3**

### Property 15: Compliance summary value invariants

*For any* response from the compliance summary endpoint, the following invariants SHALL hold: `0 <= overallPercent <= 100`, `compliantSites <= totalSites`, `nonCompliantWorkers >= 0`, `trend` SHALL contain exactly 30 entries, and each `bySite[].percent` SHALL be between 0 and 100.

**Validates: Requirements 15.3**
