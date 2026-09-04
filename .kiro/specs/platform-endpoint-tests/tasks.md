# Implementation Plan: Platform Endpoint Tests

## Overview

Build a comprehensive test suite covering all platform API endpoints (excluding AI services) using vitest + fast-check. Tests are organized in three layers: unit tests (per-module isolation), E2E tests (full handler invocation with mocked AWS SDK), and property-based tests (universal invariants via fast-check). Shared mock factories provide reusable event builders, DynamoDB/S3 mocks, and auth helpers.

## Tasks

- [x] 1. Set up test infrastructure and shared mock factories
  - [x] 1.1 Create mock event factory (`tests/helpers/mock-event.ts`)
    - Implement `createMockEvent(options: MockEventOptions): APIGatewayProxyEvent`
    - Support httpMethod, resource, path, pathParameters, queryStringParameters, body, headers, claims, noAuth
    - Populate `requestContext.authorizer.claims` when claims provided
    - Omit auth when `noAuth: true`
    - _Requirements: 20.1_

  - [x] 1.2 Create authenticated user factory (`tests/helpers/mock-user.ts`)
    - Implement `createMockClaims(options?: MockUserOptions): Record<string, string>`
    - Default to tenant_admin role for tenant-test
    - Support configurable role, tenant_id, user_id, email, assigned_sites
    - _Requirements: 20.2_

  - [x] 1.3 Create DynamoDB mock (`tests/helpers/mock-dynamo.ts`)
    - Mock `@aws-sdk/lib-dynamodb` via `vi.mock`
    - Implement `setupDynamoMock`, `getDynamoCalls`, `resetDynamoMock`
    - Support configurable get/query responses and put/update/delete captures
    - _Requirements: 20.3_

  - [x] 1.4 Create S3 mock (`tests/helpers/mock-s3.ts`)
    - Mock `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
    - Implement `setupS3Mock`, `getS3Calls`
    - Return configurable presigned URLs
    - _Requirements: 20.4_

  - [x] 1.5 Create auth middleware mock (`tests/helpers/mock-auth.ts`)
    - Implement `mockAuthSuccess`, `mockAuthFailure`, `resetAuthMock`
    - Allow toggling between authenticated and unauthenticated states
    - _Requirements: 20.5_

- [x] 2. Identity Service — Unit Tests (Workers)
  - [x] 2.1 Write unit tests for worker creation module
    - Verify DynamoDB PutCommand params for valid input
    - Verify generated UUID, timestamps, and partition key with tenant prefix
    - _Requirements: 1.1, 1.4_

  - [x] 2.2 Write unit tests for worker retrieval module
    - Verify GetCommand key construction
    - Verify response mapping to expected shape
    - _Requirements: 1.2_

  - [x] 2.3 Write unit tests for worker update module
    - Verify UpdateCommand expression contains only provided fields
    - _Requirements: 1.3_

  - [x] 2.4 Write unit tests for certification creation module
    - Verify record includes generated ID, timestamps, correct partition key
    - _Requirements: 1.4_

  - [x] 2.5 Write unit tests for certification update module
    - Verify only mutable fields (status, expiry_date, document_key) are written
    - _Requirements: 1.5_

  - [x] 2.6 Write unit tests for validation rejection
    - Verify invalid input is rejected with descriptive errors
    - _Requirements: 1.6_

  - [x] 2.7 Write property test: partial update only writes specified fields
    - **Property 1: Partial update only writes specified fields**
    - Generate arbitrary subsets of updatable fields and verify UpdateExpression
    - **Validates: Requirements 1.3, 1.5**

  - [x] 2.8 Write property test: resource creation invariants
    - **Property 2: Resource creation invariants**
    - Verify every creation produces UUID, created_at, and tenant-prefixed partition key
    - **Validates: Requirements 1.4, 3.1, 5.1, 5.2, 5.3, 5.6, 7.1, 7.5, 9.1**

- [x] 3. Identity Service — E2E Tests (Workers Endpoints)
  - [x] 3.1 Write E2E tests for POST /workers
    - Verify 201 with created worker object
    - _Requirements: 2.1_

  - [x] 3.2 Write E2E tests for GET /workers and GET /workers/{id}
    - Verify 200 with array of workers and single worker retrieval
    - _Requirements: 2.2, 2.3_

  - [x] 3.3 Write E2E tests for PATCH /workers/{id}
    - Verify 200 with updated worker
    - _Requirements: 2.4_

  - [x] 3.4 Write E2E tests for GET /workers/{id}/status
    - Verify 200 with eligibility status
    - _Requirements: 2.5_

  - [x] 3.5 Write E2E tests for worker certifications CRUD
    - POST /workers/{id}/certifications → 201
    - GET /workers/{id}/certifications → 200 array
    - PATCH /workers/{id}/certifications/{certId} → 200
    - GET /workers/{id}/certifications/{certId}/document-url → 200 with presigned URL
    - _Requirements: 2.6, 2.7, 2.8, 2.9_

  - [x] 3.6 Write E2E tests for auth enforcement on /workers
    - Missing auth → 401
    - Insufficient role → 403
    - _Requirements: 2.10, 2.11_

- [ ] 4. Checkpoint — Identity Service tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Policy Service — Unit Tests (Sites & Policies)
  - [x] 5.1 Write unit tests for site creation module
    - Verify correct tenant partition key and generated ID
    - _Requirements: 3.1_

  - [x] 5.2 Write unit tests for policy creation module
    - Verify draft version is created alongside policy record
    - _Requirements: 3.2_

  - [x] 5.3 Write unit tests for policy version creation module
    - Verify version number increments from previous version
    - _Requirements: 3.3_

  - [x] 5.4 Write unit tests for effective-policies module
    - Verify all active policies assigned to site are aggregated
    - _Requirements: 3.4_

  - [x] 5.5 Write unit tests for policy validation
    - Verify schema violations are rejected with expected error code
    - _Requirements: 3.5_

  - [x] 5.6 Write property test: policy version auto-increment
    - **Property 5: Policy version auto-increment**
    - For N existing versions, new version has version_number = N + 1
    - **Validates: Requirements 3.3**

  - [x] 5.7 Write property test: effective-policies aggregation
    - **Property 6: Effective-policies aggregation correctness**
    - Only active policies assigned to site are returned
    - **Validates: Requirements 3.4**

  - [x] 5.8 Write property test: policy creation always produces draft
    - **Property 7: Policy creation always produces a draft version**
    - Verify both policy record and version with status `draft` persisted
    - **Validates: Requirements 3.2**

- [x] 6. Policy Service — E2E Tests (Sites & Policies Endpoints)
  - [x] 6.1 Write E2E tests for sites CRUD
    - POST /sites → 201, GET /sites → 200 array, GET /sites/{id} → 200, PATCH /sites/{id} → 200
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 6.2 Write E2E tests for GET /sites/{id}/effective-policies and /daily-summary
    - Verify 200 with aggregated policy list and daily summary object
    - _Requirements: 4.5, 4.6_

  - [x] 6.3 Write E2E tests for policies CRUD
    - POST /policies → 201, GET /policies → 200 array, GET /policies/{id} → 200
    - _Requirements: 4.7, 4.8, 4.9_

  - [x] 6.4 Write E2E tests for policy versions
    - POST /policies/{id}/versions → 201, GET /policies/{id}/versions → 200, GET /policies/{id}/versions/{vId} → 200
    - _Requirements: 4.10, 4.11, 4.12_

  - [x] 6.5 Write E2E tests for auth enforcement on /sites and /policies
    - Unauthorized role on POST /sites → 403
    - _Requirements: 4.13_

- [ ] 7. Access Service — Unit Tests
  - [x] 7.1 Write unit tests for access request module
    - Verify decision record creation with worker, site, timestamp
    - _Requirements: 5.1_

  - [x] 7.2 Write unit tests for scan module
    - Verify scan session persisted with status and scan timestamp
    - _Requirements: 5.2_

  - [x] 7.3 Write unit tests for token creation and deletion modules
    - Verify token with expiration and worker ID; verify deletion and audit event
    - _Requirements: 5.3, 5.4_

  - [x] 7.4 Write unit tests for revalidation module
    - Verify decision re-evaluation against current policies
    - _Requirements: 5.5_

  - [x] 7.5 Write unit tests for override creation module
    - Verify override references decision and includes authorizing user
    - Verify unauthorized role rejection
    - _Requirements: 5.6, 5.7_

- [x] 8. Access Service — E2E Tests
  - [x] 8.1 Write E2E tests for POST /access/request and POST /access/scan
    - Verify 200 decision result and 201 scan session
    - _Requirements: 6.1, 6.2_

  - [x] 8.2 Write E2E tests for GET /access/decisions/{id}
    - Verify 200 with full decision record
    - _Requirements: 6.3_

  - [x] 8.3 Write E2E tests for tokens CRUD
    - POST /access/tokens → 201, DELETE /access/tokens/{id} → 200
    - _Requirements: 6.4, 6.5_

  - [x] 8.4 Write E2E tests for POST /access/revalidate and override endpoints
    - POST /access/revalidate → 200, POST /access/override → 201, PATCH /access/override/{id} → 200
    - _Requirements: 6.6, 6.7, 6.8_

  - [x] 8.5 Write E2E tests for auth enforcement on /access
    - Missing auth on POST /access/scan → 401
    - gate_operator on POST /access/override → 403
    - _Requirements: 6.9, 6.10_

- [ ] 9. Checkpoint — Policy and Access Service tests
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Forms Service — Unit Tests
  - [ ] 10.1 Write unit tests for form creation module
    - Verify form stored with status DRAFT and correct tenant key
    - _Requirements: 7.1_

  - [ ] 10.2 Write unit tests for publish and unpublish modules
    - Publish: version record created and public token generated
    - Unpublish: status changed to DESPUBLICADO and token invalidated
    - _Requirements: 7.2, 7.3_

  - [ ] 10.3 Write unit tests for duplicate module
    - Verify new form with copied fields, new ID, fresh created_at, status DRAFT
    - _Requirements: 7.4_

  - [ ] 10.4 Write unit tests for response submission module
    - Verify answers persisted with generated folio and timestamp
    - _Requirements: 7.5_

  - [ ] 10.5 Write unit tests for rate-limiter module
    - Verify threshold exceeded → rejection with retry_after_seconds
    - _Requirements: 7.6_

  - [ ] 10.6 Write unit tests for sanitizer module
    - Verify bot detection: empty user-agent, honeypot filled, sub-second timing
    - _Requirements: 7.7_

  - [ ] 10.7 Write unit tests for export module
    - Verify CSV headers match field definitions and rows match responses
    - _Requirements: 7.8_

  - [ ] 10.8 Write unit tests for audit module
    - Verify log entries include actor, action, timestamp, entity reference
    - _Requirements: 7.9_

  - [ ] 10.9 Write property test: form publish creates version and public token
    - **Property 11: Form publish creates version and public token**
    - Verify version record with incremented number and token generation
    - **Validates: Requirements 7.2**

  - [ ] 10.10 Write property test: form duplication preserves fields with new identity
    - **Property 12: Form duplication preserves fields with new identity**
    - Verify copied fields, distinct form ID, fresh created_at, DRAFT status
    - **Validates: Requirements 7.4**

  - [ ] 10.11 Write property test: sanitizer detects bot-like submissions
    - **Property 13: Sanitizer detects bot-like submissions**
    - Generate submissions with bot characteristics and verify flagging
    - **Validates: Requirements 7.7**

  - [ ] 10.12 Write property test: CSV export round-trip correctness
    - **Property 14: CSV export round-trip correctness**
    - Verify header row matches field definitions and data rows match stored answers
    - **Validates: Requirements 7.8**

  - [ ] 10.13 Write property test: audit entry completeness
    - **Property 15: Audit entry completeness**
    - Verify every audit entry has actor, action type, entity reference, ISO-8601 timestamp
    - **Validates: Requirements 7.9, 14.8**

- [ ] 11. Forms Service — E2E Tests
  - [ ] 11.1 Write E2E tests for forms CRUD
    - POST /forms → 201, GET /forms → 200, GET /forms/{id} → 200, PATCH /forms/{id} → 200
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ] 11.2 Write E2E tests for publish/unpublish/duplicate
    - POST /forms/{id}/publish → 200, POST /forms/{id}/unpublish → 200, POST /forms/{id}/duplicate → 201
    - _Requirements: 8.5, 8.6, 8.7_

  - [ ] 11.3 Write E2E tests for form responses and export
    - GET /forms/{id}/responses → 200, GET /forms/{id}/responses/{rId} → 200, GET /forms/{id}/responses/export → 200 text/csv
    - _Requirements: 8.8, 8.9, 8.10_

  - [ ] 11.4 Write E2E tests for form audit and upload-url
    - GET /forms/{id}/audit → 200, POST /forms/{id}/upload-url → 200
    - _Requirements: 8.11, 8.12_

  - [ ] 11.5 Write E2E tests for public form endpoints
    - GET /public/forms/{token} → 200, POST /public/forms/{token}/responses → 201, POST /public/forms/{token}/upload-url → 200
    - _Requirements: 8.13, 8.14, 8.15_

  - [ ] 11.6 Write E2E tests for auth enforcement on /forms
    - Worker role on POST /forms → 403
    - _Requirements: 8.16_

- [ ] 12. Checkpoint — Forms Service tests
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Incident Service — Unit Tests
  - [ ] 13.1 Write unit tests for incident creation repository
    - Verify correct partition key, status OPEN, generated ID
    - _Requirements: 9.1_

  - [ ] 13.2 Write unit tests for state-machine module
    - Verify only valid transitions allowed from each state
    - _Requirements: 9.2_

  - [ ] 13.3 Write unit tests for regulatory-engine module
    - Verify incidents matching regulatory criteria are flagged
    - _Requirements: 9.3_

  - [ ] 13.4 Write unit tests for timeline-repository module
    - Verify events appended with correct chronological sort keys
    - _Requirements: 9.4_

  - [ ] 13.5 Write unit tests for validators module
    - Verify invalid payloads rejected with field-level errors
    - _Requirements: 9.5_

  - [ ] 13.6 Write unit tests for export-handler module
    - Verify PDF/CSV outputs contain required fields
    - _Requirements: 9.6_

  - [ ] 13.7 Write property test: incident state machine valid transitions
    - **Property 8: Incident state machine valid transitions only**
    - Generate arbitrary state + transition pairs, verify valid ones succeed and invalid return 422
    - **Validates: Requirements 9.2, 10.5, 10.6**

  - [ ] 13.8 Write property test: regulatory engine flagging
    - **Property 9: Regulatory engine flagging**
    - Generate incidents with/without regulatory criteria and verify correct flagging
    - **Validates: Requirements 9.3**

  - [ ] 13.9 Write property test: timeline chronological ordering
    - **Property 10: Timeline chronological ordering**
    - Append multiple timeline events and verify sort keys maintain ascending order
    - **Validates: Requirements 9.4**

- [ ] 14. Incident Service — E2E Tests
  - [ ] 14.1 Write E2E tests for POST /incidents
    - Verify 201 with created incident including regulatory evaluation
    - _Requirements: 10.1_

  - [ ] 14.2 Write E2E tests for GET /incidents and GET /incidents/{id}
    - Verify 200 with role-filtered list and full detail
    - _Requirements: 10.2, 10.3_

  - [ ] 14.3 Write E2E tests for PATCH /incidents/{id}
    - Verify 200 with updated incident and timeline entry
    - _Requirements: 10.4_

  - [ ] 14.4 Write E2E tests for incident transitions
    - Valid transition → 200; invalid transition → 422
    - _Requirements: 10.5, 10.6_

  - [ ] 14.5 Write E2E tests for comments and attachments
    - POST /incidents/{id}/comments → 201, POST /incidents/{id}/attachments → 201 with presigned URL
    - _Requirements: 10.7, 10.8_

  - [ ] 14.6 Write E2E tests for auth enforcement on /incidents
    - gate_operator on POST /incidents → 403
    - _Requirements: 10.9_

- [ ] 15. Contractors — E2E Tests
  - [ ] 15.1 Write E2E tests for contractors CRUD
    - POST /contractors → 201, GET /contractors → 200, GET /contractors/{id} → 200, PATCH /contractors/{id} → 200
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [ ] 15.2 Write E2E tests for contractor workers management
    - GET /contractors/{id}/workers → 200, POST /contractors/{id}/workers → 201, DELETE /contractors/{id}/workers/{wId} → 200
    - _Requirements: 11.5, 11.6, 11.7_

  - [ ] 15.3 Write E2E tests for GET /contractors/{id}/compliance
    - Verify 200 with compliance summary
    - _Requirements: 11.8_

  - [ ] 15.4 Write E2E tests for auth enforcement on /contractors
    - Worker role on POST /contractors → 403
    - _Requirements: 11.9_

- [ ] 16. Checkpoint — Incident and Contractors tests
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Sync Service — E2E Tests
  - [ ] 17.1 Write E2E tests for POST /sync/sessions
    - Verify 201 with session ID and initial status
    - _Requirements: 12.1_

  - [ ] 17.2 Write E2E tests for POST /sync/media
    - Verify 200 with presigned upload URL
    - _Requirements: 12.2_

  - [ ] 17.3 Write E2E tests for GET /sync/status
    - Verify 200 with sync status and pending item count
    - _Requirements: 12.3_

  - [ ] 17.4 Write E2E tests for auth enforcement on /sync
    - Missing auth on POST /sync/sessions → 401
    - _Requirements: 12.4_

- [ ] 18. Reporting Service — E2E Tests
  - [ ] 18.1 Write E2E tests for POST /reports and GET /reports/{id}
    - POST → 201 with report ID and status; GET → 200 with metadata
    - _Requirements: 13.1, 13.2_

  - [ ] 18.2 Write E2E tests for GET /reports/{id}/export
    - Verify 200 with download URL or content
    - _Requirements: 13.3_

  - [ ] 18.3 Write E2E tests for GET /workers/{id}/compliance-summary
    - Verify 200 with compliance metrics
    - _Requirements: 13.4_

  - [ ] 18.4 Write E2E tests for auth enforcement on /reports
    - Worker role on POST /reports → 403
    - _Requirements: 13.5_

- [ ] 19. Document Service — Unit Tests
  - [ ] 19.1 Write unit tests for folder-handler module
    - Verify folder navigation returns correct hierarchy for path and tenant
    - _Requirements: 14.1_

  - [ ] 19.2 Write unit tests for search-handler module
    - Verify search queries return filtered results matching terms
    - _Requirements: 14.2_

  - [ ] 19.3 Write unit tests for metadata-handler module
    - Verify all required fields returned: id, name, type, size, created_at, updated_at
    - _Requirements: 14.3_

  - [ ] 19.4 Write unit tests for preview-handler and download-handler modules
    - Preview: presigned URL with correct key/expiry
    - Download: session created with correct status
    - _Requirements: 14.4, 14.5_

  - [ ] 19.5 Write unit tests for integrity-handler module
    - Verify checksum verification returns valid or corrupted status
    - _Requirements: 14.6_

  - [ ] 19.6 Write unit tests for preferences-handler module
    - Verify organization-mode preferences stored and retrieved per user
    - _Requirements: 14.7_

  - [ ] 19.7 Write unit tests for audit-handler module
    - Verify audit events persisted with actor, action, document_id, timestamp
    - _Requirements: 14.8_

  - [ ] 19.8 Write property test: document search results match query
    - **Property 16: Document search results match query**
    - Generate queries and verify all results contain matching terms
    - **Validates: Requirements 14.2**

  - [ ] 19.9 Write property test: document metadata completeness
    - **Property 17: Document metadata completeness**
    - Verify every returned record has id, name, type, size, created_at, updated_at
    - **Validates: Requirements 14.3**

  - [ ] 19.10 Write property test: preferences round-trip
    - **Property 18: Preferences round-trip**
    - Write arbitrary valid preference, then GET returns same value
    - **Validates: Requirements 14.7**

- [ ] 20. Document Service — E2E Tests
  - [ ] 20.1 Write E2E tests for GET /documents/folders and search
    - Folders → 200 with hierarchy; search → 200 with results
    - _Requirements: 15.1, 15.2_

  - [ ] 20.2 Write E2E tests for document metadata and preview
    - GET /documents/{id}/metadata → 200, GET /documents/{id}/preview → 200 with presigned URL
    - _Requirements: 15.3, 15.4_

  - [ ] 20.3 Write E2E tests for download endpoints
    - POST /documents/download → 200, GET /documents/download/{id}/status → 200
    - _Requirements: 15.5, 15.6_

  - [ ] 20.4 Write E2E tests for integrity verification
    - POST /documents/{id}/verify-integrity → 200
    - _Requirements: 15.7_

  - [ ] 20.5 Write E2E tests for preferences endpoints
    - GET /documents/preferences/organization-mode → 200, PUT → 200
    - _Requirements: 15.8, 15.9_

  - [ ] 20.6 Write E2E tests for POST /documents/audit-log
    - Verify 201 confirming audit entry creation
    - _Requirements: 15.10_

  - [ ] 20.7 Write E2E tests for auth enforcement on /documents
    - gate_operator → 403, worker → 403
    - _Requirements: 15.11, 15.12_

- [ ] 21. Checkpoint — Sync, Reporting, and Document Service tests
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 22. Certifications Aggregate — E2E Tests
  - [ ] 22.1 Write E2E tests for GET /certifications/stats
    - Verify 200 with total, valid, expired, expiring_soon counts
    - _Requirements: 16.1_

  - [ ] 22.2 Write E2E tests for GET /certifications/catalog
    - Verify 200 with certification type catalog array
    - _Requirements: 16.2_

  - [ ] 22.3 Write E2E tests for GET /certifications/expiring
    - Verify 200 with certifications within configured threshold
    - _Requirements: 16.3_

  - [ ] 22.4 Write E2E tests for auth enforcement on /certifications
    - Missing auth → 401
    - _Requirements: 16.4_

- [ ] 23. Cross-Cutting — Validation, Tenant Isolation, and Unsupported Routes
  - [ ] 23.1 Write E2E tests for validation error consistency
    - Empty body → 400, missing required fields → 400, invalid types → 400, non-existent resource → 404
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [ ] 23.2 Write E2E tests for tenant isolation
    - Tenant-A request for tenant-B resource → 404
    - Tenant-A creation stores tenant-A's tenant_id
    - Tenant-A listing returns only tenant-A resources
    - _Requirements: 18.1, 18.2, 18.3_

  - [ ] 23.3 Write E2E tests for unsupported route handling
    - Unsupported method on known path → 400 "Unsupported route"
    - Unknown path → 400 "Unsupported route"
    - _Requirements: 19.1, 19.2_

  - [ ] 23.4 Write property test: input validation rejects malformed requests
    - **Property 3: Input validation rejects malformed requests**
    - Generate bodies violating schema constraints, verify 400 without unhandled exception
    - **Validates: Requirements 1.6, 9.5, 17.1, 17.2, 17.3**

  - [ ] 23.5 Write property test: missing authentication returns 401
    - **Property 4: Missing authentication returns 401**
    - Generate requests without auth to authenticated endpoints, verify 401
    - **Validates: Requirements 2.10, 6.9, 12.4, 16.4**

  - [ ] 23.6 Write property test: tenant isolation guarantee
    - **Property 19: Tenant isolation guarantee**
    - Cross-tenant requests never return resource data (404 or 403)
    - **Validates: Requirements 18.1, 18.2, 18.3**

  - [ ] 23.7 Write property test: unsupported routes return consistent error
    - **Property 20: Unsupported routes return consistent error**
    - Arbitrary method/path combos not in routing → 400 "Unsupported route"
    - **Validates: Requirements 19.1, 19.2**

  - [ ] 23.8 Write property test: handler robustness under arbitrary input
    - **Property 21: Handler robustness under arbitrary input**
    - Random bodies, paths, params → never throws, always returns valid ApiGatewayResponse
    - **Validates: Requirements 21.1, 21.2**

  - [ ] 23.9 Write property test: RBAC correctness for defined roles only
    - **Property 22: RBAC correctness for defined roles only**
    - Arbitrary role strings: only 7 defined roles pass checks
    - **Validates: Requirements 21.3**

  - [ ] 23.10 Write property test: non-existent resource returns 404
    - **Property 23: Non-existent resource returns 404**
    - GET/PATCH with non-existent IDs always returns 404
    - **Validates: Requirements 17.4**

- [ ] 24. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All tests use TypeScript with vitest + fast-check
- Mock factories are shared across all test layers via `tests/helpers/`
- Handlers are invoked directly — no HTTP server or deployment required

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "5.1", "5.2", "5.3", "5.4", "5.5", "7.1", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 2, "tasks": ["2.7", "2.8", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "5.6", "5.7", "5.8", "6.1", "6.2", "6.3", "6.4", "6.5", "8.1", "8.2", "8.3", "8.4", "8.5"] },
    { "id": 3, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5", "10.6", "10.7", "10.8", "13.1", "13.2", "13.3", "13.4", "13.5", "13.6"] },
    { "id": 4, "tasks": ["10.9", "10.10", "10.11", "10.12", "10.13", "11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "13.7", "13.8", "13.9", "14.1", "14.2", "14.3", "14.4", "14.5", "14.6"] },
    { "id": 5, "tasks": ["15.1", "15.2", "15.3", "15.4", "17.1", "17.2", "17.3", "17.4", "18.1", "18.2", "18.3", "18.4", "19.1", "19.2", "19.3", "19.4", "19.5", "19.6", "19.7"] },
    { "id": 6, "tasks": ["19.8", "19.9", "19.10", "20.1", "20.2", "20.3", "20.4", "20.5", "20.6", "20.7", "22.1", "22.2", "22.3", "22.4"] },
    { "id": 7, "tasks": ["23.1", "23.2", "23.3", "23.4", "23.5", "23.6", "23.7", "23.8", "23.9", "23.10"] }
  ]
}
```
