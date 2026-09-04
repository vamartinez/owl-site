# Bugfix Requirements Document

## Introduction

A full functional walkthrough of the deployed Admin Portal was performed, authenticated as a real `platform_admin` user against the live dev backend (not mocked). Every top-level navigation section was visited (Dashboard, Workers, Certifications, Sites, Site Access, Contractors, Formularios, Safety AI, Incidents, Documents, Reports, Administration). Seven concrete defects were found:

1. **Certification document viewer shows a fake document** — The "View" action on a worker's certification row opens a modal that renders a hardcoded sample PDF bundled in the frontend, instead of the worker's actual uploaded certification document. No network request is made to fetch a real document URL. (Tracked design/tasks already exist in `.kiro/specs/certification-document-viewer` — this item is the observed evidence confirming the feature is unimplemented; that spec's tasks should be executed to resolve it.)

2. **Site Profile page crashes to a blank screen** — Opening `/sites/{id}` for a site whose record lacks `requiredCerts` or `recentActivity` throws `TypeError: Cannot read properties of undefined (reading 'length')` in `packages/admin-portal/src/pages/sites/SiteProfile.tsx` (line 114 and line 130/138), which is uncaught and renders a fully blank page with no error boundary.

3. **Sites list shows a broken compliance percentage** — The Sites table's "Compliance" column renders a bare `%` character with no number for sites where `compliancePercent` is undefined, instead of a valid percentage or an explicit "N/A" state.

4. **Contractors list header count never updates** — `/contractors` shows "0 contractors registered" in the header indefinitely, even after the table below finishes loading and displays 4 contractor rows. The header count and the table are reading from disconnected/inconsistent sources.

5. **Platform Admin is denied access to Reports** — `GET /api/report-validation/reports` returns `403 Forbidden` ("No tienes permisos para realizar esta acción") for an authenticated `platform_admin` user, even though `PERMISSION_MATRIX[Role.PLATFORM_ADMIN]` in `packages/backend/src/shared/rbac.ts` explicitly includes `'reports:read'`. This blocks the entire Reports feature for the highest-privileged role.

6. **Users & Roles administration is always empty** — `/admin` shows "0 users in the platform" / "No users found" even while a real user is authenticated and actively using the platform in that same tenant, making user/role management unusable.

7. **Site Access check-in log is not actionable** — The "Recent Check-Ins" list on `/site-access` shows only a "Denied" badge and a timestamp for each entry, with no worker name, site name, or denial reason, so an operator cannot tell which worker or site an entry refers to.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user clicks "View" on a certification row in the Certifications Management table THEN the system opens a document modal that renders a hardcoded generic sample PDF from the frontend bundle, without calling any backend endpoint to fetch the real document

1.2 WHEN a user navigates to a site's profile page (`/sites/{id}`) for a site record missing `requiredCerts` or `recentActivity` THEN the system throws an uncaught `TypeError` reading `.length` on `undefined` and renders a completely blank page

1.3 WHEN the Sites list renders a site whose `compliancePercent` value is undefined THEN the system displays a bare `%` character with no numeric value in the Compliance column

1.4 WHEN the Contractors list finishes loading and displays contractor rows THEN the header count ("N contractors registered") continues to show 0 regardless of how many rows are actually rendered in the table

1.5 WHEN a user authenticated with role `platform_admin` requests `GET /report-validation/reports` THEN the backend returns `403 Forbidden`, despite the role's permission matrix entry including `reports:read`

1.6 WHEN a `platform_admin` user (or any user) is actively authenticated in a tenant and opens Users & Roles (`/admin`) THEN the system displays zero users, including omitting the currently authenticated user

1.7 WHEN a check-in event is denied and appears in "Recent Check-Ins" THEN the system displays only a "Denied" badge and a timestamp, omitting the worker name, site name, and denial reason

### Expected Behavior (Correct)

2.1 WHEN a user clicks "View" on a certification row THEN the system SHALL request a signed read URL from the backend for that certification's actual `document_key` and render the real document (PDF or image) in the modal

2.2 IF a certification has no associated document THEN THE system SHALL display an explicit "no document available" message instead of any placeholder document

2.3 WHEN a site record is missing `requiredCerts` or `recentActivity` THEN THE SiteProfile page SHALL treat the missing field as an empty list and render the existing "no data" empty states, without throwing

2.4 THE admin portal SHALL wrap page-level routes in an error boundary so that an unexpected render error produces a recoverable error message instead of a blank screen

2.5 WHEN the Sites list renders a site with an undefined or missing `compliancePercent` THEN THE system SHALL display "N/A" (or an equivalent explicit empty state) instead of a bare "%" symbol

2.6 WHEN the Contractors list finishes loading THEN THE header count SHALL equal the number of contractor rows shown in the table (or an accurate total returned by the backend), and SHALL update reactively as data loads or changes

2.7 WHEN a user with role `platform_admin`, `tenant_admin`, `site_admin`, `supervisor`, or `cso` requests `GET /report-validation/reports` THEN THE backend SHALL authorize the request per the existing permission matrix in `rbac.ts`, and the root cause of the current mismatch (role resolution in `extractUserFromClaims` vs. the deployed `report-validation` Lambda's permission check, including possible stale deployment) SHALL be identified and fixed

2.8 WHEN a `platform_admin` or `tenant_admin` user opens Users & Roles THEN THE system SHALL list all users belonging to the tenant, including the currently authenticated user, sourced from Cognito directly or from a table kept in sync with Cognito

2.9 WHEN a check-in event (allowed or denied) is recorded THEN THE "Recent Check-Ins" list SHALL display the worker's name, the site name, and — for denied events — the denial reason, falling back to an explicit "Unknown" label only for fields genuinely unavailable in the record

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a certification does have a valid `document_key` and the signed URL request succeeds THEN the system SHALL CONTINUE to render the document inline via the existing PDF/image viewer UI (iframe/img), without changing the Certifications Management table's columns, sorting, or validation status badges

3.2 WHEN a site record does include `requiredCerts` and `recentActivity` THEN the SiteProfile page SHALL CONTINUE to render them exactly as today (badges for certs, activity list with timestamps)

3.3 WHEN the Sites list renders a site with a valid numeric `compliancePercent` THEN it SHALL CONTINUE to display the existing formatted percentage

3.4 WHEN roles other than `platform_admin` (e.g., `worker`, `gate_operator`) attempt actions they are not permitted to perform THEN the system SHALL CONTINUE to correctly deny them per the existing `PERMISSION_MATRIX`

3.5 WHEN any other admin portal page not listed in this document (Dashboard, Workers, Safety AI, Incidents, Documents, Formularios) is used THEN it SHALL CONTINUE to function exactly as currently observed, with no regressions introduced while fixing the above defects

3.6 WHEN a check-in event is successfully allowed THEN the existing "Allowed"/granted display behavior SHALL CONTINUE to work, only the missing detail fields are being added

---

## Bug Condition (Structured Pseudocode)

### Bug Condition 1: Certification Document Viewer

```pascal
FUNCTION isBugCondition_CertViewer(X)
  INPUT: X of type CertificationViewAction
  OUTPUT: boolean
  RETURN X.action = "clickView" AND X.certification.document_key IS NOT NULL
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition_CertViewer(X) DO
  result ← openDocumentModal(X)
  ASSERT result.calledBackendEndpoint = "/workers/{id}/certifications/{certId}/document-url"
    AND result.renderedDocument = X.certification.actualDocumentContent
    AND result.renderedDocument != SAMPLE_PDF_PLACEHOLDER
END FOR
```

### Bug Condition 2: Site Profile Crash

```pascal
FUNCTION isBugCondition_SiteProfileCrash(X)
  INPUT: X of type SiteRecord
  OUTPUT: boolean
  RETURN X.requiredCerts IS undefined OR X.recentActivity IS undefined
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition_SiteProfileCrash(X) DO
  rendered ← renderSiteProfile(X)
  ASSERT rendered.threwException = false
    AND rendered.isBlankPage = false
    AND rendered.showsEmptyState = true
END FOR
```

### Bug Condition 3: Sites List Compliance Percent

```pascal
FUNCTION isBugCondition_CompliancePercent(X)
  INPUT: X of type SiteListRow
  OUTPUT: boolean
  RETURN X.compliancePercent IS undefined
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition_CompliancePercent(X) DO
  cell ← renderComplianceCell(X)
  ASSERT cell.text != "%"
    AND (cell.text = "N/A" OR cell.text MATCHES /^\d+%$/)
END FOR
```

### Bug Condition 4: Contractors Header Count

```pascal
FUNCTION isBugCondition_ContractorCount(X)
  INPUT: X of type ContractorsPageState
  OUTPUT: boolean
  RETURN X.isLoading = false AND X.headerCount != X.tableRows.length
END FUNCTION
```

```pascal
FOR ALL X WHERE NOT isBugCondition_ContractorCount(X) DO
  ASSERT X.headerCount = X.tableRows.length
END FOR
```

### Bug Condition 5: Reports 403 for Platform Admin

```pascal
FUNCTION isBugCondition_ReportsForbidden(X)
  INPUT: X of type ApiRequest
  OUTPUT: boolean
  RETURN X.route = "GET /report-validation/reports"
    AND hasPermission(X.user.role, 'reports:read') = true
    AND X.responseStatus = 403
END FUNCTION
```

```pascal
FOR ALL X WHERE X.route = "GET /report-validation/reports"
              AND hasPermission(X.user.role, 'reports:read') = true DO
  ASSERT X.responseStatus != 403
END FOR
```

### Bug Condition 6: Users & Roles Empty

```pascal
FUNCTION isBugCondition_UsersEmpty(X)
  INPUT: X of type AdminUsersPageState
  OUTPUT: boolean
  RETURN X.authenticatedUser IS NOT NULL AND X.listedUsers.length = 0
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition_UsersEmpty(X) DO
  ASSERT false  // this state SHALL NOT occur after the fix
END FOR

FOR ALL X WHERE X.authenticatedUser IS NOT NULL DO
  ASSERT X.listedUsers CONTAINS X.authenticatedUser
END FOR
```

### Bug Condition 7: Check-In Log Missing Details

```pascal
FUNCTION isBugCondition_CheckInLog(X)
  INPUT: X of type CheckInLogEntry
  OUTPUT: boolean
  RETURN X.workerName IS undefined OR X.siteName IS undefined
    OR (X.status = "denied" AND X.denialReason IS undefined)
END FUNCTION
```

```pascal
FOR ALL X WHERE NOT isBugCondition_CheckInLog(X) DO
  ASSERT X.workerName IS NOT NULL
    AND X.siteName IS NOT NULL
    AND (X.status != "denied" OR X.denialReason IS NOT NULL)
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking — unrelated pages and roles unaffected
FOR ALL X WHERE NOT (isBugCondition_CertViewer(X)
                  OR isBugCondition_SiteProfileCrash(X)
                  OR isBugCondition_CompliancePercent(X)
                  OR isBugCondition_ContractorCount(X)
                  OR isBugCondition_ReportsForbidden(X)
                  OR isBugCondition_UsersEmpty(X)
                  OR isBugCondition_CheckInLog(X)) DO
  ASSERT F(X) = F'(X)
  // Dashboard, Workers, Safety AI, Incidents, Documents, Formularios,
  // and all non-platform_admin permission checks remain unchanged
END FOR
```
