# Requirements Document

## Introduction

The AI Construction Compliance Platform is a regulatory reasoning engine for construction operations in British Columbia. The platform unifies worker identity and access validation, certification and site eligibility management, visual safety compliance analysis, and audit-grade compliance decisions with explainability. The system operates as a Compliance Decision Platform with four pillars: identity and eligibility, site policy enforcement, AI-assisted safety observation, and audit and regulatory explainability.

The MVP centers on a daily repeatable workflow: morning site access validation, daily hazard scan, and end-of-day compliance summary.

## Glossary

- **Compliance_Decision_Engine**: The central service that evaluates all compliance and access decisions. No module decides independently; all decisions flow through this engine.
- **Policy**: A logical business rule owned by a platform, tenant, site, or project that governs compliance behavior.
- **PolicyVersion**: A concrete, evaluable snapshot of a Policy with an effective date range. Only one version is active per policy-owner-time combination.
- **DecisionRecord**: An immutable record of a compliance decision including the rule snapshot used at evaluation time.
- **WorkerIdentity**: The persistent identity record of a construction worker including personal information, language preference, and verification status.
- **AccessToken**: A short-lived credential issued for access validation or site entry, distinct from the persistent worker identity.
- **ScanSession**: A record of each scan attempt at a site gate, linking the worker, token, and resulting decision.
- **Finding**: An AI-generated observation from visual evidence that identifies a potential safety or compliance issue.
- **Detection_Layer**: The first AI processing layer that identifies observable objects and evidence in images.
- **Scene_Understanding_Layer**: The second AI processing layer that converts detections into operational context and activity classification.
- **Regulatory_Mapping_Layer**: The third AI processing layer that maps scene understanding and detections to applicable regulations and site policies.
- **EnforcementAction**: An operational action resulting from a compliance decision, such as denying entry or creating a corrective action task.
- **OverrideRequest**: A documented exception request to a compliance decision, requiring approval and creating an auditable exception layer.
- **RevalidationAttempt**: A new validation attempt triggered after a correction or exception to a previous denied decision.
- **Event_Bus**: The asynchronous messaging infrastructure (EventBridge or SNS+SQS) that enables event-driven processing.
- **Worker_Status_Page**: The mobile-first interface where workers view their eligibility, certifications, and required actions.
- **Daily_Compliance_Summary**: An end-of-day report consolidating access decisions, findings, and unresolved risks for a site.
- **Jurisdiction**: The regulatory authority governing compliance rules, initially British Columbia (WorkSafeBC).
- **Landing_Page**: The public-facing static marketing website hosted on AWS S3 + CloudFront, presenting the platform value proposition and lead capture for construction companies.
- **Admin_Portal**: The web-based single-page application hosted on AWS S3 + CloudFront, used by tenant_admin, site_admin, supervisor, CSO, and gate_operator roles to manage compliance operations.
- **Backend**: The serverless API and services layer hosted on AWS infrastructure (Lambda, API Gateway, RDS PostgreSQL, S3, SQS/SNS, DynamoDB, CloudWatch) serving all platform functionality.
- **Mobile_App**: The cross-platform mobile application (React Native or Flutter) for iOS and Android, providing workers with status viewing, certification upload, QR scanning, offline caching, and push notifications.
- **Landing_Page**: The public-facing marketing website that communicates the platform value proposition and provides conversion paths for prospective customers.
- **Admin_Portal**: The web-based administration interface used by platform_admin, tenant_admin, site_admin, supervisor, and CSO roles to manage policies, review compliance data, and generate reports.
- **Backend_API**: The centralized API services layer that serves all client applications (Admin_Portal, Mobile_Application, Landing_Page) with business logic, data access, and integrations.
- **Mobile_Application**: The native iOS mobile application used by workers and gate operators for QR scanning, photo capture, status viewing, and gate operations with offline-first capability.

## Requirements

### Requirement 1: Compliance Decision Engine Core

**User Story:** As a site_admin, I want all compliance and access decisions centralized through a single decision engine, so that every decision is consistent, explainable, and auditable.

#### Acceptance Criteria

1. WHEN an access request is submitted, THE Compliance_Decision_Engine SHALL evaluate worker identity, certifications, site requirements, jurisdiction, and active policy versions to produce a decision within 5 seconds of request receipt.
2. WHEN the Compliance_Decision_Engine produces a decision, THE Compliance_Decision_Engine SHALL return a decision output containing: decision result, decision type, one or more reasons, list of rules applied, policy version used, jurisdiction, and a UTC timestamp.
3. WHEN the Compliance_Decision_Engine produces a decision, THE Compliance_Decision_Engine SHALL return one of the following results: allowed, conditional, denied, or manual_review_required.
4. THE Compliance_Decision_Engine SHALL reference at least one PolicyVersion record for every evaluation.
5. WHEN a decision is produced, THE Compliance_Decision_Engine SHALL generate at least one reason per rule applied, where each reason is a plain-language statement of no more than 500 characters identifying the rule, the relevant input, and the outcome.
6. IF the Compliance_Decision_Engine receives incomplete input data where any of worker identity, certifications, site requirements, or jurisdiction is missing or empty, THEN THE Compliance_Decision_Engine SHALL return an error response identifying each missing input by name rather than producing a partial decision.
7. IF no active PolicyVersion record is available for the applicable jurisdiction at evaluation time, THEN THE Compliance_Decision_Engine SHALL return a denial decision with a reason indicating that no applicable policy version is available.

### Requirement 2: Policy Versioning

**User Story:** As a tenant_admin, I want policies to be versioned with effective date ranges, so that the system can answer "what was the rule on that day?" for any historical decision.

#### Acceptance Criteria

1. WHEN a policy is updated, THE Policy service SHALL create a new PolicyVersion with a sequentially incremented version number rather than mutating the existing version.
2. IF a user attempts to publish a PolicyVersion whose effective date range overlaps with an already-active PolicyVersion for the same policy and owner, THEN THE Policy service SHALL reject the publish and return an error message indicating the conflicting version and its date range.
3. WHEN a PolicyVersion is published, THE Policy service SHALL record the effective_from date (to day precision), published_by user, and a change_summary of no more than 1000 characters.
4. THE DecisionRecord SHALL store the rule_snapshot_json representing the exact rules evaluated at decision time.
5. WHEN an admin requests the history of a specific decision, THE Platform SHALL display the PolicyVersion that was effective at the time of that decision, including its version number, effective_from date, and change_summary.
6. WHEN an admin initiates a replay of a historical decision, THE Platform SHALL re-evaluate the original inputs against the PolicyVersion that was active at the original evaluation time and return the resulting decision outcome alongside the original recorded outcome.
7. IF a user attempts to modify a PolicyVersion that has already been used in a DecisionRecord, THEN THE Policy service SHALL reject the modification and return an error message indicating that the version is immutable due to prior use in decisions.
8. IF a historical decision query specifies a date for which no PolicyVersion was active for the given policy and owner, THEN THE Policy service SHALL return an error message indicating that no active policy version exists for the requested date.

### Requirement 3: Worker Identity and Certification Management

**User Story:** As a worker, I want to register my identity and upload my certifications, so that I can be validated for site access across multiple projects.

#### Acceptance Criteria

1. WHEN a worker is created, THE Identity service SHALL store legal name (maximum 150 characters), preferred name (maximum 100 characters), phone number (E.164 format, maximum 15 digits), language preference, and tenant association.
2. THE Identity service SHALL support language preferences of English and Spanish, with Punjabi prepared as the next priority.
3. WHEN a worker uploads a certification, THE Identity service SHALL record certification type, issuer (maximum 200 characters), issue date, expiry date, and document asset reference, and SHALL set the certification validation status to pending.
4. IF a worker uploads a certification document that exceeds 10 MB in size or is not in an accepted format (PDF, JPEG, or PNG), THEN THE Identity service SHALL reject the upload and return an error message indicating the size limit or accepted formats.
5. THE Identity service SHALL track validation status for each certification as one of: pending, validated, rejected, or expired, where transitions are permitted only as follows: pending to validated, pending to rejected, rejected to pending (on re-upload), and any status to expired (on expiry date reached).
6. WHEN a certification expiry date is reached (evaluated daily at 00:00 UTC), THE Event_Bus SHALL emit a CertificationExpired event and THE Identity service SHALL update the certification status to expired.
7. WHEN a CertificationExpired event is emitted, THE Compliance_Decision_Engine SHALL recalculate site eligibility for the affected worker.
8. THE Identity service SHALL support the following initial certification types: WHMIS 2015, fall protection, SiteReadyBC, and first aid.
9. IF a worker submits a certification with an expiry date earlier than or equal to the issue date, THEN THE Identity service SHALL reject the certification and return an error message indicating the expiry date must be after the issue date.

### Requirement 4: Site Eligibility and Access Decisions

**User Story:** As a gate_operator, I want the system to evaluate worker eligibility in real time when a worker scans at the gate, so that only compliant workers gain site access.

#### Acceptance Criteria

1. WHEN a worker submits an access request via QR scan or SMS link, THE Compliance_Decision_Engine SHALL evaluate the worker against the site's active policy requirements and return a decision within 5 seconds.
2. WHEN a worker with a valid identity submits an access request, THE Compliance_Decision_Engine SHALL deny access if the worker does not satisfy all current policy requirements, regardless of identity validity.
3. WHEN access is denied, THE Compliance_Decision_Engine SHALL return specific reasons identifying which certifications or requirements are not met.
4. WHEN access is conditional, THE Compliance_Decision_Engine SHALL specify the conditions that must be fulfilled for full access and a deadline by which the conditions must be met.
5. WHEN an access validation session is initiated, THE Access service SHALL generate an AccessToken with a time-to-live of no more than 10 minutes.
6. THE Access service SHALL support token types of: qr_session, sms_magic_link, and gate_pass.
7. WHEN an AccessToken expires, THE Access service SHALL reject any access attempt using that token and return a response indicating the token has expired.
8. WHEN a scan event occurs, THE ScanSession SHALL record worker identity, site, scan timestamp, scanner type, device identifier, token reference, decision reference, and result.
9. IF the same QR code is presented more than once within the AccessToken time-to-live window or from a different device than the original scan, THEN THE Access service SHALL flag the ScanSession with a replay_risk_flag and deny access.
10. IF the Compliance_Decision_Engine is unavailable during an access request, THEN THE Access service SHALL deny access and return a response indicating the system is temporarily unable to evaluate eligibility.
11. WHEN access is granted, THE Access service SHALL record the grant decision and the policy version used for evaluation in the ScanSession.

### Requirement 5: Worker Mobile Experience

**User Story:** As a worker, I want a simple mobile status page in my preferred language, so that I can understand my eligibility status and required actions within 10 seconds.

#### Acceptance Criteria

1. THE Worker_Status_Page SHALL display identity summary, current site eligibility, certifications expiring within 30 days, the 10 most recent access history entries, and actions needed.
2. THE Worker_Status_Page SHALL render all content in the worker's configured language preference.
3. THE Worker_Status_Page SHALL render all content readable and operable on viewports from 320px wide and above without requiring horizontal scrolling.
4. WHEN a worker opens the Worker_Status_Page, THE Platform SHALL present eligibility status and required actions within a single scrollable view without requiring navigation.
5. IF a network request fails or does not respond within 5 seconds, THEN THE Worker_Status_Page SHALL display the last known eligibility status with a visible timestamp indicating when the data was last retrieved.
6. WHEN access is denied, THE Worker_Status_Page SHALL display the specific reasons and corrective actions required.
7. WHEN a worker opens the Worker_Status_Page, THE Platform SHALL render the complete page content within 5 seconds on a 3G network connection.

### Requirement 6: AI Safety Observation — Detection Layer

**User Story:** As a supervisor, I want to upload site photos and receive automated detection of safety-relevant objects, so that potential hazards are identified without manual inspection of every image.

#### Acceptance Criteria

1. WHEN a supervisor or CSO uploads an image, THE Detection_Layer SHALL identify observable safety-relevant objects and conditions in the image and return detection results within 30 seconds of upload completion.
2. THE Detection_Layer SHALL detect the following object categories: helmet, vest, harness, ladder, scaffold, trench or excavation edge, roof edge, machinery proximity, and blocked exit or clutter.
3. WHEN detections are produced, THE Detection_Layer SHALL assign a confidence score between 0 and 1 to each detected object and only surface detections with a confidence score at or above 0.5 to the user.
4. THE Detection_Layer SHALL record the model version used for each detection result.
5. WHEN an image is uploaded, THE Platform SHALL capture metadata including site identifier, trade, project phase, and timestamp.
6. THE Detection_Layer SHALL accept images in JPEG or PNG format with a file size no greater than 25 MB and a minimum resolution of 640×480 pixels.
7. IF an uploaded image is in an unsupported format, exceeds the maximum file size, is below the minimum resolution, or cannot be processed by the detection model, THEN THE Detection_Layer SHALL reject the image, notify the user with an error message indicating the reason for rejection, and retain no partial detection results for that image.
8. WHEN detection completes successfully, THE Detection_Layer SHALL return for each detected object: the object category label, the confidence score, and a bounding region indicating the object location within the image.

### Requirement 7: AI Safety Observation — Scene Understanding Layer

**User Story:** As a CSO, I want the system to interpret detected objects in operational context, so that I understand the work activity and risk scenario rather than just a list of objects.

#### Acceptance Criteria

1. WHEN the Detection_Layer produces results, THE Scene_Understanding_Layer SHALL classify the work scene into one of the defined scene types within 5 seconds of receiving detection results.
2. THE Scene_Understanding_Layer SHALL identify the following scene types: work at height scenario, roofing activity, excavation context, framing activity, ladder access scenario, and material handling near mobile equipment.
3. WHEN a scene is classified, THE Scene_Understanding_Layer SHALL produce a scene description of no more than 200 characters, a detected activity label matching one of the defined scene types, a risk context identifying the primary hazard and exposed personnel count, and a confidence score ranging from 0.0 to 1.0.
4. THE Scene_Understanding_Layer SHALL record the model version used for each scene interpretation.
5. IF the Scene_Understanding_Layer cannot classify the scene into any defined scene type with a confidence score at or above 0.5, THEN THE Scene_Understanding_Layer SHALL label the scene as "unclassified" and include the highest-scoring candidate scene type and its confidence score in the output.
6. IF the Detection_Layer produces results containing no recognized objects relevant to construction activity, THEN THE Scene_Understanding_Layer SHALL return a response indicating no construction activity detected and shall not produce a risk context.

### Requirement 8: AI Safety Observation — Regulatory Mapping Layer

**User Story:** As a CSO, I want AI findings mapped to specific regulations and site policies, so that I can take action based on regulatory authority rather than generic observations.

#### Acceptance Criteria

1. WHEN the Scene_Understanding_Layer produces results, THE Regulatory_Mapping_Layer SHALL map each detection to zero or more applicable regulatory rules and site policies within 2 seconds of receiving the results.
2. THE Regulatory_Mapping_Layer SHALL include the active PolicyVersion identifier and jurisdiction identifier in each regulatory mapping output.
3. WHEN a detection matches one or more regulatory rules or site policies with a confidence score at or above the configured violation threshold, THE Regulatory_Mapping_Layer SHALL produce: violation flag, regulatory basis (specific regulation clause reference), site policy basis (specific policy clause reference), severity level, and suggested corrective action (maximum 500 characters).
4. THE Regulatory_Mapping_Layer SHALL classify severity based on the potential for human harm: critical (imminent risk of fatality or permanent injury), high (risk of serious injury or repeated exposure), medium (risk of minor injury or regulatory non-compliance without immediate harm), low (procedural deviation with no direct injury risk).
5. THE Regulatory_Mapping_Layer SHALL reference WorkSafeBC regulations as the initial jurisdiction rule set.
6. IF a detection cannot be matched to any regulatory rule or site policy, THEN THE Regulatory_Mapping_Layer SHALL produce a mapping output with no violation flag and an indication that no applicable regulation was identified.
7. IF the active PolicyVersion or jurisdiction rule set is unavailable, THEN THE Regulatory_Mapping_Layer SHALL reject the mapping request and return an error indication specifying the unavailable resource.

### Requirement 9: Finding Review Workflow

**User Story:** As a supervisor, I want to review AI-generated findings before they become final, so that false positives are filtered and confirmed findings drive corrective action.

#### Acceptance Criteria

1. THE Platform SHALL assign each Finding a status from the lifecycle: generated, pending_review, confirmed, dismissed, or corrected.
2. WHEN a Finding is generated with severity high or critical, THE Platform SHALL set the initial status to pending_review.
3. WHEN a Finding is generated with severity low or medium, THE Platform SHALL set the initial status to generated.
4. WHEN a reviewer confirms a Finding, THE Platform SHALL update the status to confirmed and record the reviewer identity and timestamp.
5. WHEN a reviewer dismisses a Finding, THE Platform SHALL update the status to dismissed, record the reviewer identity and timestamp, and require a dismissal reason of at least 10 characters.
6. IF a Finding has status pending_review or generated, THEN THE Platform SHALL prevent the Finding from triggering any EnforcementAction until a reviewer confirms or dismisses it.
7. WHEN a confirmed Finding has severity high or critical, THE Platform SHALL create an EnforcementAction of type corrective_action_required within 60 seconds of confirmation.

### Requirement 10: Real-Time Enforcement Loop

**User Story:** As a site_admin, I want compliance decisions to trigger immediate operational actions with escalation paths, so that non-compliance is addressed in real time rather than only logged.

#### Acceptance Criteria

1. WHEN the Compliance_Decision_Engine produces a denied or conditional decision for site access, THE Platform SHALL create an EnforcementAction linked to the DecisionRecord within 5 seconds of the decision being produced.
2. THE EnforcementAction SHALL support the following action types: deny_entry, notify_supervisor, request_updated_certification, require_manual_review_at_gate, trigger_override_workflow, create_corrective_action_task, require_rescan, and escalate_to_cso.
3. WHEN an EnforcementAction is created, THE Platform SHALL notify the assigned responsible party within 60 seconds via at least one configured notification channel and include the action type, affected worker identifier, and site location.
4. WHEN a worker submits a RevalidationAttempt referencing a denied DecisionRecord, THE Platform SHALL trigger a new evaluation by the Compliance_Decision_Engine using the updated worker data, up to a maximum of 3 RevalidationAttempts per original DecisionRecord within a 24-hour period.
5. WHEN an authorized user with the role of site_admin or CSO requests an override, THE Platform SHALL create an OverrideRequest that records the requester, reason, and evidence without replacing the original decision.
6. WHEN an OverrideRequest is approved, THE Platform SHALL record the approver, approval timestamp, and expiration date for the override, where the expiration date SHALL NOT exceed 90 days from the approval timestamp.
7. THE Platform SHALL maintain the original DecisionRecord as immutable; overrides and revalidations SHALL create new linked records rather than modifying the original.
8. IF an EnforcementAction of type deny_entry or require_manual_review_at_gate remains unresolved for more than 30 minutes, THEN THE Platform SHALL automatically escalate the EnforcementAction to the next action type in the escalation sequence and notify the corresponding responsible party.

### Requirement 11: Event-Driven Architecture

**User Story:** As a platform_admin, I want the system to process asynchronous workflows through events, so that certification expirations, AI analysis, and notifications are handled without blocking user interactions.

#### Acceptance Criteria

1. THE Event_Bus SHALL support publishing and consuming the following events: WorkerCreated, WorkerUpdated, CertificationUploaded, CertificationValidated, CertificationExpired, SitePolicyPublished, AccessRequested, AccessDecisionGenerated, InspectionUploaded, DetectionCompleted, SceneClassified, FindingGenerated, FindingReviewed, DailyComplianceSummaryRequested, and DailyComplianceSummaryGenerated.
2. WHEN a CertificationExpired event is published, THE Platform SHALL recalculate eligibility for all sites where the affected worker has active access within 30 seconds of event receipt.
3. WHEN an InspectionUploaded event is published, THE Platform SHALL initiate the AI analysis pipeline through Detection_Layer, Scene_Understanding_Layer, and Regulatory_Mapping_Layer in sequence, completing pipeline initiation within 5 seconds of event receipt.
4. THE Event_Bus SHALL deliver events with at-least-once delivery semantics within 10 seconds of publication, and consumers SHALL process duplicate events idempotently such that processing the same event more than once produces the same outcome as processing it exactly once.
5. THE Platform SHALL use REST endpoints for command initiation and transactional reads, and events for processes exceeding 5 seconds duration, derived computations, and side effects.
6. IF any stage in the AI analysis pipeline (Detection_Layer, Scene_Understanding_Layer, or Regulatory_Mapping_Layer) fails, THEN THE Platform SHALL halt subsequent stages, record the failure against the originating InspectionUploaded event with an indication of which stage failed, and publish no downstream completion event for that stage or subsequent stages.
7. IF event delivery has not been acknowledged by a consumer within 10 seconds, THEN THE Event_Bus SHALL retry delivery up to 3 additional attempts with exponential backoff before marking the event as failed delivery.

### Requirement 12: Audit-Grade Explainability

**User Story:** As a tenant_admin, I want every compliance decision to include a complete explainability payload, so that decisions can withstand regulatory audit and dispute resolution.

#### Acceptance Criteria

1. THE Compliance_Decision_Engine SHALL produce an explainability payload for every decision containing: decision result, decision type, timestamp of the decision, human-readable reasons (maximum 5 per decision, each no longer than 500 characters), machine-readable rule references, evidence references, and policy version references.
2. WHEN a DecisionRecord is finalized, THE Platform SHALL store the explainability payload in append-only immutable storage within 5 seconds of finalization, such that stored records cannot be modified or deleted through any platform operation.
3. THE Platform SHALL include evidence references linking to specific certifications, policy versions, or media assets that informed the decision.
4. THE Platform SHALL enforce explanation visibility levels based on the requesting role: workers see reasons and required actions only, supervisors see reasons and rule references, and admins see the full explainability payload.
5. THE Platform SHALL retain DecisionRecords and their explainability payloads for a minimum of 7 years or the duration required by WorkSafeBC regulatory retention requirements, whichever is longer.
6. IF the Compliance_Decision_Engine cannot assemble a complete explainability payload due to missing evidence references or unavailable policy versions, THEN THE Platform SHALL block the decision from being finalized and SHALL return an error indication specifying which required payload fields could not be populated.
7. WHEN an authorized user requests a DecisionRecord for audit or dispute resolution, THE Platform SHALL retrieve and return the complete explainability payload, filtered to the requesting user's visibility level, within 10 seconds.
8. IF a stored explainability payload fails an integrity verification check, THEN THE Platform SHALL flag the affected DecisionRecord as potentially compromised and SHALL notify tenant administrators.

### Requirement 13: Daily Compliance Summary and Reporting

**User Story:** As a site_admin, I want an end-of-day compliance summary for each site, so that I have a consolidated view of access decisions, findings, and unresolved risks.

#### Acceptance Criteria

1. WHEN a DailyComplianceSummaryRequested event is triggered, THE Reporting service SHALL generate a Daily_Compliance_Summary for the specified site covering the reporting period (midnight-to-midnight in the site's configured timezone) within 60 seconds of the request.
2. THE Daily_Compliance_Summary SHALL consolidate: access decisions (allowed, conditional, denied counts), AI findings (generated, confirmed, dismissed counts), unresolved enforcement actions (actions that have not been marked resolved or dismissed by end of the reporting period), and certification compliance status (compliant, non-compliant, or expired for each applicable certification).
3. THE Daily_Compliance_Summary SHALL include the summary generation timestamp, the reporting period start and end timestamps, and references to the PolicyVersions active during the reporting period.
4. THE Reporting service SHALL support export of compliance summaries in PDF and CSV formats.
5. WHEN a standalone report is requested for a specified site and reporting period, THE Reporting service SHALL generate the requested report type (access decision log, certification compliance summary, or inspection finding summary) within 60 seconds of the request.
6. IF no compliance data exists for the specified site and reporting period, THEN THE Reporting service SHALL generate the Daily_Compliance_Summary with all counts set to zero and include an indication that no activity was recorded.

### Requirement 14: Security and Access Control

**User Story:** As a platform_admin, I want the platform to enforce tenant isolation and role-based access control, so that data is protected and users only access information appropriate to their role.

#### Acceptance Criteria

1. THE Platform SHALL enforce tenant isolation such that no user of one tenant can access data belonging to another tenant.
2. IF a user attempts to access data belonging to a different tenant, THEN THE Platform SHALL deny the request and return an error indicating access is forbidden without revealing the existence of the requested resource.
3. THE Platform SHALL implement role-based access control supporting the following roles: platform_admin, tenant_admin, site_admin, supervisor, CSO, gate_operator, and worker.
4. THE Platform SHALL encrypt personally identifiable information and documents at rest.
5. THE Platform SHALL use signed upload URLs for document and media uploads with an expiration time no longer than 15 minutes from generation.
6. THE Platform SHALL use tokens for access sessions with a maximum lifetime of 60 minutes, and SHALL provide explicit revocation capability for each issued token.
7. THE Platform SHALL maintain audit trails for all administrative actions including role assignments, policy changes, and override approvals, where each audit entry records at minimum the acting user, the target resource, the action performed, and a timestamp.
8. THE Platform SHALL retain audit trail records for a minimum of 90 days.
9. IF an AccessToken is revoked, THEN THE Platform SHALL reject any subsequent access attempt using that token within 5 seconds of revocation.

### Requirement 15: Offline and Low-Connectivity Handling

**User Story:** As a gate_operator, I want the system to handle low-connectivity scenarios at remote construction sites, so that access validation is not completely blocked by network issues.

#### Acceptance Criteria

1. IF a gate scan occurs while the device has no network connectivity, THEN THE Platform SHALL queue the ScanSession locally for reconciliation when connectivity is restored, retaining a maximum of 1000 queued sessions and storing each session for up to 72 hours.
2. WHEN connectivity is restored after an offline period, THE Platform SHALL synchronize all queued ScanSessions with the backend within 60 seconds of reconnection and update each session's status to reflect the backend-verified outcome.
3. IF a cached decision is used during an offline period and the cached data is older than 24 hours, THEN THE Platform SHALL flag the ScanSession as requiring backend verification upon reconnection and indicate to the gate operator that the decision was based on stale data.
4. WHEN the device loses network connectivity or response latency exceeds 10 seconds, THE Platform SHALL display a persistent visual indicator on the gate operator's screen showing the current connectivity state as either offline or degraded.
5. IF the offline queue reaches its maximum capacity of 1000 sessions, THEN THE Platform SHALL notify the gate operator that offline capacity is full and indicate that new scans cannot be validated until connectivity is restored.

### Requirement 16: Landing Page

**User Story:** As a construction company decision-maker, I want a clear and responsive marketing landing page, so that I can understand the platform's value proposition and request more information.

#### Acceptance Criteria

1. THE Landing_Page SHALL present the platform value proposition for construction companies operating in British Columbia within the first visible viewport without requiring scrolling.
2. THE Landing_Page SHALL render all content readable and operable on viewports from 320px wide to 2560px wide without horizontal scrolling or layout breakage.
3. THE Landing_Page SHALL include a lead capture form that collects company name (required, maximum 200 characters), contact name (required, maximum 150 characters), email address (required, valid email format), phone number (optional, E.164 format), and a message field (required, maximum 1000 characters).
4. WHEN a visitor submits the lead capture form with valid data, THE Landing_Page SHALL store the submission, clear the form fields, and display a visible confirmation message indicating that the submission was received within 3 seconds of submission.
5. IF a visitor submits the lead capture form with invalid or missing required fields, THEN THE Landing_Page SHALL display inline validation errors identifying each invalid field without clearing the form data.
6. THE Landing_Page SHALL be deployed as a static site hosted on AWS S3 with CloudFront distribution for cost efficiency and global availability.
7. THE Landing_Page SHALL achieve a Lighthouse performance score of 90 or above on mobile and desktop.
8. THE Landing_Page SHALL reach Largest Contentful Paint within 3 seconds on a simulated 4G network connection (download 9 Mbps, upload 1.5 Mbps, RTT 170 ms).
9. IF the lead capture form submission fails due to a network error or backend unavailability, THEN THE Landing_Page SHALL display an error message indicating the submission could not be completed and SHALL retain all entered form data so the visitor can retry without re-entering information.
10. THE Landing_Page SHALL include sections for: product overview, key features (identity and access, AI safety observation, compliance decisions, audit explainability), pricing or contact-for-pricing, customer testimonials or case studies placeholder, and a footer with legal and contact links.
11. THE Landing_Page SHALL be statically generated to support search engine indexing, and SHALL include structured metadata (Open Graph tags, page title, meta description).

### Requirement 17: Admin Portal

**User Story:** As a tenant_admin, I want a web-based admin portal with dashboards and management interfaces, so that I can oversee compliance operations, manage workers and sites, and review findings from any browser.

#### Acceptance Criteria

1. THE Admin_Portal SHALL authenticate and authorize users with the roles tenant_admin, site_admin, supervisor, CSO, and gate_operator, displaying role-appropriate navigation and functionality such that each role can only view and interact with modules permitted by the role-based access control defined in Requirement 14.
2. THE Admin_Portal SHALL present a compliance overview dashboard displaying: total active workers, site compliance percentage, pending findings count, unresolved enforcement actions count, and certifications expiring within 30 days, with data refreshed no less frequently than every 5 minutes.
3. THE Admin_Portal SHALL provide a worker management interface supporting worker search, filtering by site and compliance status, viewing worker detail including certifications and access history, and manual certification validation (transitioning a certification from pending to validated or rejected status as defined in Requirement 3).
4. THE Admin_Portal SHALL provide a site management interface supporting site creation, site policy assignment, gate configuration, and active worker roster viewing.
5. THE Admin_Portal SHALL provide a policy management interface supporting policy creation, version publishing with effective date ranges, and policy history viewing.
6. THE Admin_Portal SHALL provide a finding review interface displaying AI-generated findings with image evidence, detection details, regulatory mapping, and actions to confirm or dismiss each finding, where dismissal requires a reason of at least 10 characters as defined in Requirement 9.
7. THE Admin_Portal SHALL provide a report generation interface supporting selection of report type (access decision log, certification compliance summary, inspection finding summary, or daily compliance summary), date range, and site, with export in PDF and CSV formats.
8. THE Admin_Portal SHALL be deployed as a single-page application hosted on AWS S3 with CloudFront distribution for cost efficiency.
9. THE Admin_Portal SHALL render all interfaces readable and operable on viewports from 1024px wide and above.
10. IF a user session token expires while the user is interacting with the Admin_Portal, THEN THE Admin_Portal SHALL redirect the user to the login page and preserve the intended destination for post-login redirect.
11. WHEN a user performs a search or filter operation on worker, site, or finding lists, THE Admin_Portal SHALL return and display results within 3 seconds for datasets of up to 10,000 records.
12. IF a user session has been inactive for more than 60 minutes with no user interaction, THEN THE Admin_Portal SHALL terminate the session and redirect the user to the login page with a message indicating the session has expired due to inactivity.
13. WHEN a user confirms or dismisses a finding through the finding review interface, THE Admin_Portal SHALL display a success or failure indication within 2 seconds of the action being submitted.

### Requirement 18: Backend API and Services (AWS Serverless)

**User Story:** As a platform_admin, I want the backend to use affordable AWS serverless infrastructure, so that the platform operates at minimal cost while scaling with demand.

#### Acceptance Criteria

1. THE Backend SHALL expose a RESTful API through AWS API Gateway serving all platform functionality including Compliance_Decision_Engine, Policy service, Identity service, AI orchestration, Reporting service, and Notification service.
2. THE Backend SHALL use AWS Lambda functions for all compute operations, ensuring pay-per-use billing with no idle server costs, with each Lambda function configured with memory between 128 MB and 1024 MB based on workload requirements.
3. THE Backend SHALL use Amazon RDS PostgreSQL (db.t3.micro instance or Aurora Serverless v2 with minimum 0.5 ACU) for transactional data storage including workers, policies, decisions, findings, and audit records, with a maximum connection pool size of 50 concurrent connections.
4. THE Backend SHALL use Amazon S3 for object storage of media assets, uploaded documents, certification files, and inspection images.
5. THE Backend SHALL use Amazon SQS and SNS for the Event_Bus implementation, providing event-driven communication between services at minimal cost.
6. THE Backend SHALL use Amazon DynamoDB for session management and cache data instead of managed Redis, ensuring serverless pricing with no minimum capacity charges.
7. THE Backend SHALL use Amazon CloudWatch for centralized logging, metrics, and monitoring of all Lambda functions and API Gateway endpoints.
8. THE Backend SHALL implement event-driven architecture using SQS queues for asynchronous processing including the AI analysis pipeline, certification expiration checks, daily compliance summary generation, and notification delivery.
9. THE Backend SHALL use dedicated Lambda functions for asynchronous workers handling: AI pipeline orchestration, certification expiration evaluation, daily compliance summary generation, and push notification dispatch, with a maximum execution timeout of 900 seconds per asynchronous worker invocation.
10. IF a Lambda function execution exceeds 29 seconds for API-triggered operations, THEN THE Backend SHALL return a timeout response to the caller and offload the remaining work to an asynchronous SQS queue for background completion.
11. IF the RDS database connection pool reaches its maximum of 50 concurrent connections, THEN THE Backend SHALL return a service unavailable response to new requests requiring database access and publish a CloudWatch alarm indicating connection pool saturation.
12. THE Backend SHALL enforce a maximum Lambda concurrency limit per service to prevent runaway costs, configurable per environment, with a default concurrency limit of 100 concurrent executions per service in production and 10 concurrent executions per service in non-production environments.
13. IF an API Gateway request experiences a Lambda cold start, THEN THE Backend SHALL complete the cold start initialization and return a response within 10 seconds total (inclusive of cold start and execution time) for any API-triggered operation.
14. IF an asynchronous SQS message fails processing after 3 retry attempts, THEN THE Backend SHALL move the message to a dead-letter queue and publish a CloudWatch alarm indicating the failed processing with the originating service name and message identifier.
15. THE Backend SHALL authenticate all requests using JWT tokens with a maximum token lifetime of 60 minutes, and SHALL validate tenant context on every request to enforce tenant isolation as defined in Requirement 14.
16. THE Backend SHALL return structured error responses in a consistent format containing: error code, human-readable message, request identifier, and timestamp for every failed request.
17. THE Backend SHALL expose a synchronization endpoint that accepts batched offline data (queued ScanSessions, cached decisions) from mobile clients and processes reconciliation as defined in Requirement 15.

### Requirement 19: Mobile Application

**User Story:** As a worker, I want a mobile application on my phone, so that I can view my compliance status, upload certifications, scan QR codes for site access, and receive notifications in my preferred language.

#### Acceptance Criteria

1. THE Mobile_App SHALL be available on iOS (version 15 and above) and Android (version 10 and above) platforms.
2. THE Mobile_App SHALL provide a worker status page displaying identity summary, current site eligibility, certifications with expiry dates, and the 10 most recent access history entries.
3. THE Mobile_App SHALL provide a certification upload interface supporting capture from device camera or selection from device file storage, accepting PDF, JPEG, and PNG formats up to 10 MB per file.
4. WHEN a worker scans a QR code using the Mobile_App camera, THE Mobile_App SHALL decode the QR payload and initiate an access request to the Compliance_Decision_Engine, displaying the access decision result within 5 seconds of scan completion when online, or within 1 second using cached policy data when offline.
5. THE Mobile_App SHALL render all user-facing content in the worker's configured language preference, supporting English and Spanish with Punjabi prepared as the next priority.
6. THE Mobile_App SHALL cache the worker's eligibility status, certifications, and access history locally, enabling read access to cached data when the device has no network connectivity, retaining cached data for up to 72 hours before requiring a fresh synchronization.
7. WHEN the device regains network connectivity after an offline period, THE Mobile_App SHALL synchronize cached data with the backend within 60 seconds of reconnection.
8. THE Mobile_App SHALL deliver push notifications for: certification expiration warnings (30 days, 14 days, and 7 days before expiry), access decision results, and enforcement actions requiring worker response.
9. IF the Mobile_App cannot reach the backend within 5 seconds of a network request, THEN THE Mobile_App SHALL display cached data with a visible indicator showing the timestamp of the last successful synchronization.
10. THE Mobile_App SHALL use a cross-platform framework (React Native or Flutter) to target both iOS and Android from a single codebase, reducing development and maintenance cost.
11. IF a certification upload fails due to network interruption or backend unavailability, THEN THE Mobile_App SHALL retain the file locally, notify the worker that the upload will be retried, and automatically retry the upload up to 3 times with exponential backoff when connectivity is available.
12. THE Mobile_App SHALL require biometric authentication (fingerprint or face recognition) or device passcode for access to the application, and SHALL lock the application after 5 minutes of inactivity requiring re-authentication.
13. WHEN an access decision result is displayed after a QR scan, THE Mobile_App SHALL present a clear visual indicator distinguishing allowed (green), conditional (yellow), and denied (red) outcomes, along with the decision reasons as provided by the Compliance_Decision_Engine.
