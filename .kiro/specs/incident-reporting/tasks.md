# Implementation Plan: Incident Reporting Module

## Overview

This plan implements the Incident Reporting module for ClearSite — covering infrastructure (DynamoDB tables, S3 bucket, EventBridge rules), backend services (incident-service Lambda, regulatory engine, export handler), and frontend components (React feature module in admin portal). Tasks are ordered by dependency: infrastructure and types first, then backend core logic, regulatory engine, frontend components, and finally integration wiring.

## Tasks

- [x] 1. Set up infrastructure, types, and validation schemas
  - [x] 1.1 Create TypeScript types and enums
    - Create `src/services/incidents/types.ts` with all enums (`IncidentType`, `OperationalSeverity`, `RegulatoryFlag`, `IncidentStatus`, `ExternalReportStatus`, `InvolvementType`, `OshaRecordability`, `OshaCaseOutcome`, `TimelineEventType`) and interfaces (`RegulatoryIndicators`, `IncidentRecord`, `InvolvedPerson`, `IncidentAttachment`, `IncidentComment`, `TimelineEvent`, `WorkSafeBCEmployerReport`, `OshaRecordingData`, `RegulatoryEvaluationInput`, `RegulatoryEvaluationResult`, `RegulatorySuggestion`, `RegulatoryDeadline`)
    - _Requirements: 2.1, 3.1, 3.3, 4.1, 4.2, 5.1, 6.1, 11.1, 11.2, 13.1, 15.1, 16.1_

  - [x] 1.2 Create Zod validation schemas
    - Create `src/services/incidents/validators.ts` with schemas: `incidentCreateSchema`, `incidentUpdateSchema`, `commentSchema`, `closureSchema`, `reopenSchema`, `createAttachmentSchema`, `regulatoryIndicatorsSchema`, `personSchema`, `regulatoryDataSchema`
    - Define constants: `ALLOWED_EVIDENCE_TYPES`, `MAX_FILE_SIZE` (50 MB), `MAX_VIDEO_DURATION_SECONDS` (60)
    - Include refinement for "Other" incident type requiring description >= 10 chars
    - _Requirements: 1.3, 2.2, 2.3, 3.1, 12.1, 12.2, 12.3, 14.4, 19.1, 20.1_

  - [x] 1.3 Create DynamoDB table definitions (IaC)
    - Define `Incidents` table with PK (`TENANT#{tenant_id}`), SK (`INCIDENT#{incident_id}`), GSI1 (by site), GSI2 (by status), GSI3 (by regulatory flag)
    - Define `IncidentTimeline` append-only table with PK (`INCIDENT#{incident_id}`), SK (`EVENT#{timestamp}#{event_id}`)
    - Define `IncidentRegulatoryData` table with PK (`INCIDENT#{incident_id}`), SK (`REGDATA#{type}`)
    - _Requirements: 15.3_

  - [x] 1.4 Create S3 bucket and EventBridge rule definitions (IaC)
    - Define S3 bucket `incident-evidence` with lifecycle rules and CORS for presigned PUT uploads
    - Define EventBridge rules for `incident.created`, `incident.updated`, `regulatory.immediate_notification` events
    - Define EventBridge Scheduler IAM role for deadline-based notifications
    - _Requirements: 12.4, 18.1, 18.2, 18.3_

  - [x] 1.5 Create API Gateway route definitions
    - Define all `/incidents/*` routes with Cognito authorizer as specified in the design (23 routes total)
    - _Requirements: 21.4_

- [x] 2. Implement backend core logic (incident-service)
  - [x] 2.1 Implement state machine module
    - Create `src/services/incidents/state-machine.ts` with `VALID_TRANSITIONS` map, `isValidTransition(from, to)`, and `getValidTransitions(from)` functions
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 2.2 Write property test for state machine (Property 5)
    - Create `src/services/incidents/__tests__/stateMachine.property.test.ts`
    - **Property 5: State transition validity is determined by the transition map**
    - For any pair of statuses, `isValidTransition` returns true iff pair is in VALID_TRANSITIONS; `getValidTransitions` returns exactly the allowed targets
    - **Validates: Requirements 5.2, 5.4**

  - [x] 2.3 Implement timeline repository
    - Create `src/services/incidents/timeline-repository.ts` with `appendEvent(event: TimelineEvent)` and `getTimeline(incidentId: string)` using the shared `dynamo-client`
    - Ensure NO update or delete operations are exposed (append-only)
    - _Requirements: 15.1, 15.2, 15.3_

  - [x] 2.4 Implement incident repository
    - Create `src/services/incidents/incident-repository.ts` with CRUD operations: `createIncident`, `getIncident`, `updateIncident`, `listIncidents` (with GSI queries for by-site, by-status, by-regulatory-flag), `listByTenant`
    - Use shared `dynamo-client` and implement tenant isolation in all queries
    - _Requirements: 1.1, 3.4, 21.5_

  - [x] 2.5 Implement incident-service handler (CRUD routes)
    - Create `src/services/incidents/handler.ts` with route matching for all 23 API routes
    - Implement POST `/incidents` (create with validation, regulatory eval, audit trail)
    - Implement GET `/incidents` (list with role-based filtering), GET `/incidents/{id}` (detail)
    - Implement PATCH `/incidents/{id}` (update fields with audit trail)
    - Use shared `rbac` utility for permission checks and `audit-trail` for timeline entries
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.4, 21.1, 21.2, 21.3, 21.4, 21.5_

  - [x] 2.6 Implement state transition, severity, and regulatory flag endpoints
    - Implement PATCH `/incidents/{id}/state` with state machine validation and audit
    - Implement PATCH `/incidents/{id}/severity` with audit trail
    - Implement PATCH `/incidents/{id}/regulatory-flag` with audit trail; generate Immediate_Notification_Alert within 5 seconds when flag is "immediately_reportable"
    - Implement PATCH `/incidents/{id}/external-status` with audit trail and role restriction (tenant_admin, cso only)
    - _Requirements: 4.3, 4.4, 5.2, 5.3, 5.4, 16.1, 16.2_

  - [x] 2.7 Implement comments and persons involved endpoints
    - Implement POST `/incidents/{id}/comments` with validation (non-empty, max 5000 chars) and audit
    - Implement GET `/incidents/{id}/comments` returning chronological order
    - Implement POST `/incidents/{id}/persons` with validation and audit
    - Implement DELETE `/incidents/{id}/persons/{personId}` with audit
    - _Requirements: 13.1, 13.2, 13.3, 14.1, 14.2, 14.3, 14.4_

  - [x] 2.8 Implement attachments endpoint with S3 presigned URLs
    - Implement POST `/incidents/{id}/attachments` — validate MIME type, size; generate presigned PUT URL; return attachment_id and upload_url
    - Implement PATCH `/incidents/{id}/attachments/{attachId}/confirm` — mark confirmed, record audit
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 2.9 Implement closure and reopening endpoints
    - Implement POST `/incidents/{id}/close` — validate status is "Resolved", require resolution_notes >= 20 chars, transition to "Closed", record audit
    - Implement POST `/incidents/{id}/reopen` — validate status is "Closed", require justification >= 20 chars, transition to "Open", record audit
    - Restrict closure to tenant_admin/cso roles
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 20.1, 20.2, 20.3, 21.2_

  - [x] 2.10 Write property tests for validation schemas (Properties 2, 3, 4, 8, 9, 10, 11)
    - Create `src/services/incidents/__tests__/validation.property.test.ts`
    - **Property 2: Missing mandatory fields are rejected with field identification**
    - **Property 3: "Other" incident type requires description >= 10 chars**
    - **Property 4: Regulatory indicators default to false when omitted**
    - **Property 8: Attachment validation accepts valid files and rejects invalid ones**
    - **Property 9: Empty or whitespace-only comments are rejected**
    - **Property 10: Closure requires resolution notes >= 20 chars**
    - **Property 11: Reopen requires justification >= 20 chars**
    - **Validates: Requirements 1.3, 2.3, 3.1, 3.3, 12.1, 12.2, 12.3, 14.4, 19.1, 19.2, 20.1, 20.3**

  - [x] 2.11 Write property test for incident creation initial state (Property 1)
    - Create `src/services/incidents/__tests__/incidentCreation.property.test.ts`
    - **Property 1: Incident creation produces correct initial state**
    - For any valid mandatory fields, created incident has status "open", valid UUID v4, ISO 8601 UTC timestamp
    - **Validates: Requirements 1.1**

- [x] 3. Implement regulatory evaluation engine
  - [x] 3.1 Implement regulatory engine module
    - Create `src/services/incidents/regulatory-engine.ts` with `evaluateRegulatory(input: RegulatoryEvaluationInput): RegulatoryEvaluationResult`
    - Implement OSHA rules: fatality → 8h deadline, hospitalization/amputation/loss_of_eye → 24h deadline, medical_treatment/lost_time → recordable
    - Implement WorkSafeBC rules: fatality/structural_collapse/hazardous_substance/fire_explosion → immediate, medical_treatment/lost_time → 72h deadline
    - Implement `computeDeadline(referenceTime: string, hours: number): string` utility
    - Return `regulatory_flag`, `suggestions[]`, `deadlines[]`, `applied_rules[]`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 3.2 Implement deadline scheduler module
    - Create `src/services/incidents/deadline-scheduler.ts` with `createDeadlineSchedule(incidentId, deadline: RegulatoryDeadline)` and `cancelSchedule(scheduleId)`
    - Use EventBridge Scheduler SDK to create one-time schedules that trigger notification-service at deadline time
    - _Requirements: 7.1, 18.2_

  - [x] 3.3 Implement notification event publishing
    - Wire incident-service to publish events via shared `event-publisher`: `incident.created`, `incident.updated`, `regulatory.immediate_notification`
    - Implement notification-service handler to determine recipients by severity/role and send via SNS
    - Record notification sent in timeline
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

  - [x] 3.4 Write property tests for regulatory engine (Properties 6, 7, 13, 14)
    - Create `src/services/incidents/__tests__/regulatoryEngine.property.test.ts`
    - **Property 6: OSHA rules** — fatality → 8h deadline + immediately_reportable; hospitalization/amputation/loss_of_eye → 24h; medical_treatment/lost_time → osha_recordable
    - **Property 7: WorkSafeBC rules** — fatality/structural_collapse/hazardous_substance/fire_explosion → immediate; medical_treatment/lost_time → 72h
    - **Property 13: No indicators active → internal_only, empty deadlines, osha_recordable=false**
    - **Property 14: Deadline computation** — computeDeadline returns timestamp exactly N hours after reference
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

- [x] 4. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement export and regulatory data endpoints
  - [x] 5.1 Implement regulatory data endpoints
    - Implement POST `/incidents/{id}/regulatory-data` — save OSHA/WorkSafeBC form data to IncidentRegulatoryData table
    - Implement GET `/incidents/{id}/regulatory-data` — retrieve regulatory form data
    - Implement GET `/incidents/{id}/worksafebc-summary` — generate WorkSafeBC emergency summary view with missing field indicators
    - Validate completeness before marking as ready; allow draft saves without full validation
    - _Requirements: 8.1, 8.3, 9.1, 9.2, 9.3, 10.1, 10.4_

  - [x] 5.2 Implement export handler
    - Create `src/services/incidents/export-handler.ts`
    - Implement POST `/incidents/export` — generate UTF-8 CSV with filtered incidents, include metadata (generation date, period, filters, user)
    - Implement OSHA Form 300 CSV export for recordable incidents by calendar period
    - Implement POST `/incidents/{id}/worksafebc-summary/export` — generate PDF with summary data
    - Implement GET `/incidents/osha-300a` — calculate annual summary totals by outcome category
    - _Requirements: 10.3, 17.1, 17.2, 17.3, 17.4_

  - [x] 5.3 Write unit tests for export handler
    - Create `src/services/incidents/__tests__/export.test.ts`
    - Test CSV generation with known data, PDF structure, OSHA 300A calculations
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

- [x] 6. Implement frontend feature module structure and hooks
  - [x] 6.1 Create frontend types, schemas, and constants
    - Create `src/features/incidents/types.ts` mirroring backend enums/interfaces for frontend use
    - Create `src/features/incidents/schemas.ts` with Zod schemas for client-side validation (incidentCreateSchema, commentSchema, closureSchema, reopenSchema)
    - Create `src/features/incidents/constants.ts` with allowed evidence types, size limits, state transition labels
    - Create `src/features/incidents/index.ts` barrel export
    - _Requirements: 2.1, 3.1, 5.1, 12.1_

  - [x] 6.2 Create custom hooks for API communication
    - Create `src/features/incidents/hooks/useIncidents.ts` — list with filters/pagination, role-based filtering
    - Create `src/features/incidents/hooks/useIncident.ts` — single incident detail
    - Create `src/features/incidents/hooks/useCreateIncident.ts` — create mutation
    - Create `src/features/incidents/hooks/useUpdateIncident.ts` — update mutation with optimistic updates
    - Create `src/features/incidents/hooks/useStateTransition.ts` — state change with optimistic update and rollback
    - Create `src/features/incidents/hooks/useIncidentTimeline.ts` — timeline query
    - Create `src/features/incidents/hooks/useIncidentComments.ts` — comments CRUD with optimistic append
    - Create `src/features/incidents/hooks/useEvidenceUpload.ts` — S3 upload with progress (reuse pattern from certifications)
    - Create `src/features/incidents/hooks/useRegulatoryData.ts` — regulatory form data CRUD
    - _Requirements: 1.1, 5.3, 12.4, 14.1, 14.2, 15.2_

- [x] 7. Implement frontend UI components (core)
  - [x] 7.1 Create IncidentCreateForm component
    - Create `src/features/incidents/IncidentCreateForm.tsx` — multi-step form with react-hook-form + zodResolver
    - Include all mandatory fields, regulatory indicators (boolean toggles defaulting to false), severity selector, jurisdiction selector (if site has no configured jurisdiction)
    - Responsive design adapting to 320px minimum width; support camera capture via media capture API on mobile
    - _Requirements: 1.1, 1.3, 2.2, 3.1, 3.2, 3.3, 22.1, 22.2, 22.3, 23.3_

  - [x] 7.2 Create IncidentListPage component
    - Create `src/features/incidents/IncidentListPage.tsx` using DataTable with filters (by status, severity, regulatory flag, site, date range)
    - Display status badges, severity badges, regulatory flag indicators, external report status warning indicator
    - Integrate `useIncidents` hook with loading skeleton, error state with retry, empty state
    - _Requirements: 1.1, 4.1, 4.2, 16.3, 21.5_

  - [x] 7.3 Create StateTransitionButton component
    - Create `src/features/incidents/StateTransitionButton.tsx` — shows dropdown of valid transitions from current state
    - Wire to `useStateTransition` hook; show toast with valid transitions on 422 error
    - _Requirements: 5.2, 5.3, 5.4_

  - [x] 7.4 Create TimelineView component
    - Create `src/features/incidents/TimelineView.tsx` — chronological display of all audit events
    - Render event type icon, actor name, change data, and UTC timestamp for each entry
    - _Requirements: 15.1, 15.2_

  - [x] 7.5 Create RegulatoryAlertBanner component
    - Create `src/features/incidents/RegulatoryAlertBanner.tsx` — fixed-position warning banner with warning-colored background
    - Display: reason for alert, jurisdiction (OSHA/WorkSafeBC), detection time, viewing confirmation user, external report follow-up status
    - Record first-view confirmation via API
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 7.6 Create LegalDisclaimer component
    - Create `src/features/incidents/LegalDisclaimer.tsx` — displays regulatory disclaimer text
    - Require session-level acknowledgment on first access to regulatory evaluation functionality
    - Display in regulatory evaluation view, Immediate_Notification_Alert, and as footer in exports
    - _Requirements: 24.1, 24.2, 24.3_

- [x] 8. Implement frontend UI components (detail page and panels)
  - [x] 8.1 Create EvidenceUpload component
    - Create `src/features/incidents/EvidenceUpload.tsx` — file upload with drag-and-drop, progress bar, client-side validation (type, size)
    - Support camera capture on mobile via browser media capture API
    - Show file type/size rejection messages inline
    - Wire to `useEvidenceUpload` hook with single retry on failure
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 22.2_

  - [x] 8.2 Create PersonsInvolvedPanel component
    - Create `src/features/incidents/PersonsInvolvedPanel.tsx` — add/remove persons with role selection (injured_worker, witness, supervisor_present, associated_contractor)
    - Capture: full name (mandatory), involvement type (mandatory), organization (mandatory), worker_id (optional, linkable)
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 8.3 Create CommentsSection component
    - Create `src/features/incidents/CommentsSection.tsx` — chronological comments display with add form
    - Validate non-empty content (max 5000 chars); show inline error on failure; preserve text on submission error
    - Wire to `useIncidentComments` hook with optimistic append
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 8.4 Create RegulatoryDataForm component
    - Create `src/features/incidents/RegulatoryDataForm.tsx` — tabbed form for OSHA (Form 300/301 fields) and WorkSafeBC (employer report, emergency summary)
    - Support draft saves without full validation; indicate missing fields visually
    - Show OSHA recordability classification selector with consistency check against boolean indicators
    - Include LegalDisclaimer component
    - _Requirements: 8.1, 8.3, 9.1, 9.2, 9.3, 10.1, 10.2, 10.4, 11.1, 11.2, 11.3_

  - [x] 8.5 Create ExportPanel component
    - Create `src/features/incidents/ExportPanel.tsx` — export options: operational CSV, OSHA Form 300 CSV, WorkSafeBC PDF summary, regulatory report summary
    - Include filter selection (date range, status, site) and show generation metadata
    - Include LegalDisclaimer as footer in regulatory exports
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 24.2_

  - [x] 8.6 Create IncidentDetailPage component
    - Create `src/features/incidents/IncidentDetailPage.tsx` — tabbed layout (Details, Timeline, Regulatory, Evidence, Comments)
    - Integrate: StateTransitionButton, RegulatoryAlertBanner (if applicable), TimelineView, EvidenceUpload, PersonsInvolvedPanel, CommentsSection, RegulatoryDataForm, ExportPanel
    - Include closure dialog (resolution notes >= 20 chars) and reopen dialog (justification >= 20 chars)
    - Show external report status warning indicator in header when status is "external report pending"
    - _Requirements: 5.2, 7.1, 15.2, 16.3, 19.1, 19.2, 20.1, 20.3_

- [x] 9. Checkpoint - Ensure all frontend components render correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Integrate frontend routing, RBAC, and wire end-to-end
  - [x] 10.1 Add incident routes to app router
    - Add routes to `src/app/router.tsx`: `/incidents` (list), `/incidents/new` (create), `/incidents/:id` (detail)
    - Add "Incidents" entry to Sidebar navigation
    - Gate routes with RBAC: creation for tenant_admin/site_admin/supervisor/cso/authorized_contractor; regulatory management for tenant_admin/cso; export for tenant_admin/cso/supervisor
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5_

  - [x] 10.2 Write property test for role-based visibility filtering (Property 12)
    - Create `src/services/incidents/__tests__/rbacFiltering.property.test.ts`
    - **Property 12: Role-based incident visibility filtering**
    - tenant_admin/cso see all tenant incidents; site_admin/supervisor see only assigned sites; worker/gate_operator see none
    - **Validates: Requirements 21.5**

  - [x] 10.3 Write unit tests for frontend components
    - Create `src/features/incidents/__tests__/IncidentListPage.test.tsx` — loading, error, empty states; filter interactions
    - Create `src/features/incidents/__tests__/IncidentCreateForm.test.tsx` — form submission, validation display, responsive layout
    - Create `src/features/incidents/__tests__/IncidentDetailPage.test.tsx` — tab navigation, closure/reopen dialogs
    - Create `src/features/incidents/__tests__/TimelinePanel.test.tsx` — chronological ordering, event type rendering
    - Create `src/features/incidents/__tests__/RegulatoryEvalPanel.test.tsx` — disclaimer display, deadline rendering
    - _Requirements: 1.1, 5.2, 7.1, 15.2, 22.1, 24.3_

  - [x] 10.4 Write integration tests (MSW-mocked API)
    - Create `src/features/incidents/__tests__/integration/` directory
    - Test full creation flow: form → POST → regulatory eval → navigate to detail
    - Test state transition flow: Open → Under Review → Resolved → Closed
    - Test attachment upload flow: select file → POST metadata → PUT S3 → confirm
    - Test closure and reopen flows with validation
    - Test RBAC enforcement: verify 403 for unauthorized actions
    - _Requirements: 1.1, 5.2, 12.4, 19.1, 20.1, 21.4_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (14 properties total)
- Unit tests validate specific examples and edge cases
- The project uses Vitest + fast-check for property-based testing
- All frontend components reuse existing shared UI primitives (Modal, DataTable, Badge, Button, Input, Select, ErrorDisplay, Card)
- Shared utilities used: `audit-trail`, `rbac`, `event-publisher`, `dynamo-client`
- NO Step Functions — all workflow orchestration uses Lambda + EventBridge
- Regulatory evaluation is synchronous (pure function, no external API calls)
- EventBridge Scheduler handles deadline-based notifications (8h, 24h, 72h reminders)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "3.1"] },
    { "id": 3, "tasks": ["2.5", "3.2", "3.4"] },
    { "id": 4, "tasks": ["2.6", "2.7", "2.8", "3.3"] },
    { "id": 5, "tasks": ["2.9", "2.10", "2.11"] },
    { "id": 6, "tasks": ["5.1", "5.2"] },
    { "id": 7, "tasks": ["5.3", "6.1"] },
    { "id": 8, "tasks": ["6.2"] },
    { "id": 9, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6"] },
    { "id": 10, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5"] },
    { "id": 11, "tasks": ["8.6"] },
    { "id": 12, "tasks": ["10.1", "10.2"] },
    { "id": 13, "tasks": ["10.3", "10.4"] }
  ]
}
```
