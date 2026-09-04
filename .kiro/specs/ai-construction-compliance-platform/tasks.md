# Implementation Plan: AI Construction Compliance Platform

## Overview

This implementation plan delivers the AI Construction Compliance Platform incrementally: monorepo setup and infrastructure first, then core backend services, AI pipeline, supporting services, admin portal, landing page, and finally CI/CD pipelines. Each task builds on previous work, ensuring no orphaned code. The mobile app is paused and excluded from this plan.

## Tasks

- [x] 1. Monorepo setup, shared utilities, and CDK infrastructure
  - [x] 1.1 Initialize monorepo with pnpm workspace
    - Create root `package.json` with workspace scripts (dev:portal, dev:landing, build:backend, build:portal, build:landing, test, lint, deploy:dev, deploy:prod)
    - Create `pnpm-workspace.yaml` with `packages/*` configuration
    - Create `tsconfig.base.json` with shared TypeScript settings (strict mode, ES2022 target, Node20 module resolution)
    - Create `.eslintrc.js` with shared ESLint config
    - Create `.prettierrc` for consistent formatting
    - Initialize `packages/backend/package.json` with dependencies (@aws-sdk/*, zod, uuid, fast-check, esbuild, aws-cdk-lib, vitest)
    - Initialize `packages/admin-portal/package.json` with dependencies (react, react-dom, react-router-dom, @tanstack/react-query, @tanstack/react-table, zustand, react-hook-form, zod, tailwindcss, vite, vitest)
    - Initialize `packages/landing-page/package.json` with dependencies (react, react-dom, tailwindcss, vite)
    - _Requirements: 18.1, 18.2_

  - [x] 1.2 Create backend shared utilities layer
    - Create `packages/backend/src/shared/dynamo-client.ts` — DynamoDB document client initialization with environment-aware table prefix
    - Create `packages/backend/src/shared/event-publisher.ts` — SNS/SQS publish helper with PlatformEvent schema (event_id, event_type, source_service, tenant_id, timestamp, payload, correlation_id, version)
    - Create `packages/backend/src/shared/auth-middleware.ts` — JWT validation middleware extracting tenant_id, user_id, role from Cognito JWT claims
    - Create `packages/backend/src/shared/rbac.ts` — Role-based access control enforcement with permission matrix (platform_admin, tenant_admin, site_admin, supervisor, cso, gate_operator, worker)
    - Create `packages/backend/src/shared/error-handler.ts` — Consistent error response formatting (code, message, request_id, timestamp, details)
    - Create `packages/backend/src/shared/logger.ts` — Structured JSON logging with correlation_id propagation
    - Create `packages/backend/src/shared/validators.ts` — Zod schemas for common validations (E.164 phone, UUID, ISO 8601 timestamps, pagination params)
    - Create `packages/backend/src/shared/types/events.ts` — TypeScript interfaces for all platform events (WorkerCreated, CertificationExpired, AccessDecisionGenerated, etc.)
    - Create `packages/backend/src/shared/types/decisions.ts` — DecisionRequest, DecisionResponse, ExplainabilityPayload interfaces
    - Create `packages/backend/src/shared/types/common.ts` — Shared enums (DecisionResult, CertificationType, Severity, FindingStatus, etc.)
    - _Requirements: 1.2, 11.4, 14.1, 14.3, 18.15, 18.16_

  - [x] 1.3 Create CDK infrastructure — data stack (DynamoDB tables)
    - Create `packages/backend/infra/lib/data-stack.ts` defining all 26 DynamoDB tables with partition keys, sort keys, GSIs, and TTL attributes as specified in the design
    - Tables: Tenants, Workers, Certifications, Contractors, ContractorWorkers, Sites, Policies, PolicyVersions, DecisionRecords, AccessTokens, ScanSessions, EnforcementActions, OverrideRequests, RevalidationAttempts, Inspections, MediaAssets, DetectionResults, SceneInterpretations, Findings, DailyComplianceSummaries, AuditTrail, LeadCaptures, Users, Sessions, DeviceCache, OfflineQueue, RateLimits
    - Environment-aware table naming (dev- prefix for dev environment)
    - On-demand capacity mode for all tables
    - _Requirements: 18.6, 12.5, 14.4_

  - [x] 1.4 Create CDK infrastructure — auth stack (Cognito)
    - Create `packages/backend/infra/lib/auth-stack.ts` defining Cognito User Pool with custom attributes (custom:tenant_id, custom:role, custom:assigned_sites)
    - Configure password policy, MFA (TOTP), SMS OTP for workers
    - Configure JWT token lifetime (60 minutes)
    - Create Cognito Authorizer for API Gateway integration
    - _Requirements: 14.3, 14.6, 18.15_

  - [x] 1.5 Create CDK infrastructure — events stack (SQS/SNS)
    - Create `packages/backend/infra/lib/events-stack.ts` defining SNS topics and SQS queues
    - Queues: ai-pipeline-queue, cert-expiry-queue, notification-queue, reporting-queue
    - Dead-letter queues for each processing queue (maxReceiveCount: 3)
    - Environment-aware naming (dev- prefix)
    - _Requirements: 11.1, 11.4, 11.7, 18.5, 18.8, 18.14_

  - [x] 1.6 Create CDK infrastructure — storage stack (S3)
    - Create `packages/backend/infra/lib/storage-stack.ts` defining S3 buckets
    - Buckets: media-assets (inspection images, certification docs), audit-storage (immutable decision records)
    - Configure CORS for signed URL uploads, lifecycle policies, versioning on prod
    - Environment-aware naming
    - _Requirements: 18.4, 14.4, 14.5_

  - [x] 1.7 Create CDK infrastructure — API and Lambda stack
    - Create `packages/backend/infra/lib/api-stack.ts` defining API Gateway REST API with Cognito authorizer
    - Define Lambda functions for all 11 services with environment-specific memory and concurrency limits
    - Configure Lambda timeout (29s for API-triggered, 900s for async)
    - Wire API Gateway routes to Lambda handlers
    - Environment variables: ENVIRONMENT, TABLE_PREFIX, SQS_QUEUE_URL, SNS_TOPIC_ARN
    - _Requirements: 18.1, 18.2, 18.9, 18.12, 18.13_

  - [x] 1.8 Create CDK infrastructure — monitoring stack
    - Create `packages/backend/infra/lib/monitoring-stack.ts` defining CloudWatch alarms and dashboards
    - Alarms: Lambda errors, DLQ message count, API Gateway 5xx rate, Lambda duration > 10s
    - Log groups with environment-prefixed naming
    - _Requirements: 18.7, 18.14_

  - [x] 1.9 Create CDK app entry point and synthesize
    - Create `packages/backend/infra/bin/app.ts` composing all stacks with environment context
    - Create `packages/backend/infra/cdk.json` with context configuration
    - Create `packages/backend/esbuild.config.ts` for Lambda bundling
    - Verify `cdk synth` produces valid CloudFormation
    - _Requirements: 18.1, 18.2_

- [x] 2. Checkpoint — Ensure infrastructure synthesizes correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Identity Service and Policy Service
  - [x] 3.1 Implement Policy Service — CRUD and version management
    - Create `packages/backend/src/services/policy/handler.ts` — Lambda handler for policy endpoints
    - Create `packages/backend/src/services/policy/version-manager.ts` — Policy version creation with sequential numbering, effective date range validation (reject overlaps), immutability enforcement (reject modification of versions used in decisions), change_summary recording
    - Create `packages/backend/src/services/policy/types.ts` — Policy, PolicyVersion interfaces
    - Endpoints: POST /policies, GET /policies/{id}, POST /policies/{id}/versions, GET /policies/{id}/versions/{versionId}
    - Publish SitePolicyPublished event on new version
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.8_

  - [ ]* 3.2 Write property tests for Policy Service
    - **Property 3: Policy version sequential numbering** — Verify version numbers are strictly monotonically increasing for any policy
    - **Property 4: Policy version date range non-overlap** — Verify overlapping date ranges are rejected
    - **Property 6: Policy version immutability after use in decisions** — Verify versions referenced by DecisionRecords cannot be modified
    - **Validates: Requirements 2.1, 2.2, 2.7**

  - [x] 3.3 Implement Identity Service — Worker management
    - Create `packages/backend/src/services/identity/handler.ts` — Lambda handler for worker and certification endpoints
    - Create `packages/backend/src/services/identity/worker.ts` — Worker CRUD (legal_name max 150, preferred_name max 100, phone E.164 max 15 digits, language en|es|pa)
    - Create `packages/backend/src/services/identity/certification.ts` — Certification upload with validation (type, issuer max 200, issue_date, expiry_date, document max 10MB, formats PDF/JPEG/PNG), status state machine (pending→validated, pending→rejected, rejected→pending, any→expired), date validation (expiry > issue)
    - Create `packages/backend/src/services/identity/types.ts` — WorkerIdentity, Certification interfaces
    - Endpoints: POST /workers, GET /workers/{id}, PATCH /workers/{id}, POST /workers/{id}/certifications, GET /workers/{id}/certifications, PATCH /workers/{id}/certifications/{certId}
    - Publish WorkerCreated, CertificationUploaded events
    - Generate S3 signed URLs for document uploads (15-min expiry)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.9, 14.5_

  - [ ]* 3.4 Write property tests for Identity Service
    - **Property 7: Certification status state machine** — Verify only valid transitions are allowed (pending→validated, pending→rejected, rejected→pending, any→expired)
    - **Property 8: Certification date validation** — Verify expiry_date ≤ issue_date is rejected, expiry_date > issue_date passes
    - **Property 20: Worker data round-trip** — Verify creating and retrieving a worker returns identical field values
    - **Validates: Requirements 3.5, 3.9, 3.1**

  - [x] 3.5 Implement scheduled certification expiry checker
    - Create `packages/backend/src/scheduled/cert-expiry-checker.ts` — Daily Lambda (00:00 UTC) that scans Certifications GSI1 for expired certs, updates status to expired, publishes CertificationExpired events
    - _Requirements: 3.6, 3.7, 11.2_

- [x] 4. Access Service and Compliance Decision Engine
  - [x] 4.1 Implement Compliance Decision Engine — core evaluation
    - Create `packages/backend/src/services/decision-engine/handler.ts` — Lambda handler for decision evaluation (sync API + async SQS consumer)
    - Create `packages/backend/src/services/decision-engine/evaluator.ts` — Core evaluation logic: validate inputs (return error naming missing inputs), resolve active PolicyVersion for site+jurisdiction, evaluate worker certifications against policy requirements, produce decision (allowed|conditional|denied|manual_review_required), generate reasons (max 5, each max 500 chars), store rule_snapshot_json
    - Create `packages/backend/src/services/decision-engine/explainability.ts` — Generate ExplainabilityPayload (decision, type, timestamp, reasons, rule_references, evidence_references, policy_version_references), block finalization if payload incomplete
    - Create `packages/backend/src/services/decision-engine/types.ts` — DecisionRequest, DecisionResponse, ExplainabilityPayload interfaces
    - Store DecisionRecords as append-only (never update)
    - Publish AccessDecisionGenerated event
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 12.1, 12.3, 12.6_

  - [ ]* 4.2 Write property tests for Decision Engine
    - **Property 1: Decision output structural validity** — Verify output contains valid decision result, non-empty policy_version_used, at least one reason per rule (max 500 chars), valid UTC timestamp, jurisdiction
    - **Property 2: Decision error on incomplete inputs** — Verify error response names exactly the set of missing inputs
    - **Property 9: Access denial correctness** — Verify workers not meeting requirements are denied with specific unmet requirement names
    - **Property 15: Explainability payload completeness** — Verify finalized decisions have complete explainability payloads
    - **Property 17: Explainability blocks on incomplete evidence** — Verify decisions cannot finalize without complete evidence
    - **Validates: Requirements 1.2, 1.3, 1.5, 1.6, 4.2, 4.3, 12.1, 12.6**

  - [x] 4.3 Implement Access Service — token management and scan sessions
    - Create `packages/backend/src/services/access/handler.ts` — Lambda handler for access endpoints
    - Create `packages/backend/src/services/access/token-manager.ts` — AccessToken generation (TTL max 10 min), token types (qr_session, sms_magic_link, gate_pass), expiry validation, revocation (reject within 5s), device binding
    - Create `packages/backend/src/services/access/scan-session.ts` — ScanSession recording (worker, site, timestamp, scanner_type, device_id, token_ref, decision_ref, result), QR replay detection (same token reused or different device → replay_risk_flag + deny)
    - Create `packages/backend/src/services/access/types.ts` — AccessToken, ScanSession interfaces
    - Endpoints: POST /access/request, POST /access/scan, GET /access/decisions/{id}, POST /access/tokens, DELETE /access/tokens/{id}, POST /access/revalidate, POST /access/override, PATCH /access/override/{id}
    - Orchestrate: decode QR → generate token → call Decision Engine → return decision
    - If Decision Engine unavailable: deny with "system temporarily unable to evaluate"
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_

  - [ ]* 4.4 Write property tests for Access Service
    - **Property 10: Access token lifecycle** — Verify TTL ≤ 10 minutes and expired tokens are rejected
    - **Property 11: QR replay detection** — Verify reused tokens or different-device scans set replay_risk_flag and deny
    - **Validates: Requirements 4.5, 4.7, 4.9**

  - [x] 4.5 Implement decision replay and history
    - Add replay endpoint to Decision Engine: re-evaluate original inputs against the PolicyVersion active at original evaluation time, return new result alongside original
    - Add decision history query: display PolicyVersion effective at decision time (version number, effective_from, change_summary)
    - Implement explainability visibility filtering by role (worker: reasons+actions, supervisor: reasons+rule_refs, admin: full payload)
    - _Requirements: 2.5, 2.6, 12.4, 12.7_

  - [ ]* 4.6 Write property tests for replay and visibility
    - **Property 5: Decision replay determinism** — Verify replaying with original inputs and PolicyVersion produces same result
    - **Property 16: Explainability visibility filtering by role** — Verify each role sees only permitted fields
    - **Validates: Requirements 2.6, 12.4**

- [x] 5. Checkpoint — Ensure core services pass all tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. AI Pipeline Services
  - [x] 6.1 Implement AI Orchestration Service
    - Create `packages/backend/src/services/ai-orchestration/handler.ts` — Lambda handler for inspection and media endpoints
    - Create `packages/backend/src/services/ai-orchestration/pipeline.ts` — Media upload orchestration (S3 signed URL generation, metadata capture: site_id, trade, project_phase, timestamp), inspection creation, publish InspectionUploaded event to SQS AI queue
    - Create `packages/backend/src/services/ai-orchestration/types.ts` — Inspection, MediaAsset interfaces
    - Endpoints: POST /inspections, POST /inspections/{id}/media, POST /inspections/{id}/analyze
    - Validate image: JPEG/PNG only, max 25MB, min 640×480 resolution; reject with specific error if invalid
    - _Requirements: 6.5, 6.6, 6.7, 11.3_

  - [x] 6.2 Implement Detection Layer (Bedrock Claude with vision)
    - Create `packages/backend/src/services/detection/handler.ts` — SQS consumer Lambda triggered by AI pipeline queue
    - Create `packages/backend/src/services/detection/detector.ts` — Resize image to max 1024px (longest edge), send to Bedrock (Claude 3.5 Sonnet with vision) with detection system prompt listing safety object categories (helmet, vest, harness, ladder, scaffold, trench/excavation edge, roof edge, machinery proximity, blocked exit/clutter), parse structured JSON response, filter detections below 0.5 confidence, store results in DetectionResults table with model_version
    - Create `packages/backend/src/services/detection/types.ts` — DetectionResult interface (type, confidence, boundingBox)
    - Publish DetectionCompleted event; if pipeline fails, halt and record failure stage
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.8, 11.6_

  - [x] 6.3 Implement Scene Understanding Layer (Bedrock Claude)
    - Create `packages/backend/src/services/scene-understanding/handler.ts` — SQS consumer triggered by DetectionCompleted event
    - Create `packages/backend/src/services/scene-understanding/classifier.ts` — Send detection results + image context to Bedrock with scene classification prompt, classify into scene types (work_at_height, roofing, excavation, framing, ladder_access, material_handling_near_equipment), produce scene_description (max 200 chars), activity_label, risk_context (primary hazard, exposed personnel count), confidence score (0.0–1.0), record model_version
    - Handle edge cases: if confidence < 0.5 → label "unclassified" with best candidate; if no construction objects detected → return "no construction activity detected"
    - Store in SceneInterpretations table, publish SceneClassified event
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 6.4 Implement Regulatory Mapping Layer (Bedrock Claude with WorkSafeBC context)
    - Create `packages/backend/src/services/regulatory-mapping/handler.ts` — SQS consumer triggered by SceneClassified event
    - Create `packages/backend/src/services/regulatory-mapping/mapper.ts` — Send scene + detections to Bedrock with WorkSafeBC regulation system prompt, map each detection to regulatory rules and site policies, produce: violation_flag, regulatory_basis (clause reference), site_policy_basis, severity (critical|high|medium|low), suggested_corrective_action (max 500 chars), include active PolicyVersion ID and jurisdiction
    - Create `packages/backend/src/services/regulatory-mapping/worksafe-bc-rules.ts` — WorkSafeBC OHS Regulation reference data for system prompts
    - Handle: no match → output with no violation flag; policy/jurisdiction unavailable → reject with error
    - Generate Finding via Decision Engine, store in Findings table with aiAnalysis map
    - Publish FindingGenerated event
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [ ]* 6.5 Write property tests for Finding generation
    - **Property 12: Finding initial status assignment by severity** — Verify high/critical → pending_review, low/medium → generated
    - **Validates: Requirements 9.2, 9.3**

  - [x] 6.6 Implement Finding review workflow
    - Add finding review logic to AI Orchestration or a dedicated handler
    - Finding lifecycle: generated → pending_review → confirmed/dismissed/corrected
    - Confirm: update status, record reviewer_id and timestamp
    - Dismiss: require reason ≥ 10 chars, record reviewer_id and timestamp
    - Unreviewed findings (pending_review or generated) cannot trigger EnforcementActions
    - On confirm (high/critical): create EnforcementAction of type corrective_action_required within 60s
    - Endpoints: GET /findings, GET /findings/{id}, POST /findings/{id}/review
    - Publish FindingReviewed event
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ]* 6.7 Write property tests for Finding review
    - **Property 13: Finding dismissal reason minimum length** — Verify reason < 10 chars is rejected, ≥ 10 chars accepted
    - **Property 14: Unreviewed findings cannot trigger enforcement** — Verify no EnforcementAction exists for findings with status pending_review or generated
    - **Validates: Requirements 9.5, 9.6**

- [x] 7. Enforcement, Reporting, and Notification Services
  - [x] 7.1 Implement Real-Time Enforcement Loop
    - Add enforcement logic to Decision Engine or Access Service
    - On denied/conditional decision: create EnforcementAction within 5s linked to DecisionRecord
    - Action types: deny_entry, notify_supervisor, request_updated_certification, require_manual_review_at_gate, trigger_override_workflow, create_corrective_action_task, require_rescan, escalate_to_cso
    - Revalidation: accept RevalidationAttempt (max 3 per original decision per 24h), trigger new evaluation with updated data
    - Override: create OverrideRequest (requester, reason, evidence), approve with expiration (max 90 days), original DecisionRecord remains immutable
    - Auto-escalation: if deny_entry or require_manual_review_at_gate unresolved > 30 min, escalate to next action type
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 7.2 Implement Notification Service
    - Create `packages/backend/src/services/notification/handler.ts` — SQS consumer for notification queue
    - Create `packages/backend/src/services/notification/channels/email.ts` — Amazon SES transactional email delivery
    - Create `packages/backend/src/services/notification/channels/sms.ts` — Amazon SNS direct SMS publishing
    - Create `packages/backend/src/services/notification/channels/push.ts` — SNS Mobile Push placeholder (future)
    - Create `packages/backend/src/services/notification/templates.ts` — Hardcoded notification templates for: cert expiry warnings (30/14/7 days), access decisions, enforcement actions, override requests, escalations
    - Notify assigned responsible party within 60s of EnforcementAction creation
    - _Requirements: 10.3, 11.1_

  - [x] 7.3 Implement Reporting Service
    - Create `packages/backend/src/services/reporting/handler.ts` — Lambda handler for reporting endpoints + SQS consumer for DailyComplianceSummaryRequested
    - Create `packages/backend/src/services/reporting/summary-generator.ts` — Generate Daily Compliance Summary: access decisions (allowed/conditional/denied counts), findings (generated/confirmed/dismissed counts), unresolved enforcement actions, certification compliance status, active PolicyVersions, AI narrative (summary_text, key_observations, regulatory_highlights, risk_trend, recommended_focus_areas)
    - Create `packages/backend/src/services/reporting/pdf-export.ts` — PDF report generation with AI analysis per finding
    - Create `packages/backend/src/services/reporting/csv-export.ts` — CSV export with AI analysis columns
    - Create `packages/backend/src/services/reporting/types.ts` — Report interfaces
    - Endpoints: GET /sites/{id}/daily-summary, POST /reports, GET /reports/{id}, GET /reports/{id}/export, GET /workers/{id}/compliance-summary
    - Generate within 60s of request; if no data, return zero counts with "no activity recorded"
    - Publish DailyComplianceSummaryGenerated event
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [ ]* 7.4 Write property test for Daily Summary accuracy
    - **Property 18: Daily summary count accuracy** — Verify summary counts match actual record counts in database for site and period
    - **Validates: Requirements 13.2**

  - [x] 7.5 Implement scheduled daily summary trigger
    - Create `packages/backend/src/scheduled/daily-summary-trigger.ts` — Scheduled Lambda that publishes DailyComplianceSummaryRequested event for each active site at end of day (site timezone)
    - _Requirements: 13.1_

  - [x] 7.6 Implement Contractors Service
    - Create `packages/backend/src/services/contractors/handler.ts` — Lambda handler for contractor endpoints
    - Create `packages/backend/src/services/contractors/contractor.ts` — Contractor CRUD, worker assignment/removal, compliance status calculation
    - Endpoints: POST /contractors, GET /contractors, GET /contractors/{id}, PATCH /contractors/{id}, GET /contractors/{id}/workers, POST /contractors/{id}/workers, DELETE /contractors/{id}/workers/{workerId}, GET /contractors/{id}/compliance
    - _Requirements: 17.4_

  - [x] 7.7 Implement Sync Service
    - Create `packages/backend/src/services/sync/handler.ts` — Lambda handler for sync endpoints
    - Create `packages/backend/src/services/sync/reconciler.ts` — Batch sync offline ScanSessions (chronological order), re-evaluate against policy version active at scan time, backend decision takes precedence over cached, flag stale sessions (>24h cache)
    - Endpoints: POST /sync/sessions, POST /sync/media, GET /sync/status
    - _Requirements: 15.1, 15.2, 15.3, 18.17_

  - [x] 7.8 Implement Lead Capture endpoint
    - Add POST /leads endpoint to backend — validate lead form (company_name required max 200, contact_name required max 150, email required valid format, phone optional E.164, message required max 1000), store in LeadCaptures table, return success
    - _Requirements: 16.3, 16.4, 16.5_

  - [x] 7.9 Implement tenant isolation and audit trail
    - Enforce tenant_id filtering on all DynamoDB queries across all services
    - Cross-tenant access returns 403 without revealing resource existence
    - Record audit trail entries for all admin actions (role assignments, policy changes, override approvals) with acting_user, target_resource, action, timestamp
    - Retain audit records minimum 90 days
    - _Requirements: 14.1, 14.2, 14.7, 14.8_

  - [ ]* 7.10 Write property test for tenant isolation
    - **Property 19: Tenant data isolation** — Verify requests authenticated as tenant A never return data belonging to tenant B across all resource types
    - **Validates: Requirements 14.1**

- [x] 8. Checkpoint — Ensure all backend services pass tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Admin Portal — Setup and shared components
  - [x] 9.1 Initialize Admin Portal project structure
    - Configure Vite with React 18 + TypeScript
    - Configure Tailwind CSS with `tailwind.config.ts` (custom colors, spacing for compliance UI)
    - Set up React Router v6 with route structure matching navigation tree
    - Create `packages/admin-portal/src/app/App.tsx`, `router.tsx`, `providers.tsx` (TanStack Query provider, auth provider)
    - _Requirements: 17.8, 17.9_

  - [x] 9.2 Implement Admin Portal shared services and hooks
    - Create `packages/admin-portal/src/services/api-client.ts` — Axios/fetch wrapper with JWT auth headers, tenant context, error handling
    - Create `packages/admin-portal/src/services/auth-service.ts` — Cognito authentication (login, logout, token refresh, session management)
    - Create `packages/admin-portal/src/hooks/useAuth.ts` — Auth state hook with Cognito integration
    - Create `packages/admin-portal/src/hooks/useApi.ts` — TanStack Query wrapper for API calls
    - Create `packages/admin-portal/src/hooks/useRBAC.ts` — Role-based route guards and permission checks
    - Create `packages/admin-portal/src/store/auth-store.ts` — Zustand auth state (user, role, tenant, tokens)
    - Handle session expiry: redirect to login, preserve intended destination (Req 17.10)
    - Handle inactivity timeout: 60 min → terminate session, redirect with message (Req 17.12)
    - _Requirements: 17.1, 17.10, 17.12, 14.3, 14.6_

  - [x] 9.3 Implement Admin Portal layout and UI components
    - Create `packages/admin-portal/src/components/layout/Sidebar.tsx` — Collapsible sidebar with navigation tree, role-based visibility filtering
    - Create `packages/admin-portal/src/components/layout/Header.tsx` — Top bar with user info, notifications, logout
    - Create `packages/admin-portal/src/components/layout/PageContainer.tsx` — Page wrapper with breadcrumbs
    - Create `packages/admin-portal/src/components/layout/Breadcrumbs.tsx`
    - Create `packages/admin-portal/src/components/ui/` — Button, Card, Modal, Badge, Input, Select (all Tailwind-styled, accessible)
    - Create `packages/admin-portal/src/components/data/DataTable.tsx` — TanStack Table wrapper with sorting, filtering, pagination
    - Create `packages/admin-portal/src/components/data/SearchBar.tsx`, `Filters.tsx`, `Pagination.tsx`
    - Create `packages/admin-portal/src/components/charts/` — BarChart, TrendLine, StatusBadge (Recharts)
    - _Requirements: 17.1, 17.9, 17.11_

- [x] 10. Admin Portal — Dashboard and Worker Management
  - [x] 10.1 Implement Dashboard Ejecutivo page
    - Create `packages/admin-portal/src/pages/dashboard/DashboardPage.tsx` — Executive overview landing page
    - Create `packages/admin-portal/src/pages/dashboard/RisksSummary.tsx` — Open risks widget
    - Create `packages/admin-portal/src/pages/dashboard/BlockedAccess.tsx` — Blocked access events widget
    - Create `packages/admin-portal/src/pages/dashboard/ExpiringCerts.tsx` — Certifications expiring within 30 days
    - Create `packages/admin-portal/src/pages/dashboard/RecentActivity.tsx` — Activity feed
    - Auto-refresh every 5 minutes via TanStack Query refetchInterval
    - Display: total active workers, site compliance %, pending findings count, unresolved enforcement actions, certs expiring in 30 days
    - _Requirements: 17.2_

  - [x] 10.2 Implement Worker Management pages
    - Create `packages/admin-portal/src/pages/workers/WorkerDirectory.tsx` — Searchable worker list with DataTable, filter by site and compliance status, results within 3s for up to 10,000 records
    - Create `packages/admin-portal/src/pages/workers/WorkerProfile.tsx` — Detailed worker view (personal data, certifications, site history, incidents, QR/SMS pass)
    - Create `packages/admin-portal/src/pages/workers/WorkerOnboarding.tsx` — Onboarding workflow (invite, profile completion, cert upload)
    - Create `packages/admin-portal/src/pages/workers/BulkImport.tsx` — CSV bulk import interface
    - Manual certification validation: transition pending → validated or rejected
    - _Requirements: 17.3, 17.11_

  - [x] 10.3 Implement Certifications pages
    - Create `packages/admin-portal/src/pages/certifications/CertOverview.tsx` — Certification dashboard overview
    - Create `packages/admin-portal/src/pages/certifications/CertCatalog.tsx` — Configurable catalog of certification types
    - Create `packages/admin-portal/src/pages/certifications/PendingValidations.tsx` — Queue for pending validations
    - Create `packages/admin-portal/src/pages/certifications/ExpiringSoon.tsx` — Expiring-soon alerts
    - _Requirements: 17.3_

- [x] 11. Admin Portal — Site Access, Sites, and Contractors
  - [x] 11.1 Implement Site Access pages
    - Create `packages/admin-portal/src/pages/site-access/CheckIn.tsx` — QR check-in scan interface for gate operators
    - Create `packages/admin-portal/src/pages/site-access/LiveAccess.tsx` — Real-time access feed (auto-refresh every 30s)
    - Create `packages/admin-portal/src/pages/site-access/Rejections.tsx` — Rejection tracking with root causes
    - Create `packages/admin-portal/src/pages/site-access/AccessRules.tsx` — Per-site access rule configuration
    - Create `packages/admin-portal/src/pages/site-access/VisitLog.tsx` — Complete visit log with audit trail
    - _Requirements: 17.4_

  - [x] 11.2 Implement Sites pages
    - Create `packages/admin-portal/src/pages/sites/SiteList.tsx` — Site listing with DataTable
    - Create `packages/admin-portal/src/pages/sites/SiteProfile.tsx` — Site detail (access requirements, active workers today, assigned contractors, safety findings, reports)
    - Create `packages/admin-portal/src/pages/sites/SiteConfig.tsx` — Site configuration (policy assignment, gate config, timezone)
    - _Requirements: 17.4_

  - [x] 11.3 Implement Contractors pages
    - Create `packages/admin-portal/src/pages/contractors/ContractorList.tsx` — Contractor listing with DataTable
    - Create `packages/admin-portal/src/pages/contractors/ContractorProfile.tsx` — Contractor detail (linked workers, clearance/standing, required certs, performance, documents)
    - Create `packages/admin-portal/src/pages/contractors/ComplianceRisks.tsx` — Compliance risk view highlighting contractors with issues
    - _Requirements: 17.4_

- [x] 12. Admin Portal — Safety AI, Reports, and Admin
  - [x] 12.1 Implement Safety AI pages
    - Create `packages/admin-portal/src/pages/safety-ai/UploadEvidence.tsx` — Image upload interface with drag-and-drop, metadata capture (site, trade, phase)
    - Create `packages/admin-portal/src/pages/safety-ai/Findings.tsx` — AI findings list with image evidence, detection details, regulatory mapping
    - Create `packages/admin-portal/src/pages/safety-ai/PendingReview.tsx` — Pending review queue with confirm/dismiss actions (dismiss requires reason ≥ 10 chars), success/failure indication within 2s
    - Create `packages/admin-portal/src/pages/safety-ai/ViolationsByRule.tsx` — Violations filtered by regulatory rule
    - Create `packages/admin-portal/src/pages/safety-ai/CorrectiveActions.tsx` — Corrective action management
    - Create `packages/admin-portal/src/pages/safety-ai/PdfReports.tsx` — PDF report generation and download
    - _Requirements: 17.6, 17.13_

  - [x] 12.2 Implement Reports pages
    - Create `packages/admin-portal/src/pages/reports/ComplianceSummary.tsx` — Compliance summary report with date range and site selection
    - Create `packages/admin-portal/src/pages/reports/WorkerStatus.tsx` — Worker status report
    - Create `packages/admin-portal/src/pages/reports/SiteAccessLogs.tsx` — Site access log report
    - Create `packages/admin-portal/src/pages/reports/SafetyFindings.tsx` — Safety findings report
    - Create `packages/admin-portal/src/pages/reports/AuditExport.tsx` — Audit export (PDF/CSV)
    - Report type selection, date range picker, site filter, export buttons
    - _Requirements: 17.7_

  - [x] 12.3 Implement Admin pages
    - Create `packages/admin-portal/src/pages/admin/UsersRoles.tsx` — User management (create, assign roles, deactivate), invitation flow
    - Create `packages/admin-portal/src/pages/admin/RuleCatalog.tsx` — Rule catalog management
    - Create `packages/admin-portal/src/pages/admin/SiteRequirements.tsx` — Per-site requirement configuration
    - Create `packages/admin-portal/src/pages/admin/Integrations.tsx` — Third-party integrations placeholder
    - Create `packages/admin-portal/src/pages/admin/TenantConfig.tsx` — Tenant-level configuration
    - _Requirements: 17.1, 17.5_

- [x] 13. Checkpoint — Ensure Admin Portal builds and renders correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Landing Page
  - [x] 14.1 Initialize Landing Page project and implement all sections
    - Configure Vite with React + TypeScript + Tailwind CSS
    - Create `packages/landing-page/src/pages/index.tsx` — Main page composing all sections
    - Create `packages/landing-page/src/components/Hero.tsx` — Value proposition for BC construction companies in first viewport (no scroll required)
    - Create `packages/landing-page/src/components/Features.tsx` — Key features: identity and access, AI safety observation, compliance decisions, audit explainability
    - Create `packages/landing-page/src/components/Pricing.tsx` — Contact-for-pricing section
    - Create `packages/landing-page/src/components/Testimonials.tsx` — Customer testimonials/case studies placeholder
    - Create `packages/landing-page/src/components/ContactForm.tsx` — Lead capture form (company_name required max 200, contact_name required max 150, email required valid, phone optional E.164, message required max 1000), inline validation errors, submit to POST /leads, show confirmation within 3s, retain data on network error
    - Create `packages/landing-page/src/components/Footer.tsx` — Legal and contact links
    - Responsive: 320px to 2560px without horizontal scrolling
    - SEO: Open Graph tags, page title, meta description, structured data
    - Static generation for search engine indexing
    - Target Lighthouse performance score ≥ 90, LCP ≤ 3s on 4G
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11_

- [x] 15. CI/CD Pipelines
  - [x] 15.1 Create GitHub Actions workflow for backend
    - Create `.github/workflows/backend.yml` — Trigger on push/PR to main (paths: packages/backend/**)
    - Steps: lint (eslint, prettier), type-check (tsc --noEmit), unit-test (vitest + fast-check, min 100 iterations per property), build (esbuild bundle each Lambda), cdk synth, deploy-dev (cdk deploy --context env=dev), integration-test, manual-approval (environment protection), deploy-prod (cdk deploy --context env=prod), smoke-test
    - AWS credentials via GitHub OIDC
    - Dependency scanning (npm audit)
    - _Requirements: 18.1, 18.2_

  - [x] 15.2 Create GitHub Actions workflow for admin portal
    - Create `.github/workflows/admin-portal.yml` — Trigger on push/PR to main (paths: packages/admin-portal/**)
    - Steps: lint, type-check, unit-test (vitest), build (vite build with Tailwind purge), deploy-dev (S3 sync + CloudFront invalidation), manual-approval, deploy-prod (S3 sync + CloudFront invalidation)
    - _Requirements: 17.8_

  - [x] 15.3 Create GitHub Actions workflow for landing page
    - Create `.github/workflows/landing-page.yml` — Trigger on push/PR to main (paths: packages/landing-page/**)
    - Steps: lint, build (vite build with Tailwind purge), lighthouse-check (score ≥ 90), deploy-dev (S3 sync + CloudFront invalidation), manual-approval, deploy-prod (S3 sync + CloudFront invalidation)
    - _Requirements: 16.6, 16.7_

- [x] 16. Final checkpoint — Ensure all tests pass and project builds end-to-end
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at logical boundaries
- Property tests validate universal correctness properties defined in the design document (20 properties total)
- Unit tests validate specific examples and edge cases
- The mobile app (packages/mobile) is PAUSED and excluded from all tasks
- All backend services use TypeScript on Node.js 20 (AWS Lambda)
- All frontend code uses React 18 + TypeScript + Tailwind CSS
- DynamoDB is used for ALL data storage (no RDS/PostgreSQL)
- AI pipeline uses AWS Bedrock with Claude 3.5 Sonnet (vision-capable)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6"] },
    { "id": 2, "tasks": ["1.7", "1.8"] },
    { "id": 3, "tasks": ["1.9"] },
    { "id": 4, "tasks": ["3.1", "3.3"] },
    { "id": 5, "tasks": ["3.2", "3.4", "3.5"] },
    { "id": 6, "tasks": ["4.1"] },
    { "id": 7, "tasks": ["4.2", "4.3"] },
    { "id": 8, "tasks": ["4.4", "4.5"] },
    { "id": 9, "tasks": ["4.6"] },
    { "id": 10, "tasks": ["6.1", "7.6", "7.7", "7.8"] },
    { "id": 11, "tasks": ["6.2"] },
    { "id": 12, "tasks": ["6.3"] },
    { "id": 13, "tasks": ["6.4"] },
    { "id": 14, "tasks": ["6.5", "6.6"] },
    { "id": 15, "tasks": ["6.7", "7.1", "7.2"] },
    { "id": 16, "tasks": ["7.3", "7.5"] },
    { "id": 17, "tasks": ["7.4", "7.9"] },
    { "id": 18, "tasks": ["7.10"] },
    { "id": 19, "tasks": ["9.1"] },
    { "id": 20, "tasks": ["9.2", "9.3"] },
    { "id": 21, "tasks": ["10.1", "10.2", "10.3"] },
    { "id": 22, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 23, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 24, "tasks": ["14.1"] },
    { "id": 25, "tasks": ["15.1", "15.2", "15.3"] }
  ]
}
```
