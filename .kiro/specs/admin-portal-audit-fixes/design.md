# Admin Portal Audit Fixes — Bugfix Design

## Overview

Seven defects were identified during a live authenticated walkthrough of the Admin Portal. This design document formalizes the bug conditions, root cause hypotheses, and fix implementations for all seven issues:

1. Certification document viewer renders hardcoded sample PDF instead of real documents
2. Site Profile page crashes on missing optional fields (`requiredCerts`, `recentActivity`)
3. Sites list compliance column shows bare `%` for undefined values
4. Contractors list header count stuck at 0 despite loaded rows
5. Platform Admin gets 403 on Reports despite having `reports:read` permission
6. Users & Roles administration always shows 0 users (no backend endpoint exists)
7. Site Access check-in log missing worker name, site name, and denial reason

The fixes are scoped to be minimal and targeted: defensive rendering for frontend crashes, proper API integration for missing data, and backend route/permission resolution for access issues.

## Glossary

- **Bug_Condition (C)**: The set of inputs/states that trigger the defective behavior
- **Property (P)**: The desired correct behavior that must hold for all buggy inputs after the fix
- **Preservation**: Existing behaviors that must remain unchanged by the fix
- **`DocumentViewerModal`**: Component in `packages/admin-portal/src/features/certifications/DocumentViewerModal.tsx` that renders certification documents
- **`SiteProfile`**: Page component at `packages/admin-portal/src/pages/sites/SiteProfile.tsx` that displays site details
- **`SiteList`**: Page component at `packages/admin-portal/src/pages/sites/SiteList.tsx` with compliance column
- **`ContractorList`**: Page at `packages/admin-portal/src/pages/contractors/ContractorList.tsx` with header count
- **`report-validation` Lambda**: Handler at `packages/backend/src/services/report-validation/handler.ts` serving `/report-validation/*` routes
- **`UsersRoles`**: Admin page at `packages/admin-portal/src/pages/admin/UsersRoles.tsx` calling `/admin/users`
- **`CheckIn`**: Page at `packages/admin-portal/src/pages/site-access/CheckIn.tsx` with "Recent Check-Ins" list
- **`rbac.ts`**: Permission matrix at `packages/backend/src/shared/rbac.ts`
- **`extractUserFromClaims`**: Function in `packages/backend/src/shared/auth-middleware.ts` that resolves user role from JWT claims

## Bug Details

### Bug Condition 1: Certification Document Viewer (Hardcoded PDF)

The `DocumentViewerModal` component already has the correct implementation — it calls `useDocumentUrl(workerId, certId, open)` and renders the real document. However, the **old version of the modal** (still referenced in `CertificationList.tsx` or another parent) is rendering a static sample PDF bundled in the frontend assets. The parent component that opens the modal is either not passing the correct `workerId` / `certification` props, or a different (legacy) modal component is being invoked.

**Formal Specification:**
```
FUNCTION isBugCondition_CertViewer(X)
  INPUT: X of type CertificationViewAction
  OUTPUT: boolean

  RETURN X.action = "clickView"
         AND X.certification.document_key IS NOT NULL
         AND modalRendered != DocumentViewerModal  // wrong modal or wrong props
END FUNCTION
```

### Bug Condition 2: Site Profile Crash (TypeError on undefined .length)

The `SiteProfile` component accesses `data.requiredCerts.length` (line ~114, via `.map()` or conditional) and `data.recentActivity.slice(0, 5)` (line ~130) without null checks. When the API returns a site record where these fields are `undefined` (valid for newly created sites), the page crashes.

**Formal Specification:**
```
FUNCTION isBugCondition_SiteProfileCrash(X)
  INPUT: X of type SiteDetail (API response)
  OUTPUT: boolean

  RETURN X.requiredCerts IS undefined OR X.recentActivity IS undefined
END FUNCTION
```

### Bug Condition 3: Sites List Compliance Percentage (bare `%`)

In `SiteList.tsx`, the compliance column cell renderer does `{pct}%` without checking if `pct` is undefined. When `compliancePercent` is undefined, it renders `undefined%` which displays as bare `%` in the browser.

**Formal Specification:**
```
FUNCTION isBugCondition_CompliancePercent(X)
  INPUT: X of type Site (list row)
  OUTPUT: boolean

  RETURN X.compliancePercent IS undefined OR X.compliancePercent IS null
END FUNCTION
```

### Bug Condition 4: Contractors Header Count (Stuck at 0)

In `ContractorList.tsx`, the header displays `{data?.total ?? 0} contractors registered`. The issue is the backend endpoint returns `total: 0` in the response while still returning populated `contractors[]` array — or the `total` field is simply not being returned at all, causing the `?? 0` fallback to always show 0.

**Formal Specification:**
```
FUNCTION isBugCondition_ContractorCount(X)
  INPUT: X of type ContractorsPageState
  OUTPUT: boolean

  RETURN X.isLoading = false
         AND X.displayedHeaderCount != X.contractors.length
END FUNCTION
```

### Bug Condition 5: Reports 403 for Platform Admin

The `report-validation` Lambda correctly uses `enforcePermission(user, 'reports:read')` and the RBAC matrix includes `reports:read` for `platform_admin`. The issue is likely in how the role is resolved: `extractUserFromClaims` reads `custom:role` from Cognito claims, but if the API Gateway authorizer is forwarding claims differently (e.g., role in `cognito:groups` as a comma-separated string, or the `custom:role` claim not being propagated), the role could resolve incorrectly (defaulting to `'worker'`).

**Formal Specification:**
```
FUNCTION isBugCondition_ReportsForbidden(X)
  INPUT: X of type ApiRequest
  OUTPUT: boolean

  RETURN X.route = "GET /report-validation/reports"
         AND X.user.actualCognitoRole = "platform_admin"
         AND X.resolvedRole != "platform_admin"  // role mis-resolution
END FUNCTION
```

### Bug Condition 6: Users & Roles Always Empty

The `UsersRoles` page calls `GET /admin/users`, but **no backend Lambda handles the `/admin/users` route**. The API-ROUTES.md documentation shows no `/admin/*` routes exist. The request likely returns a 404 or "Unsupported route" which the frontend silently swallows, resulting in `data` being undefined and showing 0 users.

**Formal Specification:**
```
FUNCTION isBugCondition_UsersEmpty(X)
  INPUT: X of type AdminUsersPageState
  OUTPUT: boolean

  RETURN X.authenticatedUser IS NOT NULL
         AND X.backendEndpointExists = false  // /admin/users not implemented
END FUNCTION
```

### Bug Condition 7: Check-In Log Missing Details

Looking at `CheckIn.tsx`, the "Recent Check-Ins" section actually does display `entry.workerName` and `entry.site`. The bug is that the **backend endpoint** (`GET /site-access/recent-checkins`) is not populating these fields in the response — it returns records with only `decision` and `timestamp` set, while `workerName`, `site`, and denial reasons are `undefined`.

**Formal Specification:**
```
FUNCTION isBugCondition_CheckInLog(X)
  INPUT: X of type RecentCheckIn (API response item)
  OUTPUT: boolean

  RETURN X.workerName IS undefined OR X.workerName = ""
         OR X.site IS undefined OR X.site = ""
         OR (X.decision = "denied" AND X.denialReason IS undefined)
END FUNCTION
```

### Examples

- **Bug 1**: User clicks "View" on a certification with `document_key: "certs/abc123.pdf"` → modal shows generic sample PDF instead of the actual document
- **Bug 2**: Navigate to `/sites/site-new-001` where site has no `requiredCerts` field → blank white screen, console shows `TypeError: Cannot read properties of undefined (reading 'length')`
- **Bug 3**: Sites table row with `{ name: "Site A", compliancePercent: undefined }` → compliance column shows bare `%`
- **Bug 4**: Contractors page loads 4 rows in table → header still reads "0 contractors registered"
- **Bug 5**: Platform admin clicks "Reports" nav item → red 403 error "No tienes permisos para realizar esta acción"
- **Bug 6**: Platform admin opens Administration > Users & Roles → "0 users in the platform" with empty table
- **Bug 7**: Gate operator performs check-in that is denied → "Recent Check-Ins" shows "Denied" badge + "14:32" but no name or site

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Mouse/click interactions on all tables (sorting, filtering, pagination) remain identical
- The Certifications list table columns, status badges, and validation workflows are untouched
- Sites with valid `requiredCerts` and `recentActivity` arrays render exactly as before
- Sites with valid numeric `compliancePercent` continue showing the formatted percentage with color badge
- All roles that should NOT have `reports:read` (worker, gate_operator) continue to receive 403
- Dashboard, Workers, Safety AI, Incidents, Documents, and Formularios pages function without changes
- Check-in events with status "allowed" continue to display as they do today
- The existing `DataTable` component behavior, `useApiQuery` caching, and routing remain untouched

**Scope:**
All inputs that do NOT match the seven bug conditions should produce exactly the same output as before the fix. This includes:
- All mouse-based interactions (no keyboard shortcut changes)
- All non-admin API endpoints
- All roles' permission checks other than the specific `reports:read` resolution fix
- All pages not listed in the seven defects

## Hypothesized Root Cause

Based on the code analysis, the most likely root causes are:

1. **Certification Viewer (Bug 1)**: The parent component (`CertificationList.tsx` or similar) is either (a) rendering an older/different modal component that uses a hardcoded PDF, or (b) not passing the `workerId` prop correctly to `DocumentViewerModal`, causing `useDocumentUrl` to never fire. The `DocumentViewerModal.tsx` code itself appears correct.

2. **Site Profile Crash (Bug 2)**: `SiteProfile.tsx` accesses `data.requiredCerts` (line ~114 via `.length > 0` check) and `data.recentActivity.slice(0, 5)` directly. The `SiteDetail` interface declares these as required (`requiredCerts: string[]`), but the API can return records without them for newly created sites.

3. **Compliance Percentage (Bug 3)**: In `SiteList.tsx`, the compliance column cell renderer casts `getValue()` to `number` and renders `{pct}%` without checking for undefined. Unlike `ContractorList.tsx` which has a proper null check, `SiteList` does not.

4. **Contractor Count (Bug 4)**: The header uses `data?.total ?? 0`. The backend `/contractors` endpoint likely returns `{ contractors: [...], total: 0 }` where `total` is hardcoded or computed incorrectly, not reflecting the actual array length. The frontend relies on the backend's `total` field rather than `data.contractors.length`.

5. **Reports 403 (Bug 5)**: The `extractUserFromClaims` function resolves role from `custom:role` claim. If the Cognito authorizer doesn't forward `custom:` prefixed attributes (common in API Gateway v1 vs v2 payload format differences), the role defaults to `'worker'` which lacks `reports:read`. Alternatively, the `report-validation` Lambda may be deployed from a stale build that doesn't include the latest RBAC matrix.

6. **Users & Roles Empty (Bug 6)**: No backend handler exists for `GET /admin/users`. The frontend calls this endpoint, receives a non-200 response, and the query hook returns undefined data, showing 0 users.

7. **Check-In Log Details (Bug 7)**: The backend `GET /site-access/recent-checkins` endpoint stores check-in records with only the foreign keys (worker_id, site_id) but doesn't join/populate the display names when returning them. The frontend expects `workerName` and `site` to be populated strings.

## Correctness Properties

Property 1: Bug Condition - Certification Document Fetches Real Document

_For any_ certification view action where the certification has a valid `document_key`, the system SHALL call the backend to obtain a signed URL and render the actual document content in the modal, never displaying a hardcoded placeholder PDF.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition - Site Profile Handles Missing Fields Gracefully

_For any_ site record where `requiredCerts` or `recentActivity` is undefined or null, the SiteProfile page SHALL render without throwing an exception, displaying appropriate empty-state UI for the missing sections.

**Validates: Requirements 2.3, 2.4**

Property 3: Bug Condition - Compliance Column Shows Valid Display

_For any_ site in the Sites list where `compliancePercent` is undefined or null, the compliance column SHALL display "N/A" instead of a bare `%` symbol.

**Validates: Requirements 2.5**

Property 4: Bug Condition - Contractor Header Count Matches Table

_For any_ state where the contractors list has finished loading, the header count SHALL equal the number of contractor rows actually available (using `data.contractors.length` as fallback when `total` is unreliable).

**Validates: Requirements 2.6**

Property 5: Bug Condition - Platform Admin Authorized for Reports

_For any_ API request to `GET /report-validation/reports` where the authenticated user has role `platform_admin` (with `reports:read` in the permission matrix), the backend SHALL NOT return 403 and SHALL correctly resolve the user's role from Cognito claims.

**Validates: Requirements 2.7**

Property 6: Bug Condition - Users & Roles Lists Tenant Users

_For any_ authenticated admin user (platform_admin or tenant_admin) who opens Users & Roles, the system SHALL list users belonging to the tenant, sourced from Cognito or a synced data store, including the currently authenticated user.

**Validates: Requirements 2.8**

Property 7: Bug Condition - Check-In Log Shows Complete Details

_For any_ check-in event displayed in "Recent Check-Ins", the entry SHALL include the worker's name, site name, and (for denied events) the denial reason. Missing fields SHALL fall back to an explicit "Unknown" label.

**Validates: Requirements 2.9**

Property 8: Preservation - Unaffected Pages and Permissions

_For any_ input that does NOT match any of the seven bug conditions (non-admin pages, valid site data, valid compliance percentages, correct permission checks for unauthorized roles), the fixed system SHALL produce exactly the same behavior as the original system.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

#### Bug 1: Certification Document Viewer

**File**: `packages/admin-portal/src/features/certifications/CertificationList.tsx` (or parent component that opens the modal)

**Specific Changes**:
1. **Ensure correct modal component is used**: Verify the parent renders `DocumentViewerModal` (not a legacy placeholder component)
2. **Pass required props**: Ensure `workerId` and `certification` (with `certification_id`) are correctly passed
3. **Handle missing document_key**: When `certification.document_key` is null/undefined, show "No document available" message in the modal

#### Bug 2: Site Profile Crash

**File**: `packages/admin-portal/src/pages/sites/SiteProfile.tsx`

**Specific Changes**:
1. **Default to empty arrays**: Replace `data.requiredCerts` with `(data.requiredCerts ?? [])` at usage points (line ~114)
2. **Default to empty arrays**: Replace `data.recentActivity.slice(0, 5)` with `(data.recentActivity ?? []).slice(0, 5)` (line ~130)
3. **Update TypeScript interface**: Mark `requiredCerts` and `recentActivity` as optional in `SiteDetail` interface (`requiredCerts?: string[]`, `recentActivity?: ...[]`)
4. **Add error boundary**: Wrap the route-level component with a React Error Boundary to catch future unexpected crashes

#### Bug 3: Sites List Compliance Column

**File**: `packages/admin-portal/src/pages/sites/SiteList.tsx`

**Specific Changes**:
1. **Add null/undefined check**: In the compliance column cell renderer, check if `pct` is undefined/null before rendering
2. **Display "N/A"**: When `compliancePercent` is undefined, display a neutral "N/A" text instead of `{pct}%`

```typescript
cell: ({ getValue }) => {
  const pct = getValue() as number | undefined;
  if (pct === undefined || pct === null) return <span className="text-gray-400">N/A</span>;
  return (
    <Badge variant={pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger'}>
      {pct}%
    </Badge>
  );
},
```

#### Bug 4: Contractors Header Count

**File**: `packages/admin-portal/src/pages/contractors/ContractorList.tsx`

**Specific Changes**:
1. **Use array length as fallback**: Change header to use `data?.contractors.length ?? data?.total ?? 0` to guarantee accuracy even if `total` is not returned correctly from the backend
2. **Backend investigation**: Verify the `/contractors` endpoint returns a correct `total` value; if not, fix the backend query to compute total properly

```typescript
<p className="mt-1 text-sm text-gray-500">
  {data?.total || data?.contractors?.length || 0} contractors registered
</p>
```

#### Bug 5: Reports 403 for Platform Admin

**Files**: 
- `packages/backend/src/shared/auth-middleware.ts`
- `packages/backend/src/services/report-validation/handler.ts`

**Specific Changes**:
1. **Debug role resolution**: Add logging in `extractUserFromClaims` to trace which claim path resolves the role
2. **Check API Gateway claim forwarding**: Verify that `custom:role` is included in the authorizer claims passed to the Lambda. API Gateway Cognito authorizers may not forward custom attributes by default
3. **Verify deployed build**: Ensure the `report-validation` Lambda is deployed from the latest code that includes the full RBAC matrix
4. **Alternative fix**: If `custom:role` is not forwarded, use `cognito:groups` as the primary role source, or configure the authorizer to pass custom claims

#### Bug 6: Users & Roles Administration

**Files**:
- New file: `packages/backend/src/services/identity/admin-users-handler.ts` (or add routes to existing identity handler)
- `packages/backend/infra/lib/api-stack.ts` (route mapping)

**Specific Changes**:
1. **Create backend endpoint**: Implement `GET /admin/users` that queries Cognito User Pool for users in the tenant (using `listUsers` API filtered by `custom:tenant_id`)
2. **Add route mapping**: Register the `/admin/users` route in the API Gateway stack, mapped to the identity service Lambda
3. **Permission check**: Enforce `users:manage` permission for the endpoint
4. **Return format**: Return `{ users: [...], total: N }` matching the frontend's `UsersResponse` interface

#### Bug 7: Check-In Log Details

**Files**:
- Backend handler for `GET /site-access/recent-checkins` (likely in access service)
- Optionally: `packages/admin-portal/src/pages/site-access/CheckIn.tsx` for fallback display

**Specific Changes**:
1. **Populate display fields**: Backend must resolve `worker_id` → `workerName` (from workers table) and `site_id` → `site` name (from sites table) before returning check-in records
2. **Include denial reason**: For denied entries, include the `reasons` or `denialReason` from the compliance decision record
3. **Frontend fallback**: Display "Unknown Worker" / "Unknown Site" when fields are still missing after fix (defensive rendering)

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each bug BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write unit and integration tests that reproduce each bug condition against the current (unfixed) code.

**Test Cases**:
1. **Cert Viewer Test**: Render the certification list, click "View" on a cert with a valid `document_key`, assert that a network request is made to the backend for a signed URL (will fail on unfixed code if wrong modal is used)
2. **Site Profile Crash Test**: Render `SiteProfile` with a mock API response missing `requiredCerts` → assert no TypeError thrown (will fail on unfixed code)
3. **Compliance Column Test**: Render `SiteList` with a site where `compliancePercent` is undefined → assert cell does NOT contain bare `%` (will fail on unfixed code)
4. **Contractor Count Test**: Render `ContractorList` with mock data `{ contractors: [4 items], total: 0 }` → assert header shows 4 not 0 (will fail on unfixed code)
5. **Reports Permission Test**: Call `handleListReports` with a user whose role is `platform_admin` → assert response is not 403 (may fail if role resolution is the issue)
6. **Admin Users Test**: Call `GET /admin/users` → assert response is not 404/501 (will fail on unfixed code since endpoint doesn't exist)
7. **Check-In Details Test**: Call `GET /site-access/recent-checkins` → assert each entry has `workerName` and `site` populated (will fail on unfixed code)

**Expected Counterexamples**:
- Bug 2: `TypeError: Cannot read properties of undefined (reading 'length')` at SiteProfile.tsx
- Bug 3: Rendered output contains `%` without a preceding digit
- Bug 4: Header text reads "0 contractors registered" while table has rows
- Bug 5: Response status is 403 for platform_admin
- Bug 6: Response is 404 or 501 "Unsupported route"
- Bug 7: `workerName` and `site` fields are undefined in response items

### Fix Checking

**Goal**: Verify that for all inputs where each bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition_SiteProfileCrash(X) DO
  result := renderSiteProfile_fixed(X)
  ASSERT result.threwException = false
  ASSERT result.showsEmptyState = true
END FOR

FOR ALL X WHERE isBugCondition_CompliancePercent(X) DO
  result := renderComplianceCell_fixed(X)
  ASSERT result.text = "N/A"
  ASSERT result.text != "%"
END FOR

FOR ALL X WHERE isBugCondition_ContractorCount(X) DO
  result := renderContractorList_fixed(X)
  ASSERT result.headerCount = X.contractors.length
END FOR

FOR ALL X WHERE isBugCondition_ReportsForbidden(X) DO
  result := handleListReports_fixed(X.user, X.params)
  ASSERT result.statusCode != 403
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition_SiteProfileCrash(X) DO
  ASSERT renderSiteProfile_original(X) = renderSiteProfile_fixed(X)
END FOR

FOR ALL X WHERE NOT isBugCondition_CompliancePercent(X) DO
  ASSERT renderComplianceCell_original(X) = renderComplianceCell_fixed(X)
END FOR

FOR ALL X WHERE X.user.role NOT IN ['platform_admin', 'tenant_admin', 'site_admin', 'supervisor', 'cso'] DO
  ASSERT handleListReports_original(X) = handleListReports_fixed(X)  // still 403
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many site/contractor data shapes automatically to verify defensive rendering doesn't break valid cases
- It verifies the RBAC matrix remains correct for all role/permission combinations
- It catches edge cases in null-handling that manual unit tests might miss

**Test Plan**: Observe behavior on UNFIXED code for valid inputs (sites with all fields present, roles without reports:read), then write property-based tests ensuring that behavior is preserved after the fix.

**Test Cases**:
1. **Site Profile Preservation**: For sites with valid `requiredCerts` array and `recentActivity` array, verify rendering output is identical before and after fix
2. **Compliance Column Preservation**: For sites with numeric `compliancePercent` (0-100), verify Badge renders with correct variant and text
3. **RBAC Preservation**: For roles `worker` and `gate_operator`, verify `reports:read` is still denied (403)
4. **Contractors Table Preservation**: For responses where `total` matches `contractors.length`, verify header shows correct count
5. **Check-In Display Preservation**: For "allowed" entries, verify existing display format is unchanged

### Unit Tests

- Test `SiteProfile` renders gracefully with undefined `requiredCerts` and `recentActivity`
- Test `SiteList` compliance column renders "N/A" for undefined, valid percentage for numbers
- Test `ContractorList` header count uses array length fallback
- Test `extractUserFromClaims` correctly resolves role from various claim formats
- Test `enforcePermission` with all role/permission combinations
- Test check-in log entries display fallback "Unknown" for missing fields

### Property-Based Tests

- Generate random `SiteDetail` objects (with and without optional fields) and verify no crashes
- Generate random compliance percentages (undefined, null, 0-100, edge values) and verify correct display
- Generate random contractor response shapes and verify header count always matches visible rows
- Generate random Cognito claim payloads and verify role resolution is deterministic and correct
- Generate random check-in records and verify display always includes name fields (or fallback)

### Integration Tests

- End-to-end test: Platform admin navigates to Reports → page loads successfully with report list
- End-to-end test: Navigate to a site profile with sparse data → page renders without crash
- End-to-end test: Open Users & Roles as platform_admin → at least 1 user (self) is visible
- End-to-end test: Perform a denied check-in → Recent Check-Ins shows worker name, site, and reason
