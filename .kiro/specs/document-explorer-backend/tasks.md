# Implementation Plan: Document Explorer Backend

## Overview

Implement the Document Explorer Backend Lambda service that aggregates documents from five existing DynamoDB tables into a virtual folder structure. The service exposes REST endpoints under `/documents/*` for folder navigation, search, metadata, preview, batch ZIP download, integrity verification, user preferences, and audit logging. Implementation uses TypeScript with esbuild bundling, vitest for tests, and fast-check for property-based tests.

## Tasks

- [x] 1. Define types, schemas, and core utilities
  - [x] 1.1 Create TypeScript types and interfaces (`packages/backend/src/services/documents/types.ts`)
    - Define `DocumentCategory`, `OrganizationMode`, `IntegrityStatus`, `DownloadStatus`, `AuditEventType` type literals
    - Define `UnifiedDocument`, `FolderNode`, `DocumentDetail`, `SourceTableConfig` interfaces
    - Define all request/response interfaces: `FolderContentsResponse`, `SearchResponse`, `DownloadInitResponse`, `BatchDownloadStatusResponse`, `IntegrityVerificationResponse`, `AuditLogEntry`
    - _Requirements: 11.3, 3.7, 4.6, 7.1, 7.2, 7.6, 8.1, 10.1_

  - [x] 1.2 Create Zod validation schemas (`packages/backend/src/services/documents/schemas.ts`)
    - Define `documentCategorySchema`, `organizationModeSchema`, `auditEventTypeSchema` enums
    - Define `folderRequestSchema` with path, org_mode, page, page_size
    - Define `searchRequestSchema` with q (min 2 trimmed), category, date_from, date_to, site_id, page, page_size
    - Define `downloadRequestSchema` with documentIds array (1-50 UUIDs)
    - Define `setPreferencesSchema` with mode
    - Define `auditLogRequestSchema` with eventType, documentIds, userId
    - _Requirements: 3.3, 3.6, 4.2, 4.5, 7.3, 9.3, 10.3, 12.4_

  - [x] 1.3 Create pagination utility (`packages/backend/src/services/documents/pagination.ts`)
    - Implement `paginate<T>` function: accepts items array, page, pageSize; returns sliced data with total, page, pageSize, totalPages
    - Clamp page to valid range, compute totalPages as `ceil(N / pageSize)`
    - _Requirements: 3.6, 4.5_

  - [x] 1.4 Write property tests for validation schemas
    - **Property 6: Search minimum length validation**
    - **Property 9: Download batch validation (count bounds)**
    - **Property 13: Audit log event validation**
    - **Validates: Requirements 4.2, 7.3, 10.3, 10.4**

  - [x] 1.5 Write property test for pagination
    - **Property 4: Pagination slice correctness**
    - **Validates: Requirements 3.6, 4.5**

- [x] 2. Implement folder path computation and aggregator
  - [x] 2.1 Create folder path computation (`packages/backend/src/services/documents/folder-path.ts`)
    - Implement `computeFolderPath(doc, mode)`: pure function returning path segments based on organization mode
    - Implement `getItemsAtPath(documents, targetPath)`: extract sub-folders and documents at a given path level
    - Compute `childFolderCount`, `documentCount`, `lastUpdated` for each folder node
    - _Requirements: 3.1, 3.4, 3.5, 11.5_

  - [x] 2.2 Create document aggregator (`packages/backend/src/services/documents/aggregator.ts`)
    - Define `SOURCE_TABLES` config array with table names, categories, and field mappings for all 5 source tables
    - Implement `aggregateDocuments(user, options?)`: queries all source tables in parallel with `Promise.allSettled`
    - Apply tenant isolation via PK conditions in each query
    - Apply site-level filtering for `site_admin`/`supervisor` roles using `assigned_sites`
    - Normalize raw records to `UnifiedDocument` using field mappings
    - Return `{ documents, unavailableSources }` — graceful degradation on source failures
    - Implement `withRetry` wrapper for DynamoDB throttling/timeout with exponential backoff (1 retry, 200ms base)
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 11.1, 11.2, 11.3, 11.4, 12.2_

  - [x] 2.3 Write property tests for folder path computation
    - **Property 3: Folder path computation**
    - **Property 17: Dynamic folder count computation**
    - **Validates: Requirements 3.4, 3.5, 11.5**

  - [x] 2.4 Write property tests for aggregator scoping and degradation
    - **Property 2: Role-based document scoping**
    - **Property 15: Source document normalization**
    - **Property 16: Graceful source degradation**
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.7, 11.2, 11.3, 11.4**

- [x] 3. Checkpoint - Core logic verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement route handlers
  - [x] 4.1 Create folder navigation handler (`packages/backend/src/services/documents/folder-handler.ts`)
    - Implement `handleFolders(event, user)`: parse query params via `folderRequestSchema`, call aggregator, compute folder paths, paginate documents at path level
    - Return `FolderContentsResponse` with currentPath, folders, documents, pagination metadata, unavailableSources
    - Handle empty/absent path as root level (5 category folders)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 4.2 Create search handler (`packages/backend/src/services/documents/search-handler.ts`)
    - Implement `handleSearch(event, user)`: validate with `searchRequestSchema`, aggregate documents, apply case-insensitive partial name matching on `q`
    - Apply conjunctive filters: category, date_from, date_to, site_id
    - Paginate and return `SearchResponse` with matchFolderPath per result
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 4.3 Create metadata handler (`packages/backend/src/services/documents/metadata-handler.ts`)
    - Implement `handleMetadata(id, user)`: query document from source table by ID, verify tenant/site access
    - Return full `DocumentDetail` including creation timestamp, creator info, file size, SHA-256 hash, download count, integrity status
    - Return null fields with integrity `unavailable` when data cannot be retrieved
    - Return 404 if not found or inaccessible
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 4.4 Create preview handler (`packages/backend/src/services/documents/preview-handler.ts`)
    - Implement `handlePreview(id, user)`: verify document exists and is accessible, check MIME type eligibility (pdf, jpeg, png only)
    - Generate presigned S3 URL with 15-minute expiry
    - Return 400 for non-previewable MIME types, 404 if not found
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 4.5 Create download handler (`packages/backend/src/services/documents/download-handler.ts`)
    - Implement `handleDownload(event, user)`: validate with `downloadRequestSchema`, check total size ≤ 500MB
    - Single doc: generate presigned URL directly (60min expiry)
    - Batch (2-50): stream files from S3 to `/tmp`, create ZIP with archiver, upload ZIP to S3, generate presigned URL
    - Handle partial failures: include accessible docs, record skipped docs with reasons
    - Abort ZIP creation if exceeds 120s timeout
    - Implement `handleDownloadStatus(downloadId, user)`: return status (preparing/ready/failed/expired) with progress
    - Implement `validateBatchSize(fileSizes)`: pure validation of total size
    - Auto-create audit log entry on download initiation
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 10.5_

  - [x] 4.6 Create integrity verification handler (`packages/backend/src/services/documents/integrity-handler.ts`)
    - Implement `handleVerifyIntegrity(id, user)`: download file from S3, compute SHA-256, compare against stored hash
    - Return `IntegrityVerificationResponse` with storedHash, computedHash, match, verifiedAt
    - Persist verification result for future metadata queries
    - Return 503 if S3 retrieval fails
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 4.7 Create preferences handler (`packages/backend/src/services/documents/preferences-handler.ts`)
    - Implement `handleGetPreferences(user)`: query UserPreferences table (PK: `USER#{user_id}`, SK: `PREF#document_explorer`), default to `category_site_year_month`
    - Implement `handleSetPreferences(event, user)`: validate with `setPreferencesSchema`, persist preference, return saved mode
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 4.8 Create audit log handler (`packages/backend/src/services/documents/audit-handler.ts`)
    - Implement `handleAuditLog(event, user)`: validate with `auditLogRequestSchema`, store entry in AuditTrail table
    - Compute TTL as creation timestamp + 365 days (epoch seconds)
    - Use PK: `TENANT#{tenant_id}#AUDIT`, SK: `{timestamp}#{uuid}`
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 4.9 Write property tests for search and preview
    - **Property 5: Case-insensitive partial name matching**
    - **Property 7: Conjunctive filter application**
    - **Property 8: Preview eligibility by MIME type**
    - **Validates: Requirements 4.1, 4.4, 6.3**

  - [x] 4.10 Write property tests for download and integrity
    - **Property 10: Batch partial failure — accessible documents included**
    - **Property 11: SHA-256 integrity verification correctness**
    - **Validates: Requirements 7.5, 8.1**

  - [x] 4.11 Write property tests for preferences and audit
    - **Property 12: Organization mode preference round trip**
    - **Property 14: Audit log TTL minimum retention**
    - **Validates: Requirements 9.2, 10.2**

- [x] 5. Implement Lambda entry point and error handling
  - [x] 5.1 Create Lambda handler entry point (`packages/backend/src/services/documents/handler.ts`)
    - Import and use shared `authenticateRequest`, `createLogger`, `createSuccessResponse`, error helpers
    - Define `ALLOWED_ROLES` set (platform_admin, tenant_admin, site_admin, supervisor, cso)
    - Export `handler` function with route matching (method + resource pattern)
    - Handle OPTIONS preflight with CORS headers
    - Return 401 for invalid JWT, 403 for disallowed roles
    - Catch-all error handler with structured logging (correlation_id, tenant_id, stack trace)
    - _Requirements: 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 12.1_

  - [x] 5.2 Write property tests for access control and error structure
    - **Property 1: Role-based access control**
    - **Property 18: Error response structure consistency**
    - **Validates: Requirements 2.2, 2.3, 1.4, 12.1**

- [x] 6. Checkpoint - All handlers implemented and tested
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. CDK infrastructure and wiring
  - [x] 7.1 Add Document Explorer Lambda to CDK stack (`packages/backend/infra/lib/api-stack.ts`)
    - Create Lambda function: Node.js 20 runtime, ARM64, 512MB memory, 130s timeout
    - Set `handler: 'handler.handler'`, code from `dist/services/documents`
    - Add `DOCUMENTS_BUCKET_NAME` environment variable
    - Grant read access to all 5 source DynamoDB tables (Reports, Forms, Certifications, Incidents, SafetyEvidence)
    - Grant read/write to UserPreferences and AuditTrail tables
    - Grant S3 read + put on media bucket
    - _Requirements: 1.1, 1.2, 12.5_

  - [x] 7.2 Add API Gateway routes for Document Explorer (`packages/backend/infra/lib/api-stack.ts`)
    - Create `/documents` resource with sub-resources: folders, search, download, download/{downloadId}/status, preferences/organization-mode, audit-log, {id}/metadata, {id}/preview, {id}/verify-integrity
    - Wire all routes to Document Explorer Lambda integration with authorized method options
    - Add GET, POST, PUT methods per the design
    - _Requirements: 1.2, 1.3_

- [x] 8. Integration tests and final verification
  - [x] 8.1 Write unit tests for handler route matching and auth (`packages/backend/src/services/documents/__tests__/handler.test.ts`)
    - Test correct handler dispatch for each method+resource combination
    - Test OPTIONS returns 200 with CORS headers
    - Test 401 for missing token, 403 for gate_operator/worker roles
    - _Requirements: 1.3, 2.1, 2.2, 2.3_

  - [x] 8.2 Write unit tests for aggregator (`packages/backend/src/services/documents/__tests__/aggregator.test.ts`)
    - Test parallel query with mocked DynamoDB
    - Test field normalization from each source table
    - Test graceful degradation when 1-2 sources fail
    - Test retry on throttling exception
    - _Requirements: 11.1, 11.3, 11.4, 12.2_

  - [x] 8.3 Write unit tests for folder handler (`packages/backend/src/services/documents/__tests__/folder-handler.test.ts`)
    - Test root path returns 5 category folders
    - Test nested navigation with both org modes
    - Test pagination of documents within a folder
    - Test empty folders return 200 with empty arrays
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.8_

  - [x] 8.4 Write unit tests for download handler (`packages/backend/src/services/documents/__tests__/download-handler.test.ts`)
    - Test single document presigned URL generation
    - Test batch validation: empty array, >50 items, >500MB total
    - Test partial failure with skipped documents
    - Test download status responses
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 9. Final checkpoint - Full build and test verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All source files go in `packages/backend/src/services/documents/`
- CDK changes go in `packages/backend/infra/lib/api-stack.ts`
- The Lambda entry point exports `handler` function (esbuild bundles from `src/services/*/handler.ts` to `dist/services/*/handler.js`)
- Tests use vitest and fast-check (both already in devDependencies)
- The Lambda requires 512MB memory and 130s timeout for ZIP operations
- No new DynamoDB tables are created — all queries target existing tables

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "1.5", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.6", "4.7", "4.8"] },
    { "id": 4, "tasks": ["4.5", "4.9", "4.10", "4.11"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.2", "7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.3", "8.4"] }
  ]
}
```
