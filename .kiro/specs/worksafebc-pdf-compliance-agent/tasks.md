# Implementation Plan: WorkSafeBC PDF Compliance Agent

## Overview

This plan extends the existing `report-validation` service (reusing its BDA extraction, Bedrock Knowledge Base/RAG, and presigned-upload patterns — see design.md's "Key Design Decision") with new WorkSafeBC-specific routes, tables, an async SQS pipeline, and a standalone JSON schema/parser module. Before starting implementation, resolve the three "Open Questions" in design.md with the user (compliance-level rule discrepancy, PDF export approach, notification channel) — tasks 7.2 and 11.x are blocked on those answers.

## Tasks

- [ ] 1. Data model: new DynamoDB tables and CDK wiring
  - [ ] 1.1 Add `AnalysisSessions`, `RegulatoryClauses`, `RegulatoryVersions` table definitions to the data stack
    - Add table constructs in `infra/lib/data-stack.ts` (or equivalent) following the existing tenant-partitioned pattern (`PK`/`SK`, on-demand billing) used by other tables
    - `AnalysisSessions`: GSI1 (site-scoped queries), GSI2 (document_group_id re-analysis chains) per design.md's data model
    - `RegulatoryClauses`: GSI1 (list clauses by version)
    - `RegulatoryVersions`: no GSI needed (single-partition `WORKSAFEBC_KB`)
    - _Requirements: 1.6, 5.1, 5.4, 7.3, 7.7_

  - [ ] 1.2 Define shared TypeScript types
    - Create `packages/backend/src/services/report-validation/worksafebc-types.ts`
    - Define `AnalysisSession`, `DocumentCategory`, `SessionStatus`, `HallazgoCumplimiento`, `ComplianceLevel`, `RegulatoryClause`, `RegulatoryVersion`, `ReporteCumplimiento` matching design.md's data model exactly, including all length/count caps (200 findings, 50 recommendations, 500/1000/10000 char limits)
    - _Requirements: 3.3, 3.4, 4.2, 4.3, 7.7_

- [ ] 2. Checkpoint — Data model reviewed
  - Confirm table/GSI design with the user before building on top of it; ask about the 3.6/4.9 compliance-level discrepancy from design.md now, since task 6 depends on the answer.

- [ ] 3. Regulatory Knowledge Base: versioned clause management
  - [ ] 3.1 Implement `regulatory-kb-manager.ts`
    - `publishRegulatoryVersion(input): Promise<RegulatoryVersion>` — validates effective_date is after the current latest version's (Requirement 7.8), validates every clause has part/section/clause/text (reject with specific field-level error otherwise), writes all clauses + the version record, total upload ≤ 50MB
    - `getActiveVersion(asOfDate: string): Promise<RegulatoryVersion | null>` — query `RegulatoryVersions` PK=`WORKSAFEBC_KB`, `ScanIndexForward: false`, first item with `effective_date <= asOfDate`
    - `getClausesForVersion(versionId, categories?: string[]): Promise<RegulatoryClause[]>` — via GSI1, optionally filtered by `applicability_categories`
    - After a version publish succeeds, trigger re-sync of the underlying Bedrock KB (reuse `kb-manager.ts`'s `StartIngestionJobCommand` call) so the vector index reflects the new clauses
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [ ]* 3.2 Write property test: version resolution is deterministic
    - **Property 8: Regulatory version resolution**
    - Generate arbitrary sets of (version_id, effective_date) pairs and arbitrary query dates; verify `getActiveVersion` always returns the latest version whose effective_date ≤ query date, or null if none
    - **Validates: Requirements 7.4, 7.5**

  - [ ]* 3.3 Write property test: version publish rejects invalid input
    - **Property 9: KB upload validation**
    - Generate arbitrary clause sets with missing fields or out-of-order effective dates; verify rejection with a field-specific error in every case
    - **Validates: Requirements 7.8**

  - [ ] 3.4 Add API routes: `POST /worksafebc-agent/regulatory-versions`, `GET /worksafebc-agent/regulatory-versions`
    - Enforce `kb:manage` permission (already defined in `rbac.ts`, granted to platform_admin) — reuse existing permission, do not add a new one
    - _Requirements: 7.3, 7.6_

  - [ ] 3.5 Seed initial regulatory content
    - Load OHSR Part 4, 11, 13, 18, 20, 21 as the first published version (effective_date = launch date) — coordinate with the user on the actual regulation text source (this is content work, not just code)
    - _Requirements: 7.2_

- [ ] 4. Upload and categorization endpoints
  - [ ] 4.1 Implement `POST /worksafebc-agent/sessions`
    - Reuse `upload-manager.ts`'s presigned-URL pattern: validate PDF header + declared size/page count client-side hint, create `AnalysisSessions` record with status `recibido`, generate presigned PUT URL, store S3 metadata (tenant_id, site_id, uploader, timestamp, session reference) with encryption at rest
    - Enforce role check inline (platform_admin, site_admin, tenant_admin, supervisor, cso only) — reuse `enforcePermission`, add a new `worksafebc:upload` permission to `PERMISSION_MATRIX` in `rbac.ts` scoped to those five roles
    - Return 503-equivalent error without creating a session record if S3 is unavailable
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 1.8_

  - [ ]* 4.2 Write property test: upload acceptance is format/size bounded
    - **Property 1: Upload acceptance/rejection**
    - Generate arbitrary byte buffers (valid PDF headers vs not, various sizes) and page counts; verify accept iff valid-PDF AND size≤50MB AND pages≤500, with the specific violated constraint named on rejection
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [ ]* 4.3 Write property test: RBAC on upload
    - **Property 2: Upload RBAC**
    - Generate all 7 defined roles; verify upload succeeds only for the 5 permitted roles
    - **Validates: Requirements 1.1, 1.7**

  - [ ] 4.4 Implement `PATCH /worksafebc-agent/sessions/{id}/category`
    - Validate category against the 5 allowed values, transition status `recibido` → `categorizado`, enqueue an `extract` message on `pdf-compliance-analysis-queue` with the session_id
    - _Requirements: 1.5_

- [ ] 5. Checkpoint — Upload pipeline testable end-to-end (through categorization + enqueue)

- [ ] 6. Async pipeline infrastructure
  - [ ] 6.1 Add `pdf-compliance-analysis-queue` SQS queue and SNS state-change topic to the events stack
    - Add to `infra/lib/events-stack.ts` (or equivalent), following the existing `AI_PIPELINE_QUEUE_URL` pattern already used by the AI safety pipeline (per README architecture) — reuse the same DLQ/retry conventions already established there
    - _Requirements: 6.1, 6.2_

  - [ ] 6.2 Add two new Lambda entry points sharing the `report-validation` deployment bundle
    - `worksafebc-extraction-consumer` and `worksafebc-analysis-consumer`, both SQS-triggered, both exported from the same `report-validation` package with distinct handler exports (`extractionConsumerHandler`, `analysisConsumerHandler`) — no new service/package, just new CDK `Function` constructs pointed at existing build output
    - Wire IAM: S3 read (documents bucket), DynamoDB read/write (AnalysisSessions), Bedrock invoke (both BDA and KB), SNS publish
    - _Requirements: 2.1, 3.1_

- [ ] 7. Extraction consumer (reuses text-extractor.ts)
  - [ ] 7.1 Implement `extractionConsumerHandler`
    - On `extract` message: fetch document from S3, call the existing BDA extraction path from `text-extractor.ts` (no changes needed to that module), enforce the size-scaled timeout (60s ≤100pg, 180s for 101-500pg) at the orchestration level
    - On success: store structured blocks + extraction metrics (pages_processed, pages_ocr_applied, avg_confidence), status → `texto_extraido`, publish SNS state-change event, enqueue `analyze` message
    - On >50% unprocessable pages, password-protected, or >500 pages: status → `extraccion_fallida` with the specific `failure_reason`, publish SNS event, do NOT enqueue `analyze`
    - Per-page OCR confidence <30% counts that page as unprocessable (Requirement 2.4)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 6.2_

  - [ ]* 7.2 Write property test: extraction never reaches an undefined terminal state
    - **Property 3: Extraction outcome totality**
    - Generate arbitrary (page_count, ocr_confidences[], is_password_protected) combinations; verify the resulting status is always exactly one of {texto_extraido, extraccion_fallida} with the correct failure_reason when applicable
    - **Validates: Requirements 2.3, 2.5, 2.7, 2.8**

- [ ] 8. WorkSafeBC validation engine (new module)
  - [ ] 8.1 Implement `worksafebc-validation-engine.ts`: `selectApplicableParts`
    - Static mapping from `DocumentCategory` to applicable OHSR parts (e.g., `plan_seguridad` → [Part 4, Part 11, Part 20]) — confirm exact mapping with the user/domain expert before finalizing, this is a content decision not just code
    - _Requirements: 3.2_

  - [ ] 8.2 Implement `classifySeverity` and `assignComplianceLevel` as pure functions
    - **BLOCKED on task 2's checkpoint** — implement per whichever of Requirement 3.6/4.9 the user confirms as authoritative (design.md recommends 4.9)
    - `classifySeverity`: total function over the LLM's raw finding output, always returns one of {critica, alta, media, baja} for 'brecha' findings — do not let the LLM freely assign severity strings; parse its output and map to this closed set deterministically
    - `assignComplianceLevel`: pure function of a findings array, per the reconciled rule in design.md, including the `no_evaluable` case (Requirement 3.10) when there is no evaluable content for the document's category
    - _Requirements: 3.5, 3.6, 3.10, 4.9_

  - [ ]* 8.3 Write property test: severity classification totality
    - **Property 4: Severity classification is total and deterministic**
    - **Validates: Requirements 3.5**

  - [ ]* 8.4 Write property test: compliance-level assignment is a pure function of findings
    - **Property 5: Compliance-level assignment**
    - Generate arbitrary finding sets (varying type/severity combinations); verify the same input always produces the same compliance_level and matches the reconciled rule exactly
    - **Validates: Requirements 3.6, 4.9**

  - [ ] 8.5 Implement `analyzeCompliance(input): Promise<AnalyzeResult>`
    - Call `RetrieveAndGenerateCommand` against the Bedrock KB (reuse `validation-engine.ts`'s invocation pattern) scoped to the applicable OHSR parts from 8.1, using the clause text from `getClausesForVersion` (task 3.1) as retrieval context
    - Parse the model's response into `HallazgoCumplimiento[]`, enforcing per-item caps (500 char description) and total cap (200 findings, truncate lowest-severity first if exceeded — confirm truncation order with user)
    - Generate 1-3 recommendations (≤500 chars each, ≤50 total) per critical/alta 'brecha' finding
    - Record `ai_model_version` and `regulatory_kb_version_id` used
    - On timeout (>300s scaled) or internal error: status → `analisis_fallido`, discard partial findings, do not persist a partial report
    - On no evaluable content: status → `analisis_completado` with compliance_level `no_evaluable`, zero findings
    - _Requirements: 3.1, 3.3, 3.4, 3.7, 3.8, 3.9, 3.10_

  - [ ] 8.6 Implement `analysisConsumerHandler`
    - On `analyze` message: load session + extracted text, call `analyzeCompliance`, build the `ReporteCumplimiento` (executive summary ≤1000 chars, findings sorted by severity descending, metadata per Requirement 4.4), store on the session, status → `analisis_completado`, publish SNS event
    - On failure: status → `analisis_fallido`, publish SNS event with the failure stage and suggested corrective action per Requirement 6.6 (retry / verify format / contact support)
    - If report generation itself fails after a successful analysis (4.8): log with session_id, notify user of the specific failure
    - _Requirements: 3.1, 3.9, 4.1, 4.2, 4.4, 4.6, 4.7, 4.8, 4.9, 6.2, 6.5, 6.6_

  - [ ]* 8.7 Write property test: report bounds are always enforced
    - **Property 6: Report field bounds**
    - Generate arbitrarily large finding/recommendation sets; verify the persisted report never exceeds 200 findings / 50 recommendations, and every string field respects its char cap
    - **Validates: Requirements 4.2, 4.3**

- [ ] 9. Checkpoint — Full pipeline testable end-to-end (upload → categorize → extract → analyze → report)

- [ ] 10. Session history, retrieval, and tenant isolation
  - [ ] 10.1 Implement `GET /worksafebc-agent/sessions/{id}`
    - Enforce tenant isolation: 403/404 (not revealing existence) for cross-tenant access — reuse the same non-disclosure pattern used elsewhere in the backend for other tenant-scoped resources
    - Return current status + report (if completed) for polling
    - _Requirements: 5.6, 6.4_

  - [ ]* 10.2 Write property test: tenant isolation on session access
    - **Property 7: Tenant isolation**
    - Generate arbitrary (session tenant, requester tenant) pairs; verify access succeeds iff they match, and cross-tenant responses never leak existence
    - **Validates: Requirements 5.6**

  - [ ] 10.3 Implement `GET /worksafebc-agent/sessions` (history, paginated)
    - Default page size 20, max 100; sort by started_at descending; filters: site, category, compliance_level, date range
    - For tenant_admin/platform_admin: all sessions in tenant (via base table query)
    - For site_admin/supervisor/cso: only sessions for their `assigned_sites` (via GSI1, one query per assigned site or an `IN` filter — confirm assigned_sites list size is small enough for this to be efficient, else reconsider index shape)
    - Empty-filter-results: return empty state, keep filters visible/active in the response context (frontend concern, but backend must not error on zero results)
    - _Requirements: 5.2, 5.3, 5.7_

  - [ ] 10.4 Implement `POST /worksafebc-agent/sessions/{id}/reanalyze`
    - Create new session with `document_group_id` = original's, `previous_session_id` = original's id, same document_key (no re-upload), status `recibido` → immediately enqueue extraction (category already known from original)
    - Original session record is never modified
    - _Requirements: 5.5_

  - [ ] 10.5 Add 7-year retention
    - Set `retention_expires_at` on session creation (now + 7 years); confirm with user whether this needs a DynamoDB TTL attribute (auto-delete) or just a queryable field for manual archival review, since regulatory retention usually means "don't delete before," which is the opposite of what TTL auto-deletion does — TTL is likely the wrong mechanism here, flag this explicitly
    - _Requirements: 5.4_

- [ ] 11. Notifications
  - **BLOCKED on design.md Open Question 3 (notification channel)** — confirm with user before starting
  - [ ] 11.1 Implement notification dispatch on terminal states (completado, extraccion_fallida, analisis_fallido, timeout)
    - Subscribe a notification-sender to the SNS topic from task 6.1
    - Deliver within 60s of the state change; retry 3x at 30s intervals on delivery failure, then mark `notification_delivered: false` on the session and log to the event bus
    - _Requirements: 6.3, 6.5, 6.6, 6.7_

  - [ ] 11.2 Implement 10-minute timeout watchdog
    - If a session remains in recibido/categorizado/texto_extraido/analizando past 10 minutes from `started_at`, transition to `timeout` and notify — implement via a scheduled check (EventBridge rule invoking a small Lambda) rather than per-message visibility timeout tricks, since the 10-minute budget spans multiple queue hops
    - _Requirements: 6.5_

  - [ ]* 11.3 Write property test: no session exceeds the timeout budget silently
    - **Property: Timeout enforcement**
    - Simulate sessions with arbitrary elapsed times; verify any session past 10 minutes without reaching a terminal state is caught by the watchdog
    - **Validates: Requirements 6.5**

- [ ] 12. JSON schema, parser, and pretty-printer (independent — can be built in parallel with tasks 3-11)
  - [ ] 12.1 Implement `report-schema.ts` as a pure module (no AWS SDK imports)
    - Zod schema for `ReporteCumplimiento` matching Requirement 8.1's field list exactly (metadata, executive summary ≤1000 chars, compliance_level enum, findings array ≤10000, recommendations array ≤10000 each ≤500 chars)
    - `parseReporteCumplimiento(json: string)`: reject non-JSON or >10MB input immediately without schema validation (Requirement 8.4); on valid JSON, validate against schema and return every violation with field name, violation kind, and offending value (Requirement 8.3); complete within 5s for inputs up to 10MB (Requirement 8.2)
    - `prettyPrintReporteCumplimiento(report)`: 2-space indent, alphabetically-sorted keys, UTF-8
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 12.2 Write property test: pretty-print round-trip is byte-identical
    - **Property 10: Round-trip correctness**
    - **This is the highest-value property test in the entire spec.** Generate arbitrary valid `ReporteCumplimiento` objects (via a `fc.record` arbitrary respecting all the schema's bounds), verify `prettyPrint(parse(prettyPrint(x)))` produces byte-identical output to `prettyPrint(x)`
    - **Validates: Requirements 8.6**

  - [ ]* 12.3 Write property test: parser rejects malformed input with precise diagnostics
    - **Property 11: Parser error precision**
    - Generate arbitrary schema violations (missing fields, wrong types, out-of-range values); verify every violation is reported with the correct field/kind/value
    - **Validates: Requirements 8.3**

  - [ ] 12.4 Implement `GET /worksafebc-agent/sessions/{id}/report/export?format=json`
    - Use `prettyPrintReporteCumplimiento` for the JSON export path; complete within 30s (Requirement 4.5, trivially satisfied for a pure serialization but keep the budget in mind if this later wraps the PDF path too)
    - _Requirements: 4.5_

  - [ ] 12.5 PDF export — **BLOCKED on design.md Open Question 2**
    - Depends on user decision: server-side PDF rendering (new dependency) vs. styled HTML + client-side print-to-PDF
    - _Requirements: 4.5_

- [ ] 13. Checkpoint — Backend complete, all property tests passing

- [ ] 14. Frontend: Admin Portal components
  - [ ] 14.1 Create `UploadDocumentModal` component
    - `packages/admin-portal/src/features/worksafebc-agent/UploadDocumentModal.tsx` — file picker with client-side size/type hint, category selector shown after upload accepted, following the collocated feature-module pattern already established (`src/features/report-validation/`, `src/features/certifications/`)
    - _Requirements: 1.1, 1.5_

  - [ ] 14.2 Create `AnalysisProgress` component
    - Shows current pipeline stage (carga, extracción, análisis, generación de reporte) with a progress indicator, polling `GET /worksafebc-agent/sessions/{id}` — reuse the polling hook pattern from `report-validation`'s `useValidationPolling.ts`
    - Updates displayed info within 10s of each backend state change
    - _Requirements: 6.4_

  - [ ] 14.3 Create `AnalysisSessionList` page
    - Paginated table (20/page default, configurable to 100), filters for site/category/compliance_level/date range, empty state that preserves active filters
    - _Requirements: 5.2, 5.3, 5.7_

  - [ ] 14.4 Create `ComplianceReportView` component
    - Displays findings with severity/type filtering and sorting, executive summary, recommendations; loads within 5s for reports with up to 200 findings
    - "Re-analyze" action calling the reanalyze endpoint; grouped chronological view of all sessions sharing a `document_group_id` for visual comparison
    - _Requirements: 4.6, 5.5_

  - [ ] 14.5 Create `RegulatoryKBAdmin` page (platform_admin only)
    - Form to publish a new regulatory version (effective date + clauses), list of published versions with change summaries
    - _Requirements: 7.3, 7.6_

  - [ ]* 14.6 Write component tests for `AnalysisProgress` and `ComplianceReportView`
    - Cover: progress bar reflects each of the 4 stages, findings sort/filter by severity and type, empty-report state ("no se identificaron brechas")
    - _Requirements: 4.7, 6.4_

- [ ] 15. Final checkpoint — Ensure all tests pass
  - Run full backend + frontend test suites, confirm no TypeScript/ESLint regressions in the extended `report-validation` package, ask the user if the 3 open design questions were resolved as assumed

## Notes

- Tasks marked with `*` are optional/skippable for a faster MVP, per this project's convention, but Property 10 (12.2, round-trip) is strongly recommended to keep given how cheap it is relative to the bug classes it catches in a hand-written serializer.
- This spec deliberately extends `report-validation` rather than creating a new Lambda service — see design.md's "Key Design Decision." Do not create a new top-level service directory for this feature.
- Three items are explicitly blocked on user decisions before implementation: task 2 (checkpoint, 3.6 vs 4.9 rule), task 11 (notification channel), task 12.5 (PDF export approach). Surface these to the user at the start of the work session, not discovered mid-implementation.
- Property-based tests use `fast-check`, already a project dependency.
- Regulatory content for task 3.5 (seeding OHSR Parts 4/11/13/18/20/21) is a content-sourcing task, not pure engineering — flag it early since it may have its own lead time independent of code.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3.1", "4.1", "6.1", "12.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "4.2", "4.3", "4.4", "6.2", "12.2", "12.3"] },
    { "id": 4, "tasks": ["5", "7.1"] },
    { "id": 5, "tasks": ["7.2", "8.1", "8.2"] },
    { "id": 6, "tasks": ["8.3", "8.4", "8.5"] },
    { "id": 7, "tasks": ["8.6", "12.4", "12.5"] },
    { "id": 8, "tasks": ["8.7", "9"] },
    { "id": 9, "tasks": ["10.1", "10.3", "10.4", "10.5", "11.1"] },
    { "id": 10, "tasks": ["10.2", "11.2", "13"] },
    { "id": 11, "tasks": ["11.3", "14.1", "14.2", "14.3", "14.5"] },
    { "id": 12, "tasks": ["14.4", "14.6"] },
    { "id": 13, "tasks": ["15"] }
  ]
}
```
