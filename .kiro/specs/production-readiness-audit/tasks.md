# Implementation Plan: Production Readiness Audit

## Overview

Fourteen fixes/investigations plus two scoped-out follow-up specs, ordered so the cheapest/highest-confidence fixes land first and nothing gets marked done without a live re-test against a freshly redeployed `dev` environment (and, for Task 2's Admin Portal half, the actual deployed CloudFront URL — not just `dev`'s API). Task 1 (redeploy + re-verify) MUST run before any other task, because it will separate "actually broken" from "fixed in source, never deployed" for every item — exactly the false-positive `verification-notes.md` already documented once in this codebase.

**⚠️ Product Owner priority note (2026-09-04): Task 2's Landing Page half (the CloudFront `webAclId` deploy blocker and redeploying the `landing-page` bundle) is explicitly deferred to just before public launch — no real traffic hits the live Landing Page yet. Do not spend implementation time there now; see `verification-notes.md` for the full finding (a confirmed silent-failure bug — the form shows a false "Thank you" while discarding every lead) and revisit it as a pre-launch checklist item.** Task 2's Admin Portal half (the `/api/*` CloudFront proxy) is already confirmed working live and is unaffected by this deferral.

Live re-verification (`verification-notes.md`, 2026-09-04) found Tasks 1-6, 8, 9, 11, 12 substantively complete; **Task 7 needs reopening for its 7.2 subtask** (Contractors list — marked `[x]` but confirmed still broken live, same false-positive-checkbox pattern documented once already in this codebase's history) even though 7.1/7.3/7.4 are genuinely done; Tasks 7.5 and 12.4 were still in progress; two new discrepancies were found (Admin Portal dashboard shows all-zero data on the real deployed domain despite `localhost` showing real data for the same login; Users & Roles shows the logged-in `platform_admin`'s role as `worker` in the table) and are not yet assigned their own task — file them as a fast-follow once someone can investigate with backend/log access this audit's tooling didn't have.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3", "4", "5", "6", "7", "8", "11", "12"] },
    { "id": 2, "tasks": ["9"] },
    { "id": 3, "tasks": ["10", "13"] },
    { "id": 4, "tasks": ["14"] }
  ]
}
```

- Wave 0: Redeploy and re-verify everything live before touching code.
- Wave 1: Nine independent fixes/investigations (frontend-API connectivity, reports, site profile, users, charts, list aggregation + data hygiene, i18n, competitive-parity investigation, Safety AI upload entry point) can run in parallel — they touch disjoint files. (Task 2's Landing Page half deferred per the note above — its Admin Portal half is not.)
- Wave 2: Property test for the reports contract (depends on the fix in wave 1 existing to test against).
- Wave 3: Both follow-up specs (worker self-checkin, AI provider migration) are scoped last, once the audit's own bugs are cleared — the worker self-checkin spec so it isn't competing for review attention with P0 fixes and can incorporate Task 11's competitive-gap findings (e.g. offline-tolerance); the AI provider migration spec so it can build on Task 12's confirmation of exactly how the existing detection/classification pipeline is invoked today.
- Wave 4: Task 14 (untested write flows + RBAC validation) runs last, once the fixes it would otherwise be testing against stale/broken state are in — validating create/edit flows against data that Task 7's reset script hasn't cleaned yet, for example, would produce confusing results.

## Tasks

### Task 1: Redeploy dev and re-verify every finding live

- [x] 1. Redeploy backend to `dev` and re-run this audit's repro steps before writing any fix code
  - Run `pnpm build:backend && pnpm deploy:dev`
  - Re-test: submit the Landing Page contact form → record whether it now succeeds (if yes, Task 2 is done, skip straight to a live-verify note, no code change needed)
  - Re-test: `GET /report-validation/reports` as platform_admin → confirm it's still `400` (expected — this is a code bug, not a deploy bug, but confirm the exact error body matches this spec's diagnosis)
  - Re-test: `GET /sites/{id}` for any existing site → confirm blank name/N/A stats still reproduce
  - Re-test: `/admin` Users & Roles → confirm still shows 0 users
  - Record results as a short note at the top of this file (or a `verification-notes.md` sibling, following the pattern already established in `admin-portal-audit-fixes`) before proceeding to Wave 1
  - _Requirements: 1.2, 10.1, 10.2_

### Task 2: Fix frontend-to-API connectivity for both deployed packages (not a backend bug)

- [x] 2. Give both `landing-page` and `admin-portal` a real, working way to reach the API when deployed
  - [x] 2.1 Confirm via `curl` (already done in this audit, re-confirm after Task 1's redeploy) that `POST https://.../dev/leads` with a correct `{company_name, contact_name, email, message}` payload returns `201` — this proves the backend is not the problem, so do NOT spend time in `leads/handler.ts` or CloudWatch logs for this issue
  - [x] 2.2 Add a build step to `.github/workflows/landing-page.yml` and `.github/workflows/admin-portal.yml` that sets `VITE_API_URL` to the real API Gateway invoke URL before `pnpm --filter <pkg> build` runs, sourced from the CDK API stack's output rather than hand-typed
  - [x] 2.3 Add a CloudFront behavior in `packages/backend/infra/lib/hosting-stack.ts` forwarding `/api/*` on both `AdminPortalCDN` and `LandingPageCDN` distributions to an `HttpOrigin` for the API Gateway execute-api domain, so the relative `/api` fallback already in `admin-portal/src/services/api-client.ts` works in every real environment, not just local `vite dev`
  - [x] 2.4 Update `packages/landing-page`'s `ContactForm.tsx` error handling to distinguish "temporary, retry" (5xx) from "check your input" (400) instead of one generic "Something went wrong" message
  - [x] 2.5 Add a post-deploy smoke-test script that `curl`s the real deployed CloudFront URLs (not localhost) for both the Landing Page leads endpoint and one authenticated Admin Portal API call, and fails loudly if either is unreachable
  - [x] 2.6 Live-verify against the ACTUAL deployed CloudFront domains (get the URL from `cdk deploy` output or CloudFormation, not localhost): submit the real Landing Page contact form and confirm a real `LeadCaptures` item is created; load the deployed Admin Portal and confirm at least the Dashboard's KPI cards populate with real data
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

### Task 3: Fix Reports 400 and broken pagination

- [x] 3. Align the report-validation query contract between frontend and backend
  - [x] 3.1 In `packages/admin-portal/src/features/report-validation/hooks/useReports.ts`, change `sort_by` values from `created_at`/`latest_validation_date` to `upload_date`/`validation_date` (matching `listReportsQuerySchema` in `packages/backend/src/services/report-validation/types.ts`); update any UI sort-control that feeds this hook to match
  - [x] 3.2 In the same hook, replace `page`/`page_size` query params with `limit`/`cursor` per `paginationQuerySchema` (`packages/backend/src/shared/validators.ts`); update `ReportListPage.tsx`'s pagination controls to cursor-based navigation, mirroring an existing cursor-paginated list in this codebase (e.g. contractors or forms) rather than inventing a new pattern
  - [x] 3.3 Live-verify: open `/reports` as platform_admin, tenant_admin, site_admin, and cso — confirm the list loads for each, sorting works, and paging past the first page returns different results
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### Task 4: Fix Site Profile data

- [x] 4. Make `handleGetSite` return the same shape and real computed fields as `handleListSites`
  - [x] 4.1 Extract the item-mapping logic from `handleListSites` (`packages/backend/src/services/policy/handler.ts`, ~line 594) into a shared `mapSiteRecord(item)` function
  - [x] 4.2 Change `handleGetSite` (~line 631) to return `mapSiteRecord(result.Items[0])` directly instead of `{ site: result.Items[0] }`
  - [x] 4.3 Extract the per-site compliance calculation from `handleComplianceSummary`'s `bySite` loop (`packages/backend/src/services/reporting/handler.ts`, ~lines 824-848) into a reusable helper; call it from both `handleGetSite` and `handleListSites` to populate `activeWorkers`, `compliancePercent`, `contractor`
  - [x] 4.4 Confirm `SiteProfile.tsx`'s existing `?? []` / `?? 'N/A'` guards (lines 87, 98, 109, 120, 136) still work unchanged — do not modify the frontend unless the backend shape change requires it
  - [x] 4.5 Live-verify: open `/sites/{id}` for an existing site, confirm name/address render in the header and stat cards show real (non-N/A) numbers where data exists
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

### Task 5: Fix Users & Roles empty list

- [x] 5. Remove the unsupported Cognito custom-attribute Filter and filter in application code
  - [x] 5.1 In `packages/backend/src/services/identity/admin-users.ts`, remove `Filter: '"custom:tenant_id" = "${tenantId}"'` from the `ListUsersCommand` call (~line 92)
  - [x] 5.2 After fetching the full paginated user list, filter by `custom:tenant_id` in application code using the existing `getAttribute(attributes, ...)` helper pattern
  - [x] 5.3 Live-verify: log in as platform_admin, open `/admin`, confirm the logged-in user appears in the list; smoke-test "Invite User" end-to-end and confirm the invited user shows up scoped to the correct tenant
  - _Requirements: 4.1, 4.2, 4.3_

### Task 6: Diagnose and fix Dashboard/Certifications charts

- [x] 6. Investigate then fix the empty compliance trend and "Unknown" certification-type charts
  - [x] 6.1 Capture the actual network response for whatever endpoint feeds the Dashboard's "Compliance Trend (7 days)" chart; determine if it returns real time-series data
  - [x] 6.2 Capture the actual network response for the Certifications "by Type" breakdown (likely `/certifications/stats`); determine if `type` is populated on certification records or if the endpoint isn't grouping by it correctly
  - [x] 6.3 Fix whichever side (backend data, or frontend chart data-consumption) is at fault for each chart — do not speculatively change both sides
  - [x] 6.4 Live-verify both charts render real series/breakdowns against the current (or freshly reseeded, per Task 7) dev data
  - _Requirements: 5.1, 5.2, 5.3_

### Task 7: List aggregation + dev data hygiene

- [ ] 7. Add real join columns to Sites/Contractors lists, sanitize worker names, and clean up dev seed data
  - [x] 7.1 Extend `handleListSites` to include a worker count and compliance percentage per row (reuse Task 4's compliance helper)
  - [x] 7.2 Extend `listContractors` (`packages/backend/src/services/contractors/contractor.ts`) to include phone/worker-count/compliance per row, and add the `total` field via a `Select: 'COUNT'` query per `verification-notes.md`'s existing recommendation, so `ContractorList.tsx`'s header count is accurate beyond one page
  - [x] 7.3 Add input trimming/quote-stripping to the worker create/update Zod schema for `legal_name`/`preferred_name` in the identity service
  - [x] 7.4 Add `packages/backend/scripts/reset-dev-data.ts` (or `.sh`) that clears and reseeds a small, clearly-labeled demo tenant's data; guard it with an explicit environment check that refuses to run against anything but `dev`; add a dry-run flag that prints what would be deleted before deleting
  - [-] 7.5 Run the reset script once against `dev` and confirm Sites/Contractors/Workers lists show clean, realistic, non-duplicated demo data
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

### Task 8: UI language consistency

- [x] 8. Translate the Formularios (contractor-forms-qr) module's UI strings to English
  - [x] 8.1 Inventory every hardcoded Spanish string in the `contractor-forms-qr` frontend feature (`FormListPage`, `FormDetailPage`, `FormEditPage`, `FormResponsesPage`, and shared components) — "Formularios", "Crear Formulario", "Estado", "Publicado", "Borrador", "Cargando formularios...", "Duplicar", "Respuestas", "Acciones", "Nombre", "Fecha de creación", etc.
  - [x] 8.2 Replace with English equivalents matching the rest of the platform's tone ("Forms", "Create Form", "Status", "Published", "Draft", "Loading forms...", "Duplicate", "Responses", "Actions", "Name", "Created")
  - [x] 8.3 Confirm no backend contract depends on the Spanish strings (e.g. status enum values sent to the API) — only user-facing label text should change, not data values
  - [x] 8.4 Live-verify: navigate the Formularios module end-to-end and confirm no Spanish text remains outside of intentionally bilingual content (if any exists for worker-facing forms, which is out of scope here — this task is about the staff-facing Admin Portal module only)
  - _Requirements: 8.1, 8.2_

### Task 11: Competitive-parity investigation and prioritization

- [x] 11. Verify which competitive gaps are real and produce a prioritized punch list for product sign-off
  - [x] 11.1 Using Task 7's reseeded demo data, create at least one Safety AI finding (via the actual upload-evidence → AI pipeline, or manually if the pipeline can't be exercised locally) and verify live whether photo annotation/markup exists on the finding review UI (Requirement 9.3)
  - [x] 11.2 Using the same seeded finding, verify live whether `/safety-ai/corrective-actions` supports assignment + due date + re-inspection close-out, or is read-only (Requirement 9.4)
  - [x] 11.3 Verify live whether crossing the 30-day certification expiry threshold actually triggers an email/SMS via `notification-service`, or whether the Dashboard's "Certs Expiring (30d)" card is display-only (Requirement 9.8)
  - [x] 11.4 Confirm there is no existing live roster / "who's on site now" view anywhere in the Admin Portal beyond the "Recent Check-Ins" log (Requirement 9.1) and no signature-capture field type in the Formularios builder (Requirement 9.2)
  - [x] 11.5 Compile findings from 11.1-11.4 plus the roadmap-scoped items (9.5 COR/D&A, 9.6 offline-first, 9.7 template library) into a short prioritized list and present it to the Product Owner for a go/no-go decision on which become follow-up specs before the next customer-facing milestone — do not start implementing any of Requirement 9's items without that sign-off, since several (COR/D&A, offline architecture) are strategic scope decisions, not bugs
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

### Task 9: Contract-drift regression test for reports

- [x] 9. Add a property test asserting `useReports.ts` and `listReportsQuerySchema` never drift again
  - [x] 9.1 Add a `fast-check`-based property test (following this repo's existing `pnpm test:properties` pattern) that generates the query params `useReports.ts` would send for arbitrary valid hook inputs, and asserts they always pass `listReportsQuerySchema.safeParse(...)`
  - [x] 9.2 Wire this test into whichever CI/test suite already runs `pnpm test:properties` so a future frontend or backend change to this contract fails CI instead of shipping silently broken to `dev` again
  - _Requirements: 2.2, 2.3_

### Task 10: Scope the worker self-service check-in follow-up spec

- [x] 10. Write a dedicated `.kiro/specs/worker-self-checkin` spec (requirements.md + design.md + tasks.md)
  - [x] 10.1 Write requirements.md covering: public QR-based check-in, public SMS-link check-in, identity verification without a staff Cognito session, decision-engine integration, role-scoped explainability per `docs/ROLES.md`
  - [x] 10.2 Write design.md reusing this spec's sequence diagram (see `design.md` §Requirement 7) as a starting point, and explicitly reusing `contractor-forms-qr`'s public-token, rate-limiter, and sanitizer patterns rather than reinventing public-endpoint abuse protection
  - [x] 10.3 Write tasks.md sized comparably to `contractor-forms-qr` (63 tasks) given the comparable scope (new public routes, new frontend surface, notification integration, decision-engine integration)
  - [x] 10.4 Do NOT implement this spec's tasks as part of the current spec — this task's completion criterion is the new spec existing and being ready for its own separate implementation pass
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

### Task 12: Give Safety AI a working evidence-submission entry point

- [ ] 12. Add an upload/trigger control to the Safety AI module and wire it to the existing detection pipeline
  - [x] 12.1 Grep `packages/admin-portal/src/app/router.tsx` and any Site/Worker detail pages for an existing but unlinked upload-and-analyze action before adding a new one
  - [x] 12.2 IF none exists, add a "New Scan" / "Upload Photo" control on `/safety-ai` (site selector + file picker/camera capture, reusing the `IncidentCreateForm` "Take Photo" pattern) that calls the existing `detection`/`scene-understanding` trigger endpoint (confirm the exact route in `docs/API-ROUTES.md`)
  - [x] 12.3 Add async progress display and result rendering, reusing `ai-report-validation`'s `ValidationProgress` polling pattern rather than inventing a new one
  - [-] 12.4 Live-verify: upload a real photo as a supervisor/site_admin/cso, confirm a finding appears in the `/safety-ai` list with real detection data (not a stub)
  - [x] 12.5 Once a real finding exists, re-run Task 11's items 11.1 and 11.2 (photo annotation, corrective-action loop) which required a finding to test against
  - _Requirements: 11.1, 11.2, 11.3, 11.4_

### Task 13: Scope the AI provider migration follow-up spec (Bedrock → Anthropic Claude API)

- [x] 13. Write a dedicated `.kiro/specs/ai-provider-migration` spec (requirements.md + design.md + tasks.md) — do not implement inline here
  - [x] 13.1 Inventory every Bedrock touchpoint precisely: `detection/detector.ts`, `scene-understanding/classifier.ts`, `report-validation/validation-engine.ts`, `report-validation/kb-manager.ts`, plus any CDK-provisioned Bedrock/Knowledge Base/S3 Vectors resources, plus the not-yet-started `worksafebc-pdf-compliance-agent` spec's Bedrock-based design
  - [x] 13.2 Measure the actual token count of the regulatory corpus (WorkSafeBC OHS Regulation, BC Building Code, Construction Safety Standards) currently indexed in the Bedrock Knowledge Base, to decide between prompt-caching the full corpus directly in Claude API calls (preferred if it fits) vs. standing up a separate lightweight vector store
  - [x] 13.3 Write requirements.md covering: direct Anthropic Messages API calls for vision (`detection`/`scene-understanding`), the chosen RAG replacement approach for `report-validation`, `ANTHROPIC_API_KEY` secrets management via AWS Secrets Manager + CDK injection, and updating `worksafebc-pdf-compliance-agent`'s design before it's implemented
  - [x] 13.4 Write design.md specifying the exact `@anthropic-ai/sdk` call shapes replacing each Bedrock call, the CDK changes (new Secrets Manager secret + IAM grants, removal of now-unused Bedrock/Knowledge Base/S3 Vectors resources confirmed via `cdk diff`), and a before/after accuracy comparison test plan using a fixed set of sample hazard photos so the provider swap can't silently regress detection quality
  - [x] 13.5 Write tasks.md with concrete per-service migration tasks, sized realistically given four+ Lambda services and CDK infrastructure changes are involved
  - [x] 13.6 Do NOT implement this spec's tasks as part of the current spec — this task's completion criterion is the new spec existing and being ready for its own separate implementation pass
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

### Task 14: Validate untested write flows and role-based access control

- [~] 14. Close the coverage gap: exercise every write flow and every role, live, and record results
  - [~] 14.1 Create/edit a Worker, a Site, and a Contractor using clearly-labeled test data; confirm each appears correctly in its list view
  - [~] 14.2 Upload and validate a new certification document for a worker; confirm it renders in the document viewer (not the placeholder bug already fixed in `certification-document-viewer`)
  - [~] 14.3 Build a Formulario, publish it, and complete the resulting public QR/link flow as an anonymous contractor end-to-end (`contractor-forms-qr`'s actual public-facing UX — not just the staff-facing list)
  - [ ] 14.4 Upload a real construction report via `/reports` and observe the full AI validation cycle (draft → validating → validated with real Compliance_Findings), not just the empty state
  - [ ] 14.5 Submit a complete Incident report end-to-end and view its resulting detail/timeline
  - [ ] 14.6 Use "Invite User" on Administration end-to-end; confirm the invited user lands correctly scoped to the inviting admin's tenant
  - [ ] 14.7 Export a report as PDF and CSV from Reports, and download a document from Documents; confirm the files are non-empty and correctly formatted
  - [ ] 14.8 Exercise the "Forgot your password?" flow far enough to confirm it triggers a real Cognito reset
  - [ ] 14.9 Using `aws cognito-idp admin-create-user`/`admin-update-user-attributes` (per `docs/ROLES.md`), create one test user per remaining role (`tenant_admin`, `site_admin`, `supervisor`, `cso`, `gate_operator`, `worker`) — this audit's own tooling lacked AWS CLI access to provision these
  - [ ] 14.10 For each role from 14.9: log in, confirm the nav sidebar matches `docs/ROLES.md`'s permission matrix, attempt one disallowed action via a raw API call and confirm `403` (not just a hidden UI element), and for one role per explainability tier confirm the compliance-decision payload shown matches that tier's documented visibility rule
  - [ ] 14.11 Record all results (pass/fail, with evidence) as a dated addendum to `verification-notes.md` — do not mark this task `[x]` without that record
  - _Requirements: 13.1, 13.2, 13.3_
