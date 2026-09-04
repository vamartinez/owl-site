# Requirements Document

## Introduction

Comprehensive test coverage (unit tests and E2E/integration tests) for all platform API endpoints excluding AI-related services (ai-orchestration, detection, scene-understanding, regulatory-mapping). Tests validate handler routing, request validation, response shapes, error codes, auth/RBAC enforcement, and business logic using vitest with mocked API Gateway events and mocked AWS SDK clients.

## Glossary

- **Test_Harness**: The local test execution environment using vitest that invokes Lambda handlers directly with mocked API Gateway events and mocked AWS SDK clients
- **Unit_Test**: A test scoped to a single module or function within a service, with all external dependencies mocked, located in `packages/backend/src/services/{service}/__tests__/`
- **E2E_Test**: An end-to-end integration test that invokes the full Lambda handler with a mocked API Gateway event, exercising routing, auth, validation, and business logic together, located in `packages/backend/tests/e2e/`
- **Handler**: A Lambda entry point function that receives an API Gateway proxy event and returns an API Gateway proxy response
- **Mock_Event**: A synthetic API Gateway proxy integration event object containing httpMethod, resource, path, headers, pathParameters, queryStringParameters, body, and requestContext
- **RBAC**: Role-Based Access Control enforced via Cognito custom claims (custom:role, custom:tenant_id, custom:assigned_sites)
- **Identity_Service**: Lambda handler serving /workers and /contractors endpoints
- **Policy_Service**: Lambda handler serving /sites and /policies endpoints
- **Access_Service**: Lambda handler serving /access endpoints
- **Forms_Service**: Lambda handler serving /forms and /public/forms endpoints
- **Incident_Service**: Lambda handler serving /incidents endpoints
- **Sync_Service**: Lambda handler serving /sync endpoints
- **Reporting_Service**: Lambda handler serving /reports and /workers/{id}/compliance-summary and /sites/{id}/daily-summary endpoints
- **Document_Service**: Lambda handler serving /documents endpoints
- **Certifications_Endpoints**: Identity Service routes under /certifications (stats, catalog, expiring)
- **Tenant_Isolation**: The guarantee that a request scoped to one tenant cannot read or modify another tenant's data

## Requirements

### Requirement 1: Identity Service Unit Tests — Workers

**User Story:** As a developer, I want unit tests for all worker-related modules (worker.ts, certification.ts), so that individual functions are verified in isolation.

#### Acceptance Criteria

1. WHEN a unit test is executed for the worker creation module, THE Unit_Test SHALL validate that a well-formed input produces the expected DynamoDB PutCommand parameters
2. WHEN a unit test is executed for the worker retrieval module, THE Unit_Test SHALL validate that GetCommand is called with the correct key and the response is mapped to the expected shape
3. WHEN a unit test is executed for the worker update module, THE Unit_Test SHALL validate that UpdateCommand is invoked with only the provided fields in the expression
4. WHEN a unit test is executed for the certification creation module, THE Unit_Test SHALL validate that the certification record includes a generated ID, timestamps, and correct partition key
5. WHEN a unit test is executed for the certification update module, THE Unit_Test SHALL validate that only mutable fields (status, expiry_date, document_key) are written
6. IF a unit test provides invalid input to a worker module, THEN THE Unit_Test SHALL confirm that validation rejects the input with a descriptive error

### Requirement 2: Identity Service E2E Tests — Workers Endpoints

**User Story:** As a developer, I want E2E tests for all /workers endpoints, so that routing, auth, validation, and response contracts are verified end-to-end through the handler.

#### Acceptance Criteria

1. WHEN an authenticated POST /workers Mock_Event is sent to the Identity_Service Handler, THE E2E_Test SHALL verify a 201 response with the created worker object
2. WHEN an authenticated GET /workers Mock_Event is sent to the Identity_Service Handler, THE E2E_Test SHALL verify a 200 response containing an array of worker records
3. WHEN an authenticated GET /workers/{id} Mock_Event is sent with a valid ID, THE E2E_Test SHALL verify a 200 response with the matching worker object
4. WHEN an authenticated PATCH /workers/{id} Mock_Event is sent with valid update fields, THE E2E_Test SHALL verify a 200 response with the updated worker object
5. WHEN an authenticated GET /workers/{id}/status Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the worker's eligibility status
6. WHEN an authenticated POST /workers/{id}/certifications Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the created certification record
7. WHEN an authenticated GET /workers/{id}/certifications Mock_Event is sent, THE E2E_Test SHALL verify a 200 response containing an array of certification records
8. WHEN an authenticated PATCH /workers/{id}/certifications/{certId} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the updated certification
9. WHEN an authenticated GET /workers/{id}/certifications/{certId}/document-url Mock_Event is sent, THE E2E_Test SHALL verify a 200 response containing a presigned S3 URL
10. WHEN a Mock_Event without an Authorization header is sent to any /workers endpoint, THE E2E_Test SHALL verify a 401 response
11. WHEN a Mock_Event with a role lacking permission is sent to POST /workers, THE E2E_Test SHALL verify a 403 response

### Requirement 3: Policy Service Unit Tests — Sites and Policies

**User Story:** As a developer, I want unit tests for all site and policy modules, so that CRUD logic and version management are verified in isolation.

#### Acceptance Criteria

1. WHEN a unit test is executed for the site creation module, THE Unit_Test SHALL validate that the site record is stored with the correct tenant partition key and generated ID
2. WHEN a unit test is executed for the policy creation module, THE Unit_Test SHALL validate that a draft version is created alongside the policy record
3. WHEN a unit test is executed for the policy version creation module, THE Unit_Test SHALL validate that the version number increments from the previous version
4. WHEN a unit test is executed for the effective-policies module, THE Unit_Test SHALL validate that all active policies assigned to a site are aggregated correctly
5. IF a unit test provides a policy update that violates schema constraints, THEN THE Unit_Test SHALL confirm the module rejects it with the expected error code

### Requirement 4: Policy Service E2E Tests — Sites and Policies Endpoints

**User Story:** As a developer, I want E2E tests for all /sites and /policies endpoints, so that routing, auth, and data contracts are verified through the handler.

#### Acceptance Criteria

1. WHEN an authenticated POST /sites Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the created site object
2. WHEN an authenticated GET /sites Mock_Event is sent, THE E2E_Test SHALL verify a 200 response containing an array of site records
3. WHEN an authenticated GET /sites/{id} Mock_Event is sent with a valid ID, THE E2E_Test SHALL verify a 200 response with the matching site object
4. WHEN an authenticated PATCH /sites/{id} Mock_Event is sent with valid update fields, THE E2E_Test SHALL verify a 200 response with the updated site
5. WHEN an authenticated GET /sites/{id}/effective-policies Mock_Event is sent, THE E2E_Test SHALL verify a 200 response containing the aggregated policy list
6. WHEN an authenticated GET /sites/{id}/daily-summary Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the daily compliance summary object
7. WHEN an authenticated POST /policies Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the created policy
8. WHEN an authenticated GET /policies Mock_Event is sent, THE E2E_Test SHALL verify a 200 response containing an array of policy records
9. WHEN an authenticated GET /policies/{id} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the matching policy
10. WHEN an authenticated POST /policies/{id}/versions Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the new version record
11. WHEN an authenticated GET /policies/{id}/versions Mock_Event is sent, THE E2E_Test SHALL verify a 200 response containing an array of version records
12. WHEN an authenticated GET /policies/{id}/versions/{versionId} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the matching version
13. WHEN a Mock_Event with an unauthorized role is sent to POST /sites, THE E2E_Test SHALL verify a 403 response

### Requirement 5: Access Service Unit Tests

**User Story:** As a developer, I want unit tests for access service modules (token management, scan logic, decision lookup, revalidation, overrides), so that each business rule is verified independently.

#### Acceptance Criteria

1. WHEN a unit test is executed for the access request module, THE Unit_Test SHALL validate that a decision record is created with the correct worker, site, and timestamp
2. WHEN a unit test is executed for the scan module, THE Unit_Test SHALL validate that a scan session record is persisted with status and scan timestamp
3. WHEN a unit test is executed for the token creation module, THE Unit_Test SHALL validate that a token record is generated with expiration and associated worker ID
4. WHEN a unit test is executed for the token deletion module, THE Unit_Test SHALL validate that the token record is removed and an audit event is emitted
5. WHEN a unit test is executed for the revalidation module, THE Unit_Test SHALL validate that an existing decision is re-evaluated against current policies
6. WHEN a unit test is executed for the override creation module, THE Unit_Test SHALL validate that the override record references the decision and includes the authorizing user
7. IF a unit test provides an override request by an unauthorized role, THEN THE Unit_Test SHALL confirm the module rejects with a permission error

### Requirement 6: Access Service E2E Tests

**User Story:** As a developer, I want E2E tests for all /access endpoints, so that the complete request lifecycle is verified.

#### Acceptance Criteria

1. WHEN an authenticated POST /access/request Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the decision result
2. WHEN an authenticated POST /access/scan Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the scan session ID
3. WHEN an authenticated GET /access/decisions/{id} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the full decision record
4. WHEN an authenticated POST /access/tokens Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the token and expiration
5. WHEN an authenticated DELETE /access/tokens/{id} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response confirming deletion
6. WHEN an authenticated POST /access/revalidate Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the revalidation result
7. WHEN an authenticated POST /access/override Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the override record
8. WHEN an authenticated PATCH /access/override/{id} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the updated override
9. WHEN a Mock_Event without auth is sent to POST /access/scan, THE E2E_Test SHALL verify a 401 response
10. WHEN a Mock_Event with gate_operator role is sent to POST /access/override, THE E2E_Test SHALL verify a 403 response

### Requirement 7: Forms Service Unit Tests

**User Story:** As a developer, I want unit tests for all forms modules (CRUD, publish/unpublish, responses, export, rate-limiter, sanitizer, audit), so that each feature is independently verified.

#### Acceptance Criteria

1. WHEN a unit test is executed for the form creation module, THE Unit_Test SHALL validate that the form record is stored with status DRAFT and correct tenant key
2. WHEN a unit test is executed for the publish module, THE Unit_Test SHALL validate that a version record is created and a public token is generated
3. WHEN a unit test is executed for the unpublish module, THE Unit_Test SHALL validate that the form status changes to DESPUBLICADO and the public token is invalidated
4. WHEN a unit test is executed for the duplicate module, THE Unit_Test SHALL validate that a new form is created with a copy of fields and a new ID
5. WHEN a unit test is executed for the response submission module, THE Unit_Test SHALL validate that answers are persisted with a generated folio and timestamp
6. WHEN a unit test is executed for the rate-limiter module, THE Unit_Test SHALL validate that requests exceeding the threshold are rejected with retry_after_seconds
7. WHEN a unit test is executed for the sanitizer module, THE Unit_Test SHALL validate that bot-like submissions (empty user-agent, honeypot filled, sub-second timing) are detected
8. WHEN a unit test is executed for the export module, THE Unit_Test SHALL validate that the CSV output contains correct headers and row data matching responses
9. WHEN a unit test is executed for the audit module, THE Unit_Test SHALL validate that log entries include actor, action, timestamp, and entity reference

### Requirement 8: Forms Service E2E Tests

**User Story:** As a developer, I want E2E tests for all /forms endpoints (authenticated and public), so that full handler routing and business logic are verified.

#### Acceptance Criteria

1. WHEN an authenticated POST /forms Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the created form object
2. WHEN an authenticated GET /forms Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with an array of form records
3. WHEN an authenticated GET /forms/{id} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the matching form
4. WHEN an authenticated PATCH /forms/{id} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the updated form
5. WHEN an authenticated POST /forms/{id}/publish Mock_Event is sent, THE E2E_Test SHALL verify a 200 response containing the public token and URL
6. WHEN an authenticated POST /forms/{id}/unpublish Mock_Event is sent, THE E2E_Test SHALL verify a 200 response confirming the status change
7. WHEN an authenticated POST /forms/{id}/duplicate Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the duplicated form
8. WHEN an authenticated GET /forms/{id}/responses Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with paginated response records
9. WHEN an authenticated GET /forms/{id}/responses/{responseId} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the response detail and version schema
10. WHEN an authenticated GET /forms/{id}/responses/export Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with Content-Type text/csv
11. WHEN an authenticated GET /forms/{id}/audit Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with audit log entries and cursor
12. WHEN an authenticated POST /forms/{id}/upload-url Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with upload_url and file_key
13. WHEN a GET /public/forms/{token} Mock_Event is sent without auth, THE E2E_Test SHALL verify a 200 response with the published form schema
14. WHEN a POST /public/forms/{token}/responses Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with folio and response_id
15. WHEN a POST /public/forms/{token}/upload-url Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the presigned upload URL
16. WHEN a Mock_Event with worker role is sent to POST /forms, THE E2E_Test SHALL verify a 403 response

### Requirement 9: Incident Service Unit Tests

**User Story:** As a developer, I want unit tests for incident service modules (repository, state-machine, regulatory-engine, timeline, validators, export), so that each component is verified in isolation.

#### Acceptance Criteria

1. WHEN a unit test is executed for the incident creation repository, THE Unit_Test SHALL validate that the record is stored with correct partition key, status OPEN, and generated ID
2. WHEN a unit test is executed for the state-machine module, THE Unit_Test SHALL validate that only valid transitions are allowed from each state
3. WHEN a unit test is executed for the regulatory-engine module, THE Unit_Test SHALL validate that incidents matching regulatory criteria are flagged appropriately
4. WHEN a unit test is executed for the timeline-repository module, THE Unit_Test SHALL validate that events are appended with correct chronological sort keys
5. WHEN a unit test is executed for the validators module, THE Unit_Test SHALL validate that invalid incident payloads are rejected with field-level errors
6. WHEN a unit test is executed for the export-handler module, THE Unit_Test SHALL validate that PDF/CSV outputs contain required fields per export type

### Requirement 10: Incident Service E2E Tests

**User Story:** As a developer, I want E2E tests for all /incidents endpoints, so that handler routing, state transitions, and regulatory logic are verified end-to-end.

#### Acceptance Criteria

1. WHEN an authenticated POST /incidents Mock_Event is sent with valid data, THE E2E_Test SHALL verify a 201 response with the created incident including regulatory evaluation
2. WHEN an authenticated GET /incidents Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with role-filtered incident list
3. WHEN an authenticated GET /incidents/{id} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the full incident detail
4. WHEN an authenticated PATCH /incidents/{id} Mock_Event is sent with valid fields, THE E2E_Test SHALL verify a 200 response with the updated incident and a timeline entry
5. WHEN an authenticated POST /incidents/{id}/transition Mock_Event is sent with a valid transition, THE E2E_Test SHALL verify a 200 response confirming the state change
6. IF an authenticated POST /incidents/{id}/transition Mock_Event is sent with an invalid transition, THEN THE E2E_Test SHALL verify a 422 response with the error detail
7. WHEN an authenticated POST /incidents/{id}/comments Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the appended comment
8. WHEN an authenticated POST /incidents/{id}/attachments Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the presigned upload URL
9. WHEN a Mock_Event with gate_operator role is sent to POST /incidents, THE E2E_Test SHALL verify a 403 response

### Requirement 11: Contractors E2E Tests

**User Story:** As a developer, I want E2E tests for all /contractors endpoints, so that contractor CRUD and worker assignment logic are verified.

#### Acceptance Criteria

1. WHEN an authenticated POST /contractors Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the created contractor record
2. WHEN an authenticated GET /contractors Mock_Event is sent, THE E2E_Test SHALL verify a 200 response containing an array of contractor records
3. WHEN an authenticated GET /contractors/{id} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the matching contractor
4. WHEN an authenticated PATCH /contractors/{id} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the updated contractor
5. WHEN an authenticated GET /contractors/{id}/workers Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the assigned worker list
6. WHEN an authenticated POST /contractors/{id}/workers Mock_Event is sent with a valid worker ID, THE E2E_Test SHALL verify a 201 response confirming the assignment
7. WHEN an authenticated DELETE /contractors/{id}/workers/{workerId} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response confirming removal
8. WHEN an authenticated GET /contractors/{id}/compliance Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the compliance summary
9. WHEN a Mock_Event with worker role is sent to POST /contractors, THE E2E_Test SHALL verify a 403 response

### Requirement 12: Sync Service E2E Tests

**User Story:** As a developer, I want E2E tests for all /sync endpoints, so that offline synchronization workflows are verified.

#### Acceptance Criteria

1. WHEN an authenticated POST /sync/sessions Mock_Event is sent, THE E2E_Test SHALL verify a 201 response with the created sync session ID and initial status
2. WHEN an authenticated POST /sync/media Mock_Event is sent with media metadata, THE E2E_Test SHALL verify a 200 response with a presigned upload URL
3. WHEN an authenticated GET /sync/status Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the current sync status and pending item count
4. WHEN a Mock_Event without auth is sent to POST /sync/sessions, THE E2E_Test SHALL verify a 401 response

### Requirement 13: Reporting Service E2E Tests

**User Story:** As a developer, I want E2E tests for all /reports endpoints and worker compliance summary, so that report generation and export are verified.

#### Acceptance Criteria

1. WHEN an authenticated POST /reports Mock_Event is sent with report parameters, THE E2E_Test SHALL verify a 201 response with the report ID and initial status
2. WHEN an authenticated GET /reports/{id} Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the report metadata and status
3. WHEN an authenticated GET /reports/{id}/export Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the export download URL or content
4. WHEN an authenticated GET /workers/{id}/compliance-summary Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the worker's compliance metrics
5. WHEN a Mock_Event with worker role is sent to POST /reports, THE E2E_Test SHALL verify a 403 response

### Requirement 14: Document Service Unit Tests

**User Story:** As a developer, I want unit tests for all document service modules (folder-handler, search-handler, metadata-handler, preview-handler, download-handler, integrity-handler, preferences-handler, audit-handler), so that each handler is verified independently.

#### Acceptance Criteria

1. WHEN a unit test is executed for the folder-handler module, THE Unit_Test SHALL validate that folder navigation returns the correct hierarchy for the given path and tenant
2. WHEN a unit test is executed for the search-handler module, THE Unit_Test SHALL validate that search queries return filtered results matching the query terms
3. WHEN a unit test is executed for the metadata-handler module, THE Unit_Test SHALL validate that document metadata is returned with all required fields (id, name, type, size, created_at, updated_at)
4. WHEN a unit test is executed for the preview-handler module, THE Unit_Test SHALL validate that a presigned S3 URL is generated with the correct key and expiry
5. WHEN a unit test is executed for the download-handler module, THE Unit_Test SHALL validate that a download session is created and tracked with the correct status
6. WHEN a unit test is executed for the integrity-handler module, THE Unit_Test SHALL validate that checksum verification returns the integrity status (valid or corrupted)
7. WHEN a unit test is executed for the preferences-handler module, THE Unit_Test SHALL validate that organization-mode preferences are stored and retrieved per user
8. WHEN a unit test is executed for the audit-handler module, THE Unit_Test SHALL validate that audit events are persisted with actor, action, document_id, and timestamp

### Requirement 15: Document Service E2E Tests

**User Story:** As a developer, I want E2E tests for all /documents endpoints, so that routing, role-based access, and response shapes are verified end-to-end.

#### Acceptance Criteria

1. WHEN an authenticated GET /documents/folders Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with folder hierarchy data
2. WHEN an authenticated GET /documents/search Mock_Event is sent with query parameters, THE E2E_Test SHALL verify a 200 response with search results array
3. WHEN an authenticated GET /documents/{id}/metadata Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with document metadata
4. WHEN an authenticated GET /documents/{id}/preview Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with a presigned preview URL
5. WHEN an authenticated POST /documents/download Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the download session ID
6. WHEN an authenticated GET /documents/download/{downloadId}/status Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with download progress status
7. WHEN an authenticated POST /documents/{id}/verify-integrity Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the integrity verification result
8. WHEN an authenticated GET /documents/preferences/organization-mode Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the user preference
9. WHEN an authenticated PUT /documents/preferences/organization-mode Mock_Event is sent, THE E2E_Test SHALL verify a 200 response confirming the preference update
10. WHEN an authenticated POST /documents/audit-log Mock_Event is sent, THE E2E_Test SHALL verify a 201 response confirming the audit entry creation
11. WHEN a Mock_Event with gate_operator role is sent to any /documents endpoint, THE E2E_Test SHALL verify a 403 response
12. WHEN a Mock_Event with worker role is sent to any /documents endpoint, THE E2E_Test SHALL verify a 403 response

### Requirement 16: Certifications Aggregate Endpoints E2E Tests

**User Story:** As a developer, I want E2E tests for the /certifications aggregate endpoints, so that stats, catalog, and expiring logic are verified.

#### Acceptance Criteria

1. WHEN an authenticated GET /certifications/stats Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with certification statistics (total, valid, expired, expiring_soon)
2. WHEN an authenticated GET /certifications/catalog Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with the certification type catalog array
3. WHEN an authenticated GET /certifications/expiring Mock_Event is sent, THE E2E_Test SHALL verify a 200 response with certifications expiring within the configured threshold
4. WHEN a Mock_Event without auth is sent to GET /certifications/stats, THE E2E_Test SHALL verify a 401 response

### Requirement 17: Cross-Cutting — Validation Error Tests

**User Story:** As a developer, I want tests verifying that all endpoints return consistent 400 responses for invalid input, so that validation contracts are enforced.

#### Acceptance Criteria

1. WHEN a Mock_Event with an empty body is sent to any POST endpoint requiring a body, THE E2E_Test SHALL verify a 400 response with an error message indicating the body is required
2. WHEN a Mock_Event with a body missing required fields is sent to a creation endpoint, THE E2E_Test SHALL verify a 400 response with field-level validation errors
3. WHEN a Mock_Event with invalid field types is sent (string where number expected), THE E2E_Test SHALL verify a 400 response with a type-mismatch error
4. WHEN a Mock_Event targets a non-existent resource ID, THE E2E_Test SHALL verify a 404 response with an appropriate error message

### Requirement 18: Cross-Cutting — Tenant Isolation Tests

**User Story:** As a developer, I want tests verifying that requests scoped to one tenant cannot access another tenant's data, so that data isolation is guaranteed.

#### Acceptance Criteria

1. WHEN a Mock_Event authenticated as tenant-A requests a resource belonging to tenant-B, THE E2E_Test SHALL verify a 404 response (resource not visible to the requesting tenant)
2. WHEN a Mock_Event authenticated as tenant-A creates a resource, THE E2E_Test SHALL verify the stored record contains tenant-A's tenant_id
3. WHEN a Mock_Event authenticated as tenant-A lists resources, THE E2E_Test SHALL verify that only resources belonging to tenant-A are returned

### Requirement 19: Cross-Cutting — Unsupported Route Handling

**User Story:** As a developer, I want tests verifying that handlers return a consistent error for unrecognized routes, so that route coverage gaps are detectable.

#### Acceptance Criteria

1. WHEN a Mock_Event with an unsupported HTTP method is sent to a known path, THE E2E_Test SHALL verify a 400 response with message "Unsupported route"
2. WHEN a Mock_Event targeting a path not defined in the handler is sent, THE E2E_Test SHALL verify a 400 response with message "Unsupported route"

### Requirement 20: Test Infrastructure — Mock Factories and Fixtures

**User Story:** As a developer, I want shared mock factories for API Gateway events, authenticated users, and DynamoDB responses, so that tests are concise and maintainable.

#### Acceptance Criteria

1. THE Test_Harness SHALL provide a factory function that generates valid Mock_Event objects with configurable httpMethod, resource, path, pathParameters, queryStringParameters, body, and headers
2. THE Test_Harness SHALL provide a factory function that generates authenticated user claim objects with configurable role, tenant_id, user_id, and assigned_sites
3. THE Test_Harness SHALL provide mock implementations for DynamoDB DocumentClient commands (Get, Put, Query, Update, Delete) that record invocations and return configurable responses
4. THE Test_Harness SHALL provide mock implementations for S3 client operations (GetObject, PutObject, getSignedUrl) that return configurable presigned URLs
5. THE Test_Harness SHALL provide a mock implementation for the auth-middleware that can be toggled between success (returning a user) and failure (returning 401)

### Requirement 21: Test Infrastructure — Property-Based Tests

**User Story:** As a developer, I want property-based tests using fast-check for validation and routing logic, so that edge cases are discovered through generative testing.

#### Acceptance Criteria

1. WHEN property-based tests generate arbitrary request bodies with random field types, THE Test_Harness SHALL verify that all handlers either accept valid input or reject invalid input without throwing unhandled exceptions
2. WHEN property-based tests generate arbitrary path parameters, THE Test_Harness SHALL verify that handlers do not crash and return a well-formed API Gateway response object
3. WHEN property-based tests generate arbitrary role values, THE Test_Harness SHALL verify that only defined roles (platform_admin, tenant_admin, site_admin, supervisor, cso, gate_operator, worker) pass RBAC checks
