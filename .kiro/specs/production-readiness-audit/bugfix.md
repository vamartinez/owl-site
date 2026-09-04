# Bugfix Requirements Document

## Introduction

A full functional walkthrough of the deployed platform was performed for a production-readiness Product Owner audit: the Admin Portal (`localhost:3000`, proxying `https://qhk659i3s9.execute-api.us-east-1.amazonaws.com/dev`) authenticated as a real `platform_admin` user, and the public Landing Page (`localhost:3001`). Every top-level navigation section was visited (Dashboard, Workers, Certifications, Sites, Site Access, Contractors, Formularios, Safety AI, Incidents, Documents, Reports, Administration), plus the public marketing site's contact form. Root causes below were confirmed either by direct source-code comparison or by direct `curl` testing against the live API — not inferred from documentation. Thirteen concrete defects were found:

1. **Public lead capture form always fails, and the deployed Admin Portal is likely equally unable to reach the API** — The Landing Page's "Get Started Today" contact form shows "Something went wrong. Please try again or email us directly." on every submission attempt. Direct `curl` against the live API Gateway confirms the backend itself works correctly (`POST /dev/leads` with a well-formed `{company_name, contact_name, email, message}` payload returns `201 {"success":true,...}`). The frontend fails because `packages/landing-page/.env.local` has `VITE_API_URL=` (empty, gitignored) and `.github/workflows/landing-page.yml`'s build step never sets it, so the production bundle's `fetch(\`${apiUrl}/leads\`, ...)` (`ContactForm.tsx` line 71) resolves to a bare `/leads` path against whatever origin serves the static site — not the API Gateway. The same root cause pattern threatens the Admin Portal too: `packages/admin-portal/src/services/api-client.ts` defaults to the relative path `/api` when `VITE_API_URL` is unset, and while that works locally (Vite's dev-server proxy rewrites it), the deployed CloudFront distribution (`packages/backend/infra/lib/hosting-stack.ts`) has no `/api/*` behavior forwarding to API Gateway — so a production Admin Portal build has no working path to the API either, unless someone manually exports a correct absolute URL before running `pnpm build:portal` locally (undocumented, unverified, not exercised by this audit since only `localhost:3000` was tested). This is the platform's only public lead-generation mechanism, confirmed completely non-functional in production, plus a strong suspicion (not yet live-confirmed against the real CloudFront URL) that the entire deployed Admin Portal is in the same state.

2. **Reports page fails to load for every role** — `/reports` shows "Failed to load reports — API Error [400]: BAD_REQUEST" immediately on open, for every role that has access (platform_admin, tenant_admin, site_admin, cso). `packages/admin-portal/src/features/report-validation/hooks/useReports.ts` sends `sort_by` values `created_at`/`latest_validation_date`, but `packages/backend/src/services/report-validation/types.ts`'s `listReportsQuerySchema` only accepts `upload_date`/`validation_date` — every request fails Zod validation unconditionally. Separately, the same hook sends `page`/`page_size` while the backend's `paginationQuerySchema` expects `limit`/`cursor`, so pagination silently returns page 1's results for every page.

3. **Site Profile page shows no data for any site** — Opening `/sites/{id}` renders a blank title (just a location-pin icon and a bare comma, no name/address) and "N/A" for Active Workers, Compliance, and Contractor — for the exact same site whose name and address render correctly one click away on the `/sites` list. `handleGetSite` (`packages/backend/src/services/policy/handler.ts`, ~line 631) returns `{ site: result.Items[0] }` — the raw, unmapped DynamoDB item nested under a `site` key — while `handleListSites` returns a flat mapped shape. `SiteProfile.tsx` reads `data.name`/`data.address` directly (the list shape), so on the detail page these are always `undefined`.

4. **Users & Roles administration always shows zero users** — `/admin` displays "0 users in the platform / No users found" while a real `platform_admin` user is actively authenticated and using that exact page in that exact tenant, making user invitation and role assignment effectively unusable. `listAdminUsers` (`packages/backend/src/services/identity/admin-users.ts`, ~line 83) calls Cognito's `ListUsersCommand` with `Filter: '"custom:tenant_id" = "..."'`, but Cognito's `Filter` parameter only supports a fixed set of standard attributes (`username`, `email`, `phone_number`, `name`, `sub`, `status`, etc.) — custom attributes like `custom:tenant_id` cannot be filtered this way.

5. **Dashboard compliance trend chart renders empty** — The "Compliance Trend (7 days)" chart on `/dashboard` shows axes and date labels but no line/data, while the KPI card immediately above it ("100% Site Compliance") shows a real number for the same period.

6. **Certifications breakdown chart shows a single "Unknown" bucket** — The Certifications Overview's "Certifications by Type" bar chart, with 1 real active certification across 7 workers, shows one bar under the literal category label "Unknown" instead of the certification's actual type.

7. **Sites list shows blank join columns for every row** — The "Contractor", "Workers", and "Compliance" columns on `/sites` are blank/"N/A" for all 9 site rows, even though the Dashboard shows 7 real active workers and 100% aggregate compliance exist in the same tenant. `handleListSites` never computes or joins these per-row values.

8. **Contractors list shows blank join columns for every row** — The "Phone", "Workers", and "Compliance" columns on `/contractors` show "—" for all 4 contractor rows, for the same reason as Bug 7 (`listContractors` never computes or joins these values).

9. **Safety AI has no way to create a finding** — `/safety-ai` ("AI Safety Findings") shows a search bar, filters, and an empty table ("No findings found"), but there is no upload-photo control, no "New Scan" action, and no other affordance anywhere on the page to submit a photo for AI hazard analysis. The only visual element besides the empty table is a decorative brain icon (top-right) that does nothing when clicked. This is the platform's flagship "AI-assisted safety observation" capability, and there is currently no way to invoke it from the Admin Portal.

10. **Site Check-In cannot succeed for any worker, at any site** — `/site-access`'s "Worker Check-In" form has only one input field ("Worker ID or badge number") and no site selector. Submitting a real, existing worker's ID returns `Denied — Missing required inputs: site_requirements`: the Compliance Decision Engine requires a site context to evaluate policy, but the check-in screen has no way to supply one. Every check-in attempt is structurally guaranteed to be denied. (Older entries in "Recent Check-Ins" additionally show "Unknown Worker" / "Unknown Site" for both the identity and site fields, indicating this has never worked.)

11. **The product's own core "killer workflow" — worker self-service site access — does not exist** — `ideas.txt` (§3) defines the MVP's central loop as: a worker scans a persistent QR code or opens an SMS link, and the system validates identity/certifications/site policy and issues an explainable decision **with no staff involvement**. `packages/admin-portal/src/app/router.tsx` has no such route; the only access-control screen (`/site-access`, see Bug 10) is staff-operated ("Enter Worker ID or scan badge" — an operator scans a worker's badge, not a worker's own device). `docs/API-ROUTES.md` confirms every `/access/*` route requires a Cognito session; the only two public (unauthenticated) routes in the entire API are `/leads` and `/public/forms/:token`, and neither serves worker check-in.

12. **"Formularios" module UI is in Spanish while the rest of the platform is in English** — Every other module (Dashboard, Workers, Sites, Certifications, Safety AI, Incidents, Reports, Administration) is in English. The Formularios module (`/forms`, the `contractor-forms-qr` feature's admin UI) is entirely in Spanish — "Formularios", "Crear Formulario", "Estado", "Publicado", "Borrador", "Duplicar" — with no language toggle and no relationship to any user language preference.

13. **The shared `dev` environment is polluted with duplicate junk data, and worker names are stored with unescaped literal quote characters** — Of 7 workers, 6 are named "John Test Worker"/"Test Worker" sharing one phone number; of 9 sites, 8 are named "Test Site Alpha Updated"; all 4 contractors are named "Updated Contractor Inc" — almost certainly residue from running automated test suites directly against shared `dev` DynamoDB tables. Separately, one worker's stored legal name renders in the UI as `"Test"`, literal surrounding quote characters included, indicating the create/update path does not trim or sanitize free-text name input.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a visitor submits the Landing Page contact form with a valid company name, contact name, email, and message THEN the system displays "Something went wrong. Please try again or email us directly." because `import.meta.env.VITE_API_URL` is empty at build time, causing the request to be sent to the wrong origin

2.1 WHEN any authorized user opens `/reports` THEN the system displays "Failed to load reports — API Error [400]: BAD_REQUEST" because the frontend's default `sort_by` value is not a member of the backend's accepted enum

2.2 WHEN a user navigates to a second page of report results THEN the system returns the same first-page results because the frontend sends `page`/`page_size` while the backend only recognizes `limit`/`cursor`

3.1 WHEN a user opens `/sites/{id}` for any existing site THEN the system renders a blank page title and "N/A" for all stat cards because `handleGetSite` nests the response under a `site` key that the frontend never reads

4.1 WHEN a `platform_admin` or `tenant_admin` user opens `/admin` THEN the system displays "0 users in the platform" / "No users found", omitting even the currently authenticated user, because Cognito's `ListUsersCommand` `Filter` parameter silently fails (or matches nothing) on the unsupported custom attribute `custom:tenant_id`

5.1 WHEN the Dashboard's "Compliance Trend (7 days)" chart renders THEN the system displays empty axes with no plotted line, despite the KPI card directly above it showing a non-zero value for the same metric and period

6.1 WHEN the Certifications Overview's "Certifications by Type" chart renders THEN the system displays a single bar under the literal label "Unknown" instead of the certification's real type

7.1 WHEN the Sites list renders THEN the Contractor, Workers, and Compliance columns are blank or "N/A" for every row, regardless of whether the underlying data exists

8.1 WHEN the Contractors list renders THEN the Phone, Workers, and Compliance columns show "—" for every row, regardless of whether the underlying data exists

9.1 WHEN a user opens `/safety-ai` THEN the system displays only a search bar, filters, and an empty findings table, with no control anywhere on the page to upload a photo or otherwise trigger a new AI safety analysis

10.1 WHEN a user submits any real worker's ID on `/site-access`'s Worker Check-In form THEN the system returns `Denied — Missing required inputs: site_requirements`, because the form provides no way to select or supply a site

11.1 WHEN a worker (not a staff member) attempts to validate their own site access via QR scan or SMS link, per the product's own documented MVP workflow THEN no such route, page, or public API endpoint exists anywhere in the codebase

12.1 WHEN a user navigates to the Formularios module (`/forms`) THEN all UI text is displayed in Spanish, while every other module in the same application is displayed in English

13.1 WHEN a user browses Workers, Sites, or Contractors in the `dev` environment THEN the majority of records are duplicate placeholder test data indistinguishable from real records, and at least one worker's name is rendered with literal, un-stripped quote characters

### Expected Behavior (Correct)

14.1 WHEN a visitor submits the Landing Page contact form with valid required fields THEN THE Leads_Service SHALL receive the request at the correct API origin and return success, and THE Landing Page SHALL show a success confirmation

14.2 WHEN any authorized user opens `/reports` THEN THE system SHALL load and display the report list, with `sort_by` and pagination parameters that validate against the backend schema on every request

14.3 WHEN a user opens a site's profile page THEN THE system SHALL display that site's real name, address, and computed stat values (or an explicit "N/A" only where genuinely absent), using the same response shape as the Sites list endpoint

14.4 WHEN a `platform_admin` or `tenant_admin` user opens Users & Roles THEN THE system SHALL list every user in their tenant, including the currently authenticated user, without relying on an unsupported Cognito Filter expression

14.5 WHEN the Dashboard's compliance trend chart renders THEN THE system SHALL plot the real underlying time series whenever the corresponding KPI card shows non-zero data

14.6 WHEN the Certifications by Type chart renders THEN THE system SHALL group by the certification's actual type value, never falling back to a generic "Unknown" bucket when a real type is recorded

14.7 WHEN the Sites and Contractors lists render THEN THE system SHALL populate the Contractor/Workers/Compliance/Phone columns with real joined values wherever the underlying data exists

14.8 WHEN a user with photo-upload permission (per `docs/ROLES.md`) opens Safety AI THEN THE system SHALL provide a visible, functional control to upload a photo and submit it for AI hazard analysis

14.9 WHEN a staff user or a worker performs a site check-in THEN THE system SHALL capture the target site as part of the check-in request (via explicit selection, QR/badge-encoded site context, or default to the operator's assigned site) so the Decision Engine always receives the inputs it requires to evaluate policy

14.10 WHEN a worker wants to validate their own site access THEN THE system SHALL provide a public, unauthenticated, mobile-friendly flow (persistent QR and/or SMS link) that returns an explainable allow/conditional/deny decision without staff involvement, consistent with the product's documented MVP thesis

14.11 WHEN a user navigates any Admin Portal module, including Formularios THEN THE UI text SHALL be consistently in English, matching every other module

14.12 WHEN a worker record is created or updated THEN THE system SHALL trim whitespace and strip wrapping quote characters from free-text name fields before persisting them, and THE `dev` environment SHALL be reseeded with a small set of clearly-labeled, non-duplicated demo records before any customer-facing demo

### Unchanged Behavior (Regression Prevention)

15.1 WHEN a certification, incident, or document already renders correctly today (e.g. the Incidents creation form, the Documents folder browser, the certification document viewer fixed in a prior spec) THEN the system SHALL CONTINUE to function exactly as currently observed, with no regressions introduced while fixing the defects above

15.2 WHEN the `SiteProfile.tsx` empty-state guards for `requiredCerts`/`recentActivity` (already fixed in `admin-portal-audit-fixes-v2`) render THEN they SHALL CONTINUE to show empty states rather than throwing, once the response shape changes for Bug 3

15.3 WHEN roles without permission for a given module (per `docs/ROLES.md`) attempt to access it THEN the system SHALL CONTINUE to correctly deny them, unaffected by any fix in this document

15.4 WHEN a Landing Page visitor submits the contact form with genuinely invalid input (missing required field) THEN the system SHALL CONTINUE to show a client-side validation error rather than attempting a network request

15.5 WHEN an existing, correctly-typed certification record is grouped in the Certifications by Type chart THEN it SHALL CONTINUE to be counted under its real type after Bug 6 is fixed, not double-counted or dropped

---

## Bug Condition (Structured Pseudocode)

### Bug Condition 1: Leads Form Submission

```pascal
FUNCTION isBugCondition_LeadsSubmit(X)
  INPUT: X of type ContactFormSubmission
  OUTPUT: boolean
  RETURN X.builtWithEnv.VITE_API_URL IS empty OR undefined
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition_LeadsSubmit(X) DO
  ASSERT false // this build condition SHALL NOT occur in any deployed environment
END FOR

FOR ALL X WHERE X.formData IS valid DO
  result ← submitLeadForm(X)
  ASSERT result.requestOrigin = configuredApiGatewayUrl
    AND result.responseStatus = 200
    AND result.uiShowsSuccessConfirmation = true
END FOR
```

### Bug Condition 2: Reports Load and Pagination

```pascal
FUNCTION isBugCondition_ReportsContract(X)
  INPUT: X of type ReportsListRequest
  OUTPUT: boolean
  RETURN X.sort_by NOT IN backendSchema.allowedSortValues
    OR (X.page IS NOT NULL AND backendSchema.expectsCursorPagination)
END FUNCTION
```

```pascal
FOR ALL role IN [platform_admin, tenant_admin, site_admin, cso] DO
  result ← loadReports(role)
  ASSERT result.status = 200
    AND result.page2Results != result.page1Results  // when >1 page of data exists
END FOR
```

### Bug Condition 3: Site Profile Data Shape

```pascal
FUNCTION isBugCondition_SiteProfileShape(X)
  INPUT: X of type GetSiteResponse
  OUTPUT: boolean
  RETURN X.body.site IS NOT NULL AND X.body.name IS undefined
END FUNCTION
```

```pascal
FOR ALL X WHERE X.route = "GET /sites/{id}" DO
  ASSERT X.responseBody.name IS NOT undefined
    AND X.responseBody.address IS NOT undefined
    AND X.responseBody.shape = handleListSitesResponseShape
END FOR
```

### Bug Condition 4: Users & Roles Empty

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

### Bug Condition 5 & 6: Dashboard and Certification Charts

```pascal
FUNCTION isBugCondition_ChartEmptyOrUnknown(X)
  INPUT: X of type ChartRenderState
  OUTPUT: boolean
  RETURN (X.chart = "complianceTrend" AND X.hasData = false AND X.relatedKpi.value > 0)
      OR (X.chart = "certificationsByType" AND X.categories = ["Unknown"] AND X.underlyingRecords.hasRealType)
END FUNCTION
```

```pascal
FOR ALL X WHERE NOT isBugCondition_ChartEmptyOrUnknown(X) DO
  ASSERT X.chart.plottedSeries.length > 0 OR X.underlyingData.isGenuinelyEmpty
END FOR
```

### Bug Condition 7 & 8: List Join Columns

```pascal
FUNCTION isBugCondition_ListJoinBlank(X)
  INPUT: X of type ListRow  // SiteListRow or ContractorListRow
  OUTPUT: boolean
  RETURN X.workersCount IS undefined AND X.tenantHasActiveWorkers = true
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition_ListJoinBlank(X) DO
  ASSERT false  // real joined values SHALL be present after the fix
END FOR
```

### Bug Condition 9: Safety AI Has No Upload Path

```pascal
FUNCTION isBugCondition_SafetyAINoUpload(X)
  INPUT: X of type SafetyAIPageState
  OUTPUT: boolean
  RETURN X.userCanUploadEvidence = true AND X.page.hasVisibleUploadControl = false
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition_SafetyAINoUpload(X) DO
  ASSERT false  // an authorized user SHALL always have a visible way to submit evidence
END FOR
```

### Bug Condition 10: Check-In Missing Site Context

```pascal
FUNCTION isBugCondition_CheckInNoSite(X)
  INPUT: X of type CheckInRequest
  OUTPUT: boolean
  RETURN X.siteId IS undefined AND X.form.hasSiteSelector = false
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition_CheckInNoSite(X) DO
  ASSERT false  // every check-in request SHALL carry a resolvable site context
END FOR

FOR ALL X WHERE X.worker IS validRealWorker AND X.site IS validAssignedSite DO
  result ← submitCheckIn(X)
  ASSERT result.decision IN [allowed, conditional, denied]
    AND result.denialReason != "Missing required inputs: site_requirements"
END FOR
```

### Bug Condition 11: Worker Self-Service Check-In Absent

```pascal
FUNCTION isBugCondition_NoSelfCheckin(X)
  INPUT: X of type RouterConfig
  OUTPUT: boolean
  RETURN NOT EXISTS route IN X.routes WHERE route.isPublic = true AND route.purpose = "workerSelfCheckin"
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition_NoSelfCheckin(X) DO
  ASSERT false  // a public worker self-checkin capability SHALL exist after this is addressed
END FOR
```

### Bug Condition 12: Formularios Language Inconsistency

```pascal
FUNCTION isBugCondition_SpanishModule(X)
  INPUT: X of type ModuleUIStrings
  OUTPUT: boolean
  RETURN X.module = "Formularios" AND X.detectedLanguage != X.platformDefaultLanguage
END FUNCTION
```

```pascal
FOR ALL X WHERE X.module IN adminPortalModules DO
  ASSERT X.detectedLanguage = "English"
END FOR
```

### Bug Condition 13: Data Hygiene

```pascal
FUNCTION isBugCondition_DirtyData(X)
  INPUT: X of type WorkerRecord
  OUTPUT: boolean
  RETURN X.legalName MATCHES /^".*"$/  // literal wrapping quote characters
END FUNCTION
```

```pascal
FOR ALL X WHERE isBugCondition_DirtyData(X) DO
  ASSERT false  // SHALL NOT occur after input sanitization is added
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking — unaffected pages, roles, and already-fixed bugs remain unchanged
FOR ALL X WHERE NOT (isBugCondition_LeadsSubmit(X)
                  OR isBugCondition_ReportsContract(X)
                  OR isBugCondition_SiteProfileShape(X)
                  OR isBugCondition_UsersEmpty(X)
                  OR isBugCondition_ChartEmptyOrUnknown(X)
                  OR isBugCondition_ListJoinBlank(X)
                  OR isBugCondition_SafetyAINoUpload(X)
                  OR isBugCondition_CheckInNoSite(X)
                  OR isBugCondition_NoSelfCheckin(X)
                  OR isBugCondition_SpanishModule(X)
                  OR isBugCondition_DirtyData(X)) DO
  ASSERT F(X) = F'(X)
  // Dashboard KPI cards, Workers directory, Incidents form, Documents browser,
  // certification document viewer, and all existing RBAC checks remain unchanged
END FOR
```
