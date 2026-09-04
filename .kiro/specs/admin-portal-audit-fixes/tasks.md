# Implementation Plan

## Overview

This task list addresses seven bugs identified during the Admin Portal audit. The workflow follows the exploratory bugfix methodology: (1) write tests that demonstrate each bug exists, (2) write preservation tests for unaffected behavior, (3) implement fixes, (4) verify all tests pass. Frontend bugs (1-4) are fixed first, then backend bugs (5-7), followed by full verification.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3", "4", "5", "6", "7", "8", "9"] },
    { "id": 2, "tasks": ["10"] },
    { "id": 3, "tasks": ["11"] }
  ]
}
```

- Wave 0: Bug condition exploration tests (task 1) and preservation tests (task 2) run in parallel, BEFORE any fixes
- Wave 1: All fixes (frontend 3-6, backend 7-9) can proceed in parallel after wave 0
- Wave 2: Verification (task 10) runs after all fixes are complete
- Wave 3: Final checkpoint (task 11) runs after verification passes

## Tasks

### Phase 1: Bug Condition Exploration Tests (Write BEFORE fixing)

- [x] 1. Write bug condition exploration tests for all seven defects
  - **Property 1: Bug Condition** - Admin Portal Seven Defects Exploration
  - **CRITICAL**: Write these property-based tests BEFORE implementing any fix
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior — they will validate the fixes when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate each bug exists on the current unfixed code
  - **Scoped PBT Approach**: Each sub-property targets a specific bug condition from the design

  **Test 1a — Certification Document Viewer**:
  - Test that clicking "View" on a certification with a valid `document_key` triggers a backend call to `/workers/{id}/certifications/{certId}/document-url`
  - Assert the modal renders actual document content (not the hardcoded sample PDF placeholder)
  - Bug Condition: `isBugCondition_CertViewer(X)` where `X.action = "clickView" AND X.certification.document_key IS NOT NULL`
  - Expected: `result.calledBackendEndpoint = true AND result.renderedDocument != SAMPLE_PDF_PLACEHOLDER`

  **Test 1b — Site Profile Crash**:
  - Render `SiteProfile` with mock API response where `requiredCerts` is `undefined` and `recentActivity` is `undefined`
  - Assert no TypeError is thrown and page renders without crashing
  - Bug Condition: `isBugCondition_SiteProfileCrash(X)` where `X.requiredCerts IS undefined OR X.recentActivity IS undefined`
  - Expected: `rendered.threwException = false AND rendered.isBlankPage = false AND rendered.showsEmptyState = true`

  **Test 1c — Compliance Column Bare %**:
  - Render `SiteList` compliance column cell with `compliancePercent: undefined`
  - Assert cell does NOT contain bare `%` and instead shows "N/A"
  - Bug Condition: `isBugCondition_CompliancePercent(X)` where `X.compliancePercent IS undefined`
  - Expected: `cell.text = "N/A" AND cell.text != "%"`

  **Test 1d — Contractors Header Count**:
  - Render `ContractorList` with mock data `{ contractors: [4 items], total: 0 }` (or `total` missing)
  - Assert header shows `4` (or actual array length), not `0`
  - Bug Condition: `isBugCondition_ContractorCount(X)` where `X.isLoading = false AND X.headerCount != X.tableRows.length`
  - Expected: `headerCount = contractors.length`

  **Test 1e — Reports 403 for Platform Admin**:
  - Call report-validation handler with user whose actual Cognito role is `platform_admin`
  - Assert response status is NOT 403
  - Bug Condition: `isBugCondition_ReportsForbidden(X)` where `hasPermission(X.user.role, 'reports:read') = true AND X.responseStatus = 403`
  - Expected: `responseStatus != 403`

  **Test 1f — Users & Roles Empty**:
  - Call `GET /admin/users` as authenticated `platform_admin`
  - Assert response is not 404/501 and returns at least 1 user (the caller)
  - Bug Condition: `isBugCondition_UsersEmpty(X)` where `X.authenticatedUser IS NOT NULL AND X.listedUsers.length = 0`
  - Expected: `listedUsers.length > 0 AND listedUsers CONTAINS authenticatedUser`

  **Test 1g — Check-In Log Missing Details**:
  - Call `GET /site-access/recent-checkins` and inspect response items
  - Assert each entry has `workerName` and `siteName` populated, and denied entries have `denialReason`
  - Bug Condition: `isBugCondition_CheckInLog(X)` where `X.workerName IS undefined OR X.siteName IS undefined OR (X.status = "denied" AND X.denialReason IS undefined)`
  - Expected: All fields populated or explicit "Unknown" fallback

  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — failures confirm each bug exists)
  - Document counterexamples found for each bug to understand root causes
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

### Phase 2: Preservation Property Tests (Write BEFORE fixing)

- [x] 2. Write preservation property tests for unaffected behaviors
  - **Property 2: Preservation** - Existing Behavior Unchanged for Non-Buggy Inputs
  - **IMPORTANT**: Follow observation-first methodology
  - **CRITICAL**: Write and verify these tests BEFORE implementing any fix
  - Observe behavior on UNFIXED code for non-buggy inputs (cases where isBugCondition returns false)
  - Write property-based tests capturing observed behavior patterns

  **Test 2a — Site Profile renders correctly with valid data**:
  - Observe: `SiteProfile` renders correctly when `requiredCerts` is a valid array (e.g., `["OSHA-30", "First Aid"]`) and `recentActivity` is a valid array
  - Property: For all site records where `requiredCerts` IS defined AND `recentActivity` IS defined, the page renders badges for certs and activity list with timestamps (same as before fix)
  - Generate random valid `SiteDetail` objects with populated arrays; verify rendering matches baseline

  **Test 2b — Compliance column displays valid percentages correctly**:
  - Observe: `SiteList` renders `75%` in a warning Badge for `compliancePercent: 75`, `95%` in success Badge for `compliancePercent: 95`
  - Property: For all sites where `compliancePercent` is a valid number (0-100), the cell renders `{pct}%` with correct Badge variant (`success` >= 90, `warning` >= 70, `danger` < 70)
  - Generate random numeric values 0-100; verify Badge variant and text format

  **Test 2c — RBAC denies unauthorized roles correctly**:
  - Observe: `worker` role receives 403 for `GET /report-validation/reports`; `gate_operator` role receives 403
  - Property: For all roles where `hasPermission(role, 'reports:read') = false`, the response is 403
  - Generate requests with roles `worker`, `gate_operator`; verify 403 continues to be returned

  **Test 2d — Contractors header count correct when total matches array**:
  - Observe: When backend returns `{ contractors: [4 items], total: 4 }`, header shows "4 contractors registered"
  - Property: For all responses where `total` equals `contractors.length`, header count equals total
  - Generate contractor responses with matching total; verify header count

  **Test 2e — Check-in allowed entries display correctly**:
  - Observe: Allowed check-in entries display "Allowed" badge with timestamp and worker/site info
  - Property: For all check-in entries with `status = "allowed"` that have worker/site names populated, the display format remains unchanged after fix

  **Test 2f — Unaffected pages function normally**:
  - Observe: Dashboard, Workers, Safety AI, Incidents, Documents, Formularios pages render without errors
  - Property: Navigation to any page NOT listed in the 7 bugs produces no regressions

  - Run all preservation tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

### Phase 3: Frontend Fixes (Bugs 1-4)

- [x] 3. Fix Bug 1 — Certification Document Viewer (hardcoded sample PDF)

  - [x] 3.1 Fix parent component to use correct DocumentViewerModal
    - Open `packages/admin-portal/src/features/certifications/CertificationList.tsx` (or the parent that opens the modal)
    - Identify if a legacy modal or wrong component is being rendered instead of `DocumentViewerModal`
    - Replace with the correct `DocumentViewerModal` component import
    - Pass required props: `workerId`, `certification` (with `certification_id`), `open`, `onClose`
    - Verify `useDocumentUrl(workerId, certId, open)` is triggered on modal open
    - Handle case where `certification.document_key` is null: show "No document available" message
    - _Bug_Condition: isBugCondition_CertViewer(X) where X.action = "clickView" AND X.certification.document_key IS NOT NULL_
    - _Expected_Behavior: Modal calls backend for signed URL and renders actual document_
    - _Preservation: Certifications table columns, sorting, validation badges remain unchanged_
    - _Requirements: 2.1, 2.2, 3.1_

- [x] 4. Fix Bug 2 — Site Profile Crash (TypeError on undefined)

  - [x] 4.1 Add null guards for requiredCerts and recentActivity in SiteProfile
    - Open `packages/admin-portal/src/pages/sites/SiteProfile.tsx`
    - Replace `data.requiredCerts` usage (line ~114) with `(data.requiredCerts ?? [])`
    - Replace `data.recentActivity.slice(0, 5)` (line ~130) with `(data.recentActivity ?? []).slice(0, 5)`
    - Update TypeScript interface: mark `requiredCerts?: string[]` and `recentActivity?: Activity[]` as optional
    - Render empty state UI when arrays are empty/undefined (e.g., "No certifications required" / "No recent activity")
    - _Bug_Condition: isBugCondition_SiteProfileCrash(X) where X.requiredCerts IS undefined OR X.recentActivity IS undefined_
    - _Expected_Behavior: Page renders without throwing, shows empty state_
    - _Preservation: Sites with valid arrays render exactly as before (badges, activity list with timestamps)_
    - _Requirements: 2.3, 2.4, 3.2_

  - [x] 4.2 Add Error Boundary wrapper for page-level routes
    - Create or reuse an `ErrorBoundary` component that catches render errors
    - Wrap page-level routes in `router.tsx` with the Error Boundary
    - Display recoverable error message with "Try again" action instead of blank screen
    - _Requirements: 2.4_

- [x] 5. Fix Bug 3 — Sites List Compliance Column (bare %)

  - [x] 5.1 Add null check in compliance column cell renderer
    - Open `packages/admin-portal/src/pages/sites/SiteList.tsx`
    - In the compliance column `cell` renderer, add null/undefined check before rendering percentage
    - When `pct` is undefined or null, display `<span className="text-gray-400">N/A</span>`
    - When `pct` is a valid number, continue rendering `<Badge variant={...}>{pct}%</Badge>` as before
    - _Bug_Condition: isBugCondition_CompliancePercent(X) where X.compliancePercent IS undefined_
    - _Expected_Behavior: cell.text = "N/A" when compliancePercent is undefined_
    - _Preservation: Valid numeric compliancePercent (0-100) continues showing Badge with correct variant_
    - _Requirements: 2.5, 3.3_

- [x] 6. Fix Bug 4 — Contractors Header Count (stuck at 0)

  - [x] 6.1 Use array length fallback for header count
    - Open `packages/admin-portal/src/pages/contractors/ContractorList.tsx`
    - Change header count from `data?.total ?? 0` to `data?.total || data?.contractors?.length || 0`
    - This ensures the count reflects the actual loaded data when `total` is 0, missing, or unreliable
    - _Bug_Condition: isBugCondition_ContractorCount(X) where X.isLoading = false AND X.headerCount != X.tableRows.length_
    - _Expected_Behavior: headerCount = contractors.length (or accurate total)_
    - _Preservation: When total matches array length, display is unchanged_
    - _Requirements: 2.6, 3.5_

### Phase 4: Backend Fixes (Bugs 5-7)

- [x] 7. Fix Bug 5 — Reports 403 for Platform Admin (role resolution)

  - [x] 7.1 Fix role resolution in extractUserFromClaims
    - Open `packages/backend/src/shared/auth-middleware.ts`
    - Inspect `extractUserFromClaims` to identify how role is resolved from JWT claims
    - Add fallback: if `custom:role` is not present, check `cognito:groups` for role
    - Add debug logging to trace claim paths during role resolution
    - Ensure `platform_admin` role resolves correctly regardless of API Gateway claim format (v1 vs v2 payload)
    - Verify the `report-validation` Lambda's deployed RBAC matrix matches current `rbac.ts`
    - _Bug_Condition: isBugCondition_ReportsForbidden(X) where hasPermission(X.user.role, 'reports:read') = true AND responseStatus = 403_
    - _Expected_Behavior: platform_admin is authorized, response != 403_
    - _Preservation: Roles without reports:read (worker, gate_operator) still receive 403_
    - _Requirements: 2.7, 3.4_

- [x] 8. Fix Bug 6 — Users & Roles Empty (missing backend endpoint)

  - [x] 8.1 Create GET /admin/users backend endpoint
    - Create handler in `packages/backend/src/services/identity/` (or appropriate service directory)
    - Implement `GET /admin/users` that queries Cognito User Pool using `listUsers` API
    - Filter by `custom:tenant_id` matching the caller's tenant
    - Return `{ users: [...], total: N }` matching frontend's expected `UsersResponse` interface
    - Enforce `users:manage` permission via `enforcePermission`
    - _Bug_Condition: isBugCondition_UsersEmpty(X) where X.backendEndpointExists = false_
    - _Expected_Behavior: Endpoint returns tenant users including the authenticated caller_
    - _Preservation: No impact on existing endpoints; new route only_
    - _Requirements: 2.8_

  - [x] 8.2 Register /admin/users route in API Gateway
    - Add route mapping in `packages/backend/infra/lib/api-stack.ts` (or equivalent)
    - Map `GET /admin/users` to the identity service Lambda
    - Configure Cognito authorizer for the route
    - _Requirements: 2.8_

- [x] 9. Fix Bug 7 — Check-In Log Missing Details (backend data resolution)

  - [x] 9.1 Backend: Resolve worker/site names in recent-checkins response
    - Open the handler for `GET /site-access/recent-checkins`
    - Join or lookup `worker_id` → `workerName` from workers table/Cognito
    - Join or lookup `site_id` → `siteName` from sites table
    - For denied entries, include `denialReason` from the compliance decision record
    - Return populated fields in each check-in entry
    - _Bug_Condition: isBugCondition_CheckInLog(X) where X.workerName IS undefined OR X.siteName IS undefined_
    - _Expected_Behavior: All entries have workerName, siteName, and denialReason (for denied)_
    - _Preservation: Allowed entries continue to display as before, with additional name fields now populated_
    - _Requirements: 2.9, 3.6_

  - [x] 9.2 Frontend: Add fallback display for missing fields
    - Open `packages/admin-portal/src/pages/site-access/CheckIn.tsx`
    - Add defensive rendering: show "Unknown Worker" / "Unknown Site" if fields are still undefined
    - Display denial reason for denied entries when available
    - _Requirements: 2.9_

### Phase 5: Verification

- [x] 10. Verify bug condition exploration tests now pass

  - [x] 10.1 Re-run bug condition exploration tests after all fixes
    - **Property 1: Expected Behavior** - All Seven Defects Resolved
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior for each bug condition
    - When these tests pass, it confirms the expected behavior is satisfied for all 7 bugs
    - Run bug condition exploration tests from Phase 1
    - **EXPECTED OUTCOME**: All tests PASS (confirms all bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 10.2 Re-run preservation property tests after all fixes
    - **Property 2: Preservation** - No Regressions Introduced
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from Phase 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all preservation tests still pass after fixes
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 11. Checkpoint — Ensure all tests pass
  - Run full test suite (unit + integration)
  - Verify no TypeScript compilation errors across admin-portal and backend packages
  - Verify no ESLint errors introduced
  - Confirm all 7 bugs are resolved and no regressions exist
  - Ask the user if questions arise


## Notes

- Bug 1 may already be addressed by the existing `certification-document-viewer` spec — verify before duplicating work
- Bug 5 root cause may be a deployment issue (stale Lambda build) rather than a code issue — check deployed version first
- Bug 6 requires a new backend endpoint and API Gateway route — coordinate with infrastructure deployment
- Bug 7 requires database joins that may need new indexes for performance on large check-in tables
- All frontend fixes (Bugs 2, 3, 4) are defensive rendering changes with minimal risk of regression
- Property-based tests should use `fast-check` (already available in the project's test dependencies)
- The observation-first methodology for preservation tests ensures we capture real baseline behavior, not assumed behavior
