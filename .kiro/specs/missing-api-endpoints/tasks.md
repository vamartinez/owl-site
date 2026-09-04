# Implementation Plan: Missing API Endpoints

## Overview

Implement 16 missing API endpoints across three existing Lambda services (Identity, Access, Reporting). Each handler follows the established pattern: authenticate → enforce permission → DynamoDB query (tenant-scoped) → structured JSON response. A shared filter utility is introduced for reuse across endpoints with search/period/decision filtering. CDK route definitions are added in a single task. A deploy verification task closes the plan.

## Tasks

- [x] 1. Shared utilities and types
  - [x] 1.1 Create shared filter utility and response types
    - Create `src/shared/filter-utils.ts` with `buildFilterExpression` and `getPeriodStartDate` helpers
    - Add Zod schema for check-in request body in `src/services/access/schemas.ts`
    - Define shared response interfaces used across multiple handlers
    - _Requirements: 9.3, 10.3, 16.3, 6.4_

- [x] 2. Identity Service — Certification endpoints
  - [x] 2.1 Implement `handleCertificationStats` handler
    - Add route branch in `src/services/identity/handler.ts` for `GET /certifications/stats`
    - Enforce `certifications:read` permission
    - Query Certifications table via GSI1 scoped to tenant, aggregate by status
    - Return `CertificationStatsResponse` shape with HTTP 200
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.2 Implement `handleCertificationCatalog` handler
    - Add route branch for `GET /certifications/catalog`
    - Enforce `certifications:read` permission
    - Query Certifications table for type definitions with optional `search` and `category` filters
    - Return `CertificationCatalogResponse` shape with HTTP 200
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.3 Implement `handleExpiringCertifications` handler
    - Add route branch for `GET /certifications/expiring`
    - Enforce `certifications:read` permission
    - Query GSI1 with date range (default 30 days, configurable via `urgency` query param)
    - Return `ExpiringCertificationsResponse` shape with HTTP 200
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.4 Implement `handlePendingCertifications` handler
    - Add route branch for `GET /certifications/pending`
    - Enforce `certifications:validate` permission
    - Query GSI1 with FilterExpression for `status = pending_validation`
    - Return `PendingCertificationsResponse` shape with HTTP 200
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 3. Checkpoint — Identity Service complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Access Service — Site Access endpoints
  - [x] 4.1 Implement `handleLiveAccess` handler
    - Add route branch in `src/services/access/handler.ts` for `GET /site-access/live`
    - Enforce `access:read_decisions` permission
    - Query ScanSessions table filtered by check-in present and no check-out
    - Return `LiveAccessResponse` shape with HTTP 200
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 4.2 Implement `handleCheckIn` handler
    - Add route branch for `POST /site-access/check-in`
    - Enforce `access:scan` permission
    - Validate request body with Zod schema (workerId required)
    - Look up worker, evaluate compliance against site policies, record decision
    - Return `CheckInResponse` shape with HTTP 200 or 400 for invalid input
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 4.3 Implement `handleRecentCheckIns` handler
    - Add route branch for `GET /site-access/recent-checkins`
    - Enforce `access:read_decisions` permission
    - Query ScanSessions with `ScanIndexForward: false` and `Limit: 10`
    - Return `RecentCheckInsResponse` shape with HTTP 200
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 4.4 Implement `handleAccessRules` handler
    - Add route branch for `GET /site-access/rules`
    - Enforce `access:read_decisions` permission
    - Query Policies table filtered by access rule type
    - Return `AccessRulesResponse` shape with HTTP 200
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 4.5 Implement `handleRejections` handler
    - Add route branch for `GET /site-access/rejections`
    - Enforce `access:read_decisions` permission
    - Query ScanSessions filtered by `result = denied` with optional search/reason/period filters
    - Use shared filter utility
    - Return `RejectionsResponse` shape with HTTP 200
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 4.6 Implement `handleVisits` handler
    - Add route branch for `GET /site-access/visits`
    - Enforce `access:read_decisions` permission
    - Query ScanSessions with optional search/decision/period filters
    - Use shared filter utility
    - Return `VisitsResponse` shape with HTTP 200
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 5. Checkpoint — Access Service complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Reporting Service — Dashboard & Report endpoints
  - [x] 6.1 Implement `handleDashboardKpis` handler
    - Add route branch in `src/services/reporting/handler.ts` for `GET /dashboard/kpis`
    - Enforce `reports:read` permission
    - Query Workers, Certifications, Findings, and ScanSessions tables for aggregated KPIs
    - Compute 7-day compliance trend
    - Return `DashboardKpisResponse` shape with HTTP 200
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 6.2 Implement `handleDashboardRisks` handler
    - Add route branch for `GET /dashboard/risks`
    - Enforce `reports:read` permission
    - Query Findings table filtered by `status != resolved`
    - Return `DashboardRisksResponse` shape with HTTP 200
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 6.3 Implement `handleDashboardBlockedAccess` handler
    - Add route branch for `GET /dashboard/blocked-access`
    - Enforce `reports:read` permission
    - Query ScanSessions filtered by `result = denied` and timestamp within current day
    - Return `DashboardBlockedAccessResponse` shape with HTTP 200
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 6.4 Implement `handleDashboardExpiringCerts` handler
    - Add route branch for `GET /dashboard/expiring-certs`
    - Enforce `reports:read` permission
    - Query Certifications GSI1 for certs expiring within 30 days
    - Return `DashboardExpiringCertsResponse` shape with HTTP 200
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 6.5 Implement `handleComplianceSummary` handler
    - Add route branch for `GET /reports/compliance-summary`
    - Enforce `reports:read` permission
    - Query Sites, Workers, Certifications, and ScanSessions for compliance aggregation
    - Compute 30-day trend and per-site breakdown
    - Return `ComplianceSummaryResponse` shape with HTTP 200
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 6.6 Implement `handleSiteAccessLogs` handler
    - Add route branch for `GET /reports/site-access-logs`
    - Enforce `reports:read` permission
    - Query ScanSessions with optional search/decision/period filters
    - Use shared filter utility
    - Return `SiteAccessLogsResponse` shape with HTTP 200
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [x] 7. Checkpoint — Reporting Service complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. CDK route definitions
  - [x] 8.1 Add all 16 API Gateway routes to `infra/lib/api-stack.ts`
    - Add `/certifications/stats`, `/certifications/catalog`, `/certifications/expiring`, `/certifications/pending` resources with GET methods routed to identity integration
    - Add `/site-access/live`, `/site-access/check-in`, `/site-access/recent-checkins`, `/site-access/rules`, `/site-access/rejections`, `/site-access/visits` resources with appropriate methods routed to access integration
    - Add `/dashboard/kpis`, `/dashboard/risks`, `/dashboard/blocked-access`, `/dashboard/expiring-certs` resources with GET methods routed to reporting integration
    - Add `/reports/compliance-summary`, `/reports/site-access-logs` resources with GET methods routed to reporting integration
    - All methods use Cognito authorizer via `authorizedMethodOptions`
    - _Requirements: 1.6, 2.7, 3.6, 4.5, 5.5, 6.6, 7.5, 8.5, 9.6, 10.6, 11.5, 12.5, 13.5, 14.5, 15.5, 16.6_

- [x] 9. Deploy and verify
  - [x] 9.1 Run CDK synth and deploy
    - Run `cdk synth` to validate the CloudFormation template compiles without errors
    - Run `cdk deploy --all` to deploy the updated stacks
    - Verify all 16 new routes appear in the API Gateway console output
    - _Requirements: 1.6, 2.7, 3.6, 4.5, 5.5, 6.6, 7.5, 8.5, 9.6, 10.6, 11.5, 12.5, 13.5, 14.5, 15.5, 16.6_

- [x] 10. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each handler follows the identical pipeline: `authenticateRequest` → `enforcePermission` → DynamoDB query → `createSuccessResponse`
- The shared filter utility (`buildFilterExpression`, `getPeriodStartDate`) is reused by rejections, visits, and site-access-logs endpoints
- All DynamoDB queries are tenant-scoped using the authenticated user's `tenant_id`
- The check-in endpoint is the only POST; all others are GET with optional query parameters
- Property-based tests are skipped per user request for faster delivery
- Checkpoints are placed between each service group to validate incrementally

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "id": 2, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6"] },
    { "id": 3, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6"] },
    { "id": 4, "tasks": ["8.1"] },
    { "id": 5, "tasks": ["9.1"] }
  ]
}
```
