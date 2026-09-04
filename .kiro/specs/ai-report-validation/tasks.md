# Implementation Plan: AI Report Validation

## Overview

Implement the AI-powered report validation module for ClearSite, enabling construction report upload (Word/PDF), AI compliance validation against BC construction laws via a RAG pipeline (Bedrock Knowledge Bases + Claude 3.5 Haiku), structured feedback display, iterative improvement cycles, and report submission. The implementation spans a new backend Lambda service (`report-validation-service`) and a frontend feature module (`src/features/report-validation/`).

## Tasks

- [x] 1. Set up backend service structure and core types
  - [x] 1.1 Create report-validation service directory and types module
    - Create `packages/backend/src/services/report-validation/` directory
    - Create `types.ts` with all TypeScript interfaces (ReportRecord, ReportVersionRecord, ValidationResultRecord, KBContextDocumentRecord, ComplianceFinding, RegulationReference, StatusTransition)
    - Define ReportStatus, FindingSeverity, KBDocumentCategory, KBSyncStatus type unions
    - Define Zod validation schemas for API request/response payloads
    - Implement `VALID_TRANSITIONS` map and `isValidTransition(from, to)` function
    - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3_

  - [x] 1.2 Create utility functions module
    - Create `packages/backend/src/services/report-validation/utils.ts`
    - Implement `getAvailableActions(status)` returning action arrays per status
    - Implement `getEstimatedTimeSeconds(pageCount)` for validation time estimation
    - Implement `getScoreColor(score)` for color classification (green/yellow/red)
    - Implement `groupFindingsBySeverity(findings)` for ordered severity grouping
    - Implement `getReportVisibilityScope(role)` for RBAC visibility
    - Implement `buildKBDocumentS3Key(category, id, name)` for S3 key construction
    - Implement `isTextSufficient(text)` for minimum 50-character threshold check
    - _Requirements: 2.4, 3.1, 4.5, 5.1, 5.2, 8.5, 8.6, 10.3, 13.4_

  - [x] 1.3 Add RBAC permissions for report validation
    - Add `reports:upload` and `kb:manage` permissions to `src/shared/rbac.ts`
    - Assign `reports:upload` to tenant_admin, site_admin, supervisor, cso roles
    - Assign `kb:manage` to tenant_admin only
    - Implement `canUploadReports(role)` and `canManageKB(role)` helper functions
    - Implement `isReportOwner(userId, reportOwnerId)` submission authorization check
    - _Requirements: 11.1, 11.2, 11.3, 13.6_

  - [x] 1.4 Write property tests for status transitions and available actions
    - **Property 3: Status transition validity**
    - **Property 4: Available actions determined by status**
    - **Validates: Requirements 2.2, 2.3, 2.4, 3.1, 6.1, 7.1, 7.3, 8.3**
    - Test file: `packages/backend/tests/properties/report-validation/status-machine.property.test.ts`

  - [x] 1.5 Write property tests for utility functions
    - **Property 5: Minimum text extraction threshold**
    - **Property 8: Score color classification**
    - **Property 14: Estimated validation time by page count**
    - **Validates: Requirements 3.7, 5.1, 9.3, 10.3**
    - Test file: `packages/backend/tests/properties/report-validation/text-extraction.property.test.ts` and `packages/backend/tests/properties/report-validation/validation-progress.property.test.ts`

  - [x] 1.6 Write property tests for RBAC functions
    - **Property 13: Role-based report visibility scope**
    - **Property 15: Upload permission by role**
    - **Property 16: Submission restricted to report owner**
    - **Validates: Requirements 8.5, 8.6, 11.1, 11.2, 11.3**
    - Test file: `packages/backend/tests/properties/report-validation/rbac.property.test.ts`

- [x] 2. Implement score calculator and findings display logic
  - [x] 2.1 Implement score calculator module
    - Create `packages/backend/src/services/report-validation/score-calculator.ts`
    - Implement `calculateComplianceScore(findings)` with severity-weighted deductions (critical: 15, major: 8, minor: 3, informational: 0)
    - Ensure score is clamped to [0, 100] range
    - Handle empty findings array (return 100)
    - _Requirements: 4.5, 4.6_

  - [x] 2.2 Write property tests for score calculator
    - **Property 6: Compliance score calculation**
    - **Validates: Requirements 4.5, 4.6**
    - Test file: `packages/backend/tests/properties/report-validation/score-calculator.property.test.ts`

  - [x] 2.3 Implement findings display utilities
    - Implement `groupFindingsBySeverity(findings)` in utils module
    - Ensure ordering: critical → major → minor → informational
    - Ensure total count preservation across groups
    - Filter out empty groups from output
    - _Requirements: 5.2, 5.4_

  - [x] 2.4 Write property tests for findings display
    - **Property 9: Findings grouped by severity order**
    - **Validates: Requirements 5.2, 5.4**
    - Test file: `packages/backend/tests/properties/report-validation/findings-display.property.test.ts`

- [x] 3. Checkpoint - Ensure all core types and utility tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement upload manager and version management
  - [x] 4.1 Implement upload manager module
    - Create `packages/backend/src/services/report-validation/upload-manager.ts`
    - Implement presigned URL generation for S3 PUT (same pattern as certifications)
    - Implement report record creation in DynamoDB (status: draft, version: 1)
    - Implement file metadata extraction and storage (file name, size, MIME type, page count)
    - Implement S3 key construction: `{tenant_id}/{report_id}/v{version}/{filename}`
    - Validate file size (1 KB – 25 MB) and MIME type before generating presigned URL
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 4.2 Implement version management logic
    - Implement new version upload (increment version number, preserve previous version)
    - Implement version history retrieval (reverse chronological order)
    - Ensure version numbers are sequential starting from 1 with no gaps
    - Implement atomicity: only create version record after successful S3 PUT confirmation
    - Handle upload failure: retain current status and version unchanged
    - _Requirements: 6.1, 6.2, 6.3, 6.7, 6.8_

  - [x] 4.3 Write property tests for file validation
    - **Property 1: Report file type validation**
    - **Property 2: Report file size validation**
    - **Validates: Requirements 1.1, 1.2, 1.5, 9.7**
    - Test file: `packages/backend/tests/properties/report-validation/file-validation.property.test.ts`

  - [x] 4.4 Write property tests for version management
    - **Property 10: Version numbering is sequential**
    - **Property 11: Version history reverse chronological order**
    - **Validates: Requirements 6.2, 6.5**
    - Test file: `packages/backend/tests/properties/report-validation/version-management.property.test.ts`

  - [x] 4.5 Write unit tests for upload manager
    - Test valid upload returns report_id + presigned URL
    - Test invalid MIME type returns 400
    - Test oversized/undersized file returns 400
    - Test S3 failure does not persist partial data
    - Test file: `packages/backend/tests/unit/report-validation/upload-manager.test.ts`
    - _Requirements: 1.1, 1.2, 1.5, 1.6_

- [x] 5. Implement text extractor
  - [x] 5.1 Implement text extractor module
    - Create `packages/backend/src/services/report-validation/text-extractor.ts`
    - Implement BDA invocation for PDF documents (Bedrock Data Automation API call)
    - Implement XML parsing for .docx documents (lightweight server-side parser)
    - Return `TextExtractionResult` with text, page_count, extraction_method, character_count
    - Implement minimum text threshold check (50 characters)
    - Handle extraction failures: password-protected, corrupted, or unparseable documents
    - Handle document size limits (200 pages / 50 MB rejection)
    - Store extracted text in S3 at `{tenant_id}/{report_id}/v{version}/extracted-text.txt`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 3.3, 3.5, 3.7_

  - [x] 5.2 Write unit tests for text extractor
    - Test PDF extraction via BDA mock
    - Test .docx XML parsing
    - Test password-protected PDF returns specific error
    - Test empty/insufficient text returns error
    - Test document exceeding 200 pages is rejected
    - Test file: `packages/backend/tests/unit/report-validation/text-extractor.test.ts`
    - _Requirements: 9.1, 9.2, 9.5, 9.6_

- [x] 6. Implement validation engine
  - [x] 6.1 Implement validation engine module
    - Create `packages/backend/src/services/report-validation/validation-engine.ts`
    - Implement RAG pipeline orchestration: receive extracted text → query Knowledge Base via RetrieveAndGenerate → parse Claude 3.5 Haiku response
    - Construct compliance analysis prompt with extracted report text
    - Parse LLM response into structured ComplianceFinding array (max 50 findings)
    - Integrate score calculator for deterministic score computation
    - Generate validation summary (max 2000 characters)
    - Implement 5-minute timeout with status revert to "draft"
    - Handle RAG pipeline failures with status revert and error recording
    - Store ValidationResultRecord in DynamoDB on completion
    - Update report status to "validated" on success
    - _Requirements: 3.2, 3.4, 3.5, 3.6, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 6.2 Write property test for validation result structure
    - **Property 7: Validation result structure completeness**
    - **Validates: Requirements 4.1, 4.3**
    - Test file: `packages/backend/tests/properties/report-validation/validation-result.property.test.ts`

  - [x] 6.3 Write unit tests for validation engine
    - Test successful validation produces complete result
    - Test empty findings returns score 100
    - Test max 50 findings enforcement
    - Test timeout handling reverts status to draft
    - Test RAG failure reverts status to draft
    - Test file: `packages/backend/tests/unit/report-validation/validation-engine.test.ts`
    - _Requirements: 3.4, 3.5, 3.6, 3.8, 4.1, 4.6_

- [x] 7. Implement Knowledge Base manager
  - [x] 7.1 Implement KB manager module
    - Create `packages/backend/src/services/report-validation/kb-manager.ts`
    - Implement context document upload with presigned URL generation
    - Implement S3 key construction by category prefix (worksafebc/, bc-building-code/, safety-standards/, canada-general/)
    - Implement document metadata storage in DynamoDB (kb-context-documents table)
    - Implement Knowledge Base sync trigger on upload (Bedrock StartIngestionJob API)
    - Implement document deletion with S3 removal + metadata removal + re-sync trigger
    - Implement document listing with sync status (pending, indexed, error)
    - Validate file type (PDF, .docx only) and size (max 50 MB)
    - Handle sync failures by setting sync_status to "error"
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10_

  - [x] 7.2 Write property tests for KB document validation
    - **Property 17: KB document validation**
    - **Property 18: KB document S3 key prefix by category**
    - **Validates: Requirements 13.2, 13.4**
    - Test file: `packages/backend/tests/properties/report-validation/kb-validation.property.test.ts`

  - [x] 7.3 Write unit tests for KB manager
    - Test only tenant_admin can access KB management
    - Test upload triggers sync
    - Test delete triggers re-sync
    - Test invalid file type rejected
    - Test file exceeding 50 MB rejected
    - Test file: `packages/backend/tests/unit/report-validation/kb-manager.test.ts`
    - _Requirements: 13.2, 13.5, 13.6, 13.8, 13.10_

- [x] 8. Checkpoint - Ensure all backend service modules and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement API route handler
  - [x] 9.1 Implement route handler with all endpoints
    - Create `packages/backend/src/services/report-validation/handler.ts`
    - Implement POST `/report-validation/reports` — create report + presigned URL
    - Implement GET `/report-validation/reports` — list reports (paginated, filtered by status, sorted)
    - Implement GET `/report-validation/reports/{id}` — get report detail with latest validation
    - Implement POST `/report-validation/reports/{id}/validate` — initiate AI validation
    - Implement POST `/report-validation/reports/{id}/versions` — upload new version
    - Implement POST `/report-validation/reports/{id}/submit` — submit report
    - Implement GET `/report-validation/reports/{id}/history` — version + validation history
    - Implement POST `/report-validation/kb/documents` — upload KB context document
    - Implement GET `/report-validation/kb/documents` — list KB context documents
    - Implement DELETE `/report-validation/kb/documents/{id}` — delete KB context document
    - Wire Cognito auth middleware and RBAC permission checks
    - Implement report visibility scoping (own/site/tenant based on role)
    - Implement status transition validation with 409 error on invalid transitions
    - Implement pagination (max 20 per page) for report list
    - _Requirements: 1.1–1.7, 2.1–2.5, 3.1–3.8, 7.1–7.8, 8.1–8.7, 11.1–11.5, 13.1–13.10_

  - [x] 9.2 Write unit tests for route handler
    - Test each endpoint returns correct HTTP codes for success and error cases
    - Test RBAC enforcement (403 for insufficient permissions, 401 for unauthenticated)
    - Test invalid status transitions return 409
    - Test pagination and filtering
    - Test report visibility scoping per role
    - Test file: `packages/backend/tests/unit/report-validation/handler.test.ts`
    - _Requirements: 2.3, 8.1, 8.2, 11.1, 11.4, 11.5_

  - [x] 9.3 Write property test for report list filtering
    - **Property 12: Report list filtering by status**
    - **Validates: Requirements 8.2**
    - Test file: `packages/backend/tests/properties/report-validation/report-list.property.test.ts`

- [x] 10. Implement backend integration tests
  - [x] 10.1 Write integration tests for upload and validation flows
    - Test full upload flow: POST metadata → presigned URL → PUT to S3 → verify DynamoDB record
    - Test full validation flow: request → BDA extraction → RAG query → result stored → status updated
    - Test version cycle: upload v1 → validate → upload v2 → validate → verify both preserved
    - Test submission flow: validate → submit → verify terminal state
    - Test timeout handling: simulate slow validation → verify 5-min timeout → status reverts
    - Test file: `packages/backend/tests/integration/report-validation/`
    - _Requirements: 1.3, 1.6, 3.2, 3.8, 6.2, 6.3, 7.2_

  - [x] 10.2 Write integration tests for KB lifecycle and RBAC
    - Test KB document lifecycle: upload → verify sync triggered → delete → verify re-sync
    - Test RBAC enforcement: verify each role gets correct access level across all endpoints
    - Test file: `packages/backend/tests/integration/report-validation/`
    - _Requirements: 11.1, 11.2, 13.5, 13.10_

- [x] 11. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement frontend types, schemas, and hooks
  - [x] 12.1 Create frontend types and validation schemas
    - Create `packages/admin-portal/src/features/report-validation/types.ts`
    - Define all frontend TypeScript interfaces (Report, ReportVersion, ValidationResult, ComplianceFinding, RegulationReference, KBContextDocument)
    - Define type unions (ReportStatus, FindingSeverity, KBDocumentCategory, KBSyncStatus)
    - Create `packages/admin-portal/src/features/report-validation/schemas.ts`
    - Implement `reportUploadSchema` with Zod (MIME type, size 1KB–25MB validation)
    - Implement `kbDocumentUploadSchema` with Zod (MIME type, size ≤50MB, category)
    - _Requirements: 1.1, 1.2, 1.5, 13.2_

  - [x] 12.2 Create frontend utility functions
    - Create `packages/admin-portal/src/features/report-validation/utils.ts`
    - Implement `getAvailableActions(status)` for UI action rendering
    - Implement `getScoreColor(score)` for ComplianceScoreBadge
    - Implement `getEstimatedTimeSeconds(pageCount)` for ValidationProgress
    - Implement `groupFindingsBySeverity(findings)` for ValidationResultsPanel
    - _Requirements: 2.4, 5.1, 5.2, 10.3_

  - [x] 12.3 Create API hooks
    - Create `packages/admin-portal/src/features/report-validation/hooks/` directory
    - Implement `useReports` hook — fetches paginated report list with status filter and sort
    - Implement `useReport` hook — fetches single report detail with latest validation
    - Implement `useCreateReport` hook — POST report metadata + triggers S3 presigned URL upload
    - Implement `useValidateReport` hook — POST validation request + starts polling
    - Implement `useSubmitReport` hook — POST report submission
    - Implement `useUploadVersion` hook — POST new version + triggers S3 upload
    - Implement `useReportHistory` hook — GET version/validation history
    - Implement `useValidationPolling` hook — polls report status while "validating" (3s interval)
    - Implement `useKBDocuments` hook — CRUD for Knowledge Base context documents
    - Implement `useDisclaimerAck` hook — session-level disclaimer acknowledgment state
    - _Requirements: 3.1, 6.5, 8.1, 8.2, 10.6, 12.2, 13.7_

- [x] 13. Implement frontend components - Report list and upload
  - [x] 13.1 Implement ReportListPage component
    - Create `packages/admin-portal/src/features/report-validation/ReportListPage.tsx`
    - Display paginated report list (max 20 per page) with columns: title, status, score, upload date, validation date, version count
    - Implement status filter dropdown (draft, validating, validated, submitted)
    - Implement sort by upload date or last validation date (asc/desc)
    - Show animated indicator on cards with "validating" status
    - Show empty state when no reports exist with guidance to upload
    - Display reports scoped by user role (own/site/tenant)
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 8.7, 10.2_

  - [x] 13.2 Implement ReportUploadForm modal component
    - Create `packages/admin-portal/src/features/report-validation/ReportUploadForm.tsx`
    - Implement file input accepting PDF, .docx, .doc formats
    - Validate file size (1 KB – 25 MB) and MIME type client-side using Zod schema
    - Display validation errors for unsupported format or invalid size
    - On submit: call useCreateReport hook, upload file to presigned URL, show progress
    - Handle upload failure: show error toast, keep modal open with file attached, allow retry
    - Support both initial upload and new version upload modes
    - _Requirements: 1.1, 1.2, 1.5, 1.7, 6.1_

  - [x] 13.3 Implement ComplianceScoreBadge component
    - Create `packages/admin-portal/src/features/report-validation/ComplianceScoreBadge.tsx`
    - Display numeric score (0-100) with color-coded indicator: green (80-100), yellow (50-79), red (0-49)
    - Handle undefined score (not yet validated) gracefully
    - _Requirements: 5.1, 5.5_

- [x] 14. Implement frontend components - Report detail and validation
  - [x] 14.1 Implement ReportDetailPage component
    - Create `packages/admin-portal/src/features/report-validation/ReportDetailPage.tsx`
    - Display current document info, validation results (if available), and version history
    - Show available actions based on current status: "Request Validation" + "Submit" for draft, nothing for validating, "Upload New Version" + "Submit" for validated, nothing for submitted
    - Integrate ValidationProgress component when status is "validating"
    - Integrate ValidationResultsPanel when validation result exists
    - Integrate VersionHistoryPanel for version/validation history
    - _Requirements: 8.3, 5.1, 5.2, 6.5, 6.6_

  - [x] 14.2 Implement ValidationProgress component
    - Create `packages/admin-portal/src/features/report-validation/ValidationProgress.tsx`
    - Display animated step-progress indicator with 4 stages: document extraction, knowledge base query, compliance analysis, result generation
    - Visually distinguish completed, active, and pending stages
    - Display elapsed time counter (seconds) since validation request
    - Display estimated total time range based on page count (30s for 1-5 pages, 60s for 6-20, 90s for 21+)
    - Restore progress state when user navigates away and returns
    - Handle 5-minute timeout: show timeout message with "Retry Validation" button
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 14.3 Implement ValidationResultsPanel component
    - Create `packages/admin-portal/src/features/report-validation/ValidationResultsPanel.tsx`
    - Display overall ComplianceScoreBadge at top
    - Display findings grouped by severity (critical first) using groupFindingsBySeverity
    - Show total count per severity level and overall assessment summary (max 1000 chars)
    - Display AI disclaimer text at bottom of results
    - Handle loading state with 10-second timeout and retry action
    - Handle zero findings: show score 100 with green indicator and "no issues" message
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 12.1_

  - [x] 14.4 Implement FindingCard component
    - Create `packages/admin-portal/src/features/report-validation/FindingCard.tsx`
    - Display finding summary: severity badge, description, affected section
    - Expandable detail view: full description, suggested correction, regulation references
    - Render regulation references as navigable links opening in new browser tab
    - _Requirements: 5.3_

  - [x] 14.5 Implement VersionHistoryPanel component
    - Create `packages/admin-portal/src/features/report-validation/VersionHistoryPanel.tsx`
    - Display version history in reverse chronological order (most recent first)
    - Show per version: version number, file name, validation date, compliance score, finding count
    - Allow selecting a historical version to view its full ValidationResult
    - _Requirements: 6.5, 6.6_

- [x] 15. Implement frontend components - Modals and KB management
  - [x] 15.1 Implement DisclaimerModal component
    - Create `packages/admin-portal/src/features/report-validation/DisclaimerModal.tsx`
    - Display AI disclaimer text in modal dialog
    - Require explicit acknowledgment control before allowing validation to proceed
    - Show only on first validation request per authenticated session (use useDisclaimerAck hook)
    - If user does not acknowledge: prevent validation request, keep modal displayed
    - Provide "Cancel" action to dismiss without acknowledging (blocks validation)
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 15.2 Implement SubmitConfirmDialog component
    - Create `packages/admin-portal/src/features/report-validation/SubmitConfirmDialog.tsx`
    - Show confirmation dialog when submitting a report with status "draft" (unvalidated)
    - Display warning that report has not been validated for compliance
    - Provide "Confirm Submission" and "Cancel" actions
    - On confirm: proceed with submission
    - On cancel: dismiss dialog, retain report in "draft" status
    - Do not show dialog when submitting a "validated" report (proceed directly)
    - _Requirements: 7.5, 7.6, 7.7_

  - [x] 15.3 Implement KnowledgeBaseManager page component
    - Create `packages/admin-portal/src/features/report-validation/KnowledgeBaseManager.tsx`
    - Display list of uploaded context documents: file name, category, upload date, file size, sync status
    - Implement upload form with category selection (WorkSafeBC, BC Building Code, Safety Standards, Canada General)
    - Validate file type (PDF, .docx) and size (max 50 MB) client-side
    - Implement delete action with confirmation
    - Show sync status indicators (pending, indexed, error)
    - Restrict access to tenant_admin role only
    - _Requirements: 13.2, 13.3, 13.4, 13.6, 13.7, 13.8, 13.9_

- [x] 16. Wire frontend routing and navigation
  - [x] 16.1 Add routes and navigation for report validation
    - Add routes to `packages/admin-portal/src/app/router.tsx`:
      - `/reports` → ReportListPage
      - `/reports/:id` → ReportDetailPage
      - `/knowledge-base` → KnowledgeBaseManager (tenant_admin only)
    - Add "Reports" and "Knowledge Base" items to Sidebar navigation
    - Implement route guards for role-based access
    - _Requirements: 8.1, 8.3, 11.1, 13.6_

- [x] 17. Checkpoint - Ensure frontend builds and all component tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Frontend component tests
  - [x] 18.1 Write frontend component tests
    - Test ReportListPage: renders list, filters work, empty state displays
    - Test ReportDetailPage: shows correct actions per status, integrates panels
    - Test ReportUploadForm: validates file type/size, handles upload success/failure
    - Test ValidationResultsPanel: renders findings grouped by severity, shows disclaimer
    - Test ValidationProgress: shows stages, elapsed time, handles timeout
    - Test DisclaimerModal: blocks validation without acknowledgment, shows once per session
    - Test KnowledgeBaseManager: CRUD operations, validates file constraints
    - Test files: `packages/admin-portal/src/features/report-validation/__tests__/`
    - _Requirements: 5.1, 5.2, 8.1, 10.1, 12.2, 13.7_

  - [x] 18.2 Write frontend utility property tests
    - **Property 8: Score color classification** (frontend implementation)
    - **Property 9: Findings grouped by severity order** (frontend implementation)
    - **Property 14: Estimated validation time by page count** (frontend implementation)
    - **Validates: Requirements 5.1, 5.2, 10.3**
    - Test file: `packages/admin-portal/src/features/report-validation/__tests__/utils.property.test.ts`

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at logical boundaries
- Property tests validate universal correctness properties defined in the design document (18 total)
- Unit tests validate specific examples and edge cases
- Integration tests verify end-to-end flows with mocked AWS services
- The backend uses TypeScript with Vitest + fast-check for property-based testing
- The frontend uses TypeScript with React, Vite, and Vitest for testing
- All property tests should use a minimum of 100 iterations per `fc.assert(fc.property(...))`
- Frontend utility functions mirror backend implementations for client-side use

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "1.5", "1.6", "2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "4.1", "4.2"] },
    { "id": 3, "tasks": ["4.3", "4.4", "4.5", "5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1", "7.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7.2", "7.3"] },
    { "id": 6, "tasks": ["9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "10.1", "10.2"] },
    { "id": 8, "tasks": ["12.1", "12.2"] },
    { "id": 9, "tasks": ["12.3"] },
    { "id": 10, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 11, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5"] },
    { "id": 12, "tasks": ["15.1", "15.2", "15.3"] },
    { "id": 13, "tasks": ["16.1"] },
    { "id": 14, "tasks": ["18.1", "18.2"] }
  ]
}
```
