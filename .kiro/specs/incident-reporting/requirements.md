# Requirements Document

## Introduction

Incident Reporting Module for ClearSite that enables organizations to record, manage, and query incident reports for events occurring on construction sites. Includes evidence capture, traceability, operational follow-up, and support for regulatory compliance in Canada (WorkSafeBC) and the United States (OSHA).

This module integrates with existing worker management, QR/SMS access control, enforcement workflows, and compliance review flows on the platform. Within ClearSite's product vision, the incident module complements AI-powered visual inspection and access control, closing the operational safety loop.

### First Version Scope

**Includes:** Manual incident registration, web and mobile capture, classification by type/severity/regulatory character, evidence upload, states and basic follow-up, timeline and audit trail, OSHA and WorkSafeBC compliance flags, identification of incidents requiring immediate notification, preparation of minimum data for regulatory reports, basic export.

**Does not include:** Automatic direct submission to OSHA or WorkSafeBC, automated legal advice, advanced multi-stage root cause investigation, full CAPA automation, native integrations with insurers or authorities.

## Glossary

- **Incident_System**: Main incident reporting module within ClearSite
- **Regulatory_Engine**: Component that evaluates regulatory rules to determine external reporting obligations
- **Incident_Report**: Digital record of a safety event occurring on a construction site, with a unique identifier
- **Immediate_Notification_Alert**: Prominent notice indicating that an incident requires urgent external notification to a regulatory authority
- **Audit_Record**: Immutable entry in the timeline documenting each change made to an incident
- **External_Report_Status**: Marker indicating the external regulatory compliance status of an incident
- **Company_Administrator**: User with tenant_admin role who configures permissions, templates, and notification rules for the module
- **Safety_Supervisor**: User with supervisor or cso role who registers incidents, evaluates severity, activates regulatory workflows, and manages follow-up
- **Authorized_Contractor**: Field user (contractor with defined permissions) who can report incidents or unsafe conditions
- **Compliance_Reviewer**: User with cso or tenant_admin role who reviews regulatory compliance, prepares external reports, and closes cases
- **WorkSafeBC**: Occupational safety regulatory authority in British Columbia, Canada
- **OSHA**: Occupational Safety and Health Administration, federal occupational safety regulatory authority in the United States
- **OSHA_Form_300**: Log of occupational injuries and illnesses required by OSHA for annual recording
- **OSHA_Form_301**: Individual injury/illness report form required by OSHA
- **OSHA_Form_300A**: Annual summary of injuries and illnesses required by OSHA
- **Jurisdiction**: Regulatory territory applicable to a site (British Columbia, other Canadian province, US state)
- **Operational_Severity**: Internal classification of incident impact: Low, Medium, High, Critical
- **Regulatory_Flag**: Indicator independent of severity that signals the regulatory character: potentially reportable, immediately reportable, internal only

## Requirements

### Requirement 1: Incident Report Creation

**User Story:** As a Safety_Supervisor, I want to create an incident report with a unique identifier and preliminary regulatory classification, so that the event is formally recorded from the moment of its detection.

#### Acceptance Criteria

1. WHEN the Safety_Supervisor submits a creation form with all mandatory fields completed, THE Incident_System SHALL create an Incident_Report with a system-generated unique identifier, initial status "Open", and creation timestamp in UTC format
2. WHEN the Incident_System creates an Incident_Report, THE Regulatory_Engine SHALL assign a preliminary regulatory classification based on the boolean regulatory indicators provided in the form
3. IF the creation form does not contain all mandatory fields defined in Requirement 3, THEN THE Incident_System SHALL reject the request and return the list of missing fields
4. WHEN an Incident_Report is successfully created, THE Incident_System SHALL record an Audit_Record with the action "creation", the identifier of the creating user, and the UTC timestamp

### Requirement 2: Incident Types

**User Story:** As a Safety_Supervisor, I want to classify each incident by specific type, so that the organization can categorize events and comply with regulatory classification requirements.

#### Acceptance Criteria

1. THE Incident_System SHALL support the following incident types: Injury, Illness, Near-miss, Unsafe condition, Property damage, Environmental incident, Fire/explosion, Structural failure/collapse, Hazardous substance release, Regulatory non-compliance, Other
2. WHEN the Safety_Supervisor creates or edits an Incident_Report, THE Incident_System SHALL require the selection of exactly one incident type from the defined list
3. IF the selected type is "Other", THEN THE Incident_System SHALL require a textual description of the custom type with a minimum length of 10 characters

### Requirement 3: Incident Minimum Fields

**User Story:** As a Safety_Supervisor, I want to capture all relevant incident information in a structured form, so that a complete record exists to support investigation and regulatory compliance.

#### Acceptance Criteria

1. THE Incident_System SHALL require the following mandatory fields in each Incident_Report: title (maximum 200 characters), description (maximum 5000 characters), incident type, incident date/time, report date/time, location/site/project, number of persons involved (integer greater than or equal to zero), reporting user, initial severity
2. THE Incident_System SHALL allow the following optional fields in each Incident_Report: names of persons involved, attached evidence
3. THE Incident_System SHALL capture the following boolean regulatory indicators with a default value of false: medical treatment beyond first aid, lost time, hospitalization, fatality, amputation, loss of eye, structural collapse, hazardous substance release, fire or explosion
4. WHEN the Safety_Supervisor modifies any field of an existing Incident_Report, THE Incident_System SHALL record an Audit_Record with the modified field name, previous value, new value, user who made the change, and UTC timestamp

### Requirement 4: Severity Classification

**User Story:** As a Safety_Supervisor, I want to classify the operational severity of each incident and mark its regulatory character independently, so that the organization prioritizes response and activates appropriate compliance workflows.

#### Acceptance Criteria

1. THE Incident_System SHALL support the following Operational_Severity levels: Low, Medium, High, Critical
2. THE Incident_System SHALL support the following Regulatory_Flag values independent of Operational_Severity: potentially reportable, immediately reportable, internal only
3. WHEN the Safety_Supervisor changes the Operational_Severity of an Incident_Report, THE Incident_System SHALL record an Audit_Record with the previous severity, the new severity, the user who made the change, and the UTC timestamp
4. WHEN an Incident_Report receives the Regulatory_Flag "immediately reportable", THE Incident_System SHALL generate an Immediate_Notification_Alert within 5 seconds of the change

### Requirement 5: Incident States and Transitions

**User Story:** As a Safety_Supervisor, I want to manage the incident lifecycle through defined states with controlled transitions, so that clear traceability of each case's progress exists.

#### Acceptance Criteria

1. THE Incident_System SHALL support the following incident states: Open, Under review, Regulatory review, Action required, Resolved, Closed
2. THE Incident_System SHALL allow only the following state transitions: Open → Under review, Open → Regulatory review, Under review → Action required, Under review → Resolved, Regulatory review → Action required, Regulatory review → Resolved, Action required → Resolved, Resolved → Closed, Closed → Open (reopening)
3. WHEN the Safety_Supervisor changes the state of an Incident_Report through a valid transition, THE Incident_System SHALL record an Audit_Record with the previous state, the new state, the user who made the change, and the UTC timestamp
4. IF a user attempts a state transition not included in the allowed transitions, THEN THE Incident_System SHALL reject the operation and return the list of valid transitions from the current state

### Requirement 6: Regulatory Evaluation Engine

**User Story:** As a Compliance_Reviewer, I want the system to automatically evaluate whether an incident may require regulatory notification based on jurisdiction, so that the organization identifies reporting obligations in a timely manner.

#### Acceptance Criteria

1. WHEN an Incident_Report contains an active fatality indicator and the site Jurisdiction is a US state, THE Regulatory_Engine SHALL suggest that the incident may require reporting to OSHA within 8 hours from the time of the incident
2. WHEN an Incident_Report contains an active hospitalization, amputation, or loss of eye indicator and the site Jurisdiction is a US state, THE Regulatory_Engine SHALL suggest that the incident may require reporting to OSHA within 24 hours from the time of employer knowledge
3. WHEN an Incident_Report contains an active medical treatment beyond first aid or lost time indicator and the site Jurisdiction is British Columbia, THE Regulatory_Engine SHALL suggest that the incident may require an employer report to WorkSafeBC within 72 hours
4. WHEN an Incident_Report contains an active fatality, structural collapse, hazardous substance release, or fire/explosion indicator and the site Jurisdiction is British Columbia, THE Regulatory_Engine SHALL suggest that the incident requires immediate notification to WorkSafeBC
5. WHEN an Incident_Report contains an active medical treatment beyond first aid, lost time, hospitalization, fatality, amputation, or loss of eye indicator and the site Jurisdiction is a US state, THE Regulatory_Engine SHALL suggest that the incident should be considered for recording on OSHA_Form_300 and OSHA_Form_301
6. WHEN the Regulatory_Engine completes an evaluation, THE Incident_System SHALL record an Audit_Record with the applied rule, the evaluation result, the evaluated Jurisdiction, and the UTC timestamp

### Requirement 7: Immediate Notification Alert

**User Story:** As a Safety_Supervisor, I want to receive a prominent alert when an incident requires immediate external notification, so that the organization can act within established regulatory deadlines.

#### Acceptance Criteria

1. WHEN the Regulatory_Engine determines that an incident requires immediate notification, THE Incident_System SHALL display an Immediate_Notification_Alert with a warning-colored background and fixed position at the top of the Incident_Report view
2. THE Immediate_Notification_Alert SHALL contain: specific reason for the alert, suggested Jurisdiction (OSHA or WorkSafeBC), time of requirement detection, user who confirmed viewing, external report follow-up status
3. WHEN a user views the Immediate_Notification_Alert for the first time, THE Incident_System SHALL record the viewing confirmation with the user identifier and UTC timestamp
4. WHEN the external report follow-up status changes, THE Incident_System SHALL update the Immediate_Notification_Alert and record the change in the Audit_Record

### Requirement 8: WorkSafeBC Emergency Report Data

**User Story:** As a Compliance_Reviewer, I want to view and export a quick summary with the minimum data for immediate notification to WorkSafeBC, so that the organization can communicate the incident to the authority in a timely manner.

#### Acceptance Criteria

1. WHEN an Incident_Report is marked as requiring immediate notification to WorkSafeBC, THE Incident_System SHALL generate a summary view with: employer contact name, contact phone number, incident location, incident date/time, number of workers involved, names of workers involved, brief incident description (maximum 500 characters)
2. WHEN the Compliance_Reviewer requests to export the WorkSafeBC emergency summary, THE Incident_System SHALL generate a PDF document with the summary view data, generation date, and user who generated the document
3. IF any required field for the WorkSafeBC emergency summary is not available in the Incident_Report, THEN THE Incident_System SHALL indicate the missing fields with a visual marker in the summary view

### Requirement 9: WorkSafeBC Employer Injury Report Data

**User Story:** As a Compliance_Reviewer, I want to capture the data necessary for the employer injury/illness report to WorkSafeBC, so that the organization can prepare the report within the 72-hour deadline.

#### Acceptance Criteria

1. WHEN an Incident_Report is marked as requiring an employer report to WorkSafeBC, THE Incident_System SHALL enable an additional form with the following fields: employer information (name, address, phone, WorkSafeBC account number), worker information (name, address, date of birth, occupation, hire date), incident details (detailed description, body part affected, nature of injury), days/shifts lost, modified/transitional work proposal, worker earnings data
2. WHEN the Compliance_Reviewer completes the WorkSafeBC employer report data, THE Incident_System SHALL validate that all fields required by the form are complete before marking as ready for submission
3. IF the WorkSafeBC employer report data is incomplete, THEN THE Incident_System SHALL indicate the missing fields and allow saving the form as a draft without full validation

### Requirement 10: OSHA Recording Data

**User Story:** As a Compliance_Reviewer, I want to capture the fields necessary for OSHA forms 300, 301, and 300A, so that the organization maintains US federal compliance records.

#### Acceptance Criteria

1. WHEN an Incident_Report is marked as recordable for OSHA, THE Incident_System SHALL enable capture of fields for OSHA_Form_300 and OSHA_Form_301: case identifier, worker name, job title/position, incident date, location within the site, injury/illness description, case outcome, number of days away from work, number of days with restricted work or transfer
2. THE Incident_System SHALL support the following OSHA case outcomes: death, days away from work, restricted work, job transfer, other recordable case
3. WHEN the Compliance_Reviewer requests data for OSHA_Form_300A, THE Incident_System SHALL calculate and present the annual summary with totals by outcome category based on all recordable incidents for the selected calendar period
4. IF the OSHA recording data is incomplete, THEN THE Incident_System SHALL indicate the missing fields and allow saving as a draft without full validation

### Requirement 11: Recordable vs First Aid Only Distinction

**User Story:** As a Compliance_Reviewer, I want to clearly distinguish between recordable incidents and those that only required first aid, so that the organization maintains accurate OSHA records and does not over-report.

#### Acceptance Criteria

1. THE Incident_System SHALL support the following OSHA recordability classifications: first aid only (not recordable), medical treatment beyond first aid, days away from work, restricted work, job transfer, fatality
2. WHEN the Compliance_Reviewer selects a recordability classification, THE Incident_System SHALL update the OSHA recordability indicator of the Incident_Report consistently with the boolean regulatory indicators
3. WHEN the recordability classification changes, THE Incident_System SHALL record an Audit_Record with the previous classification, the new classification, the user who made the change, and the UTC timestamp

### Requirement 12: Evidence and Attachments

**User Story:** As a Safety_Supervisor, I want to attach photos, short videos, and documents to the incident report, so that documentary evidence exists to support investigation and regulatory compliance.

#### Acceptance Criteria

1. THE Incident_System SHALL accept the following file types as evidence: images (JPEG, PNG, HEIC), videos (MP4, MOV), documents (PDF)
2. THE Incident_System SHALL reject files exceeding 50 MB in individual size and return a message indicating the size limit
3. THE Incident_System SHALL reject video files with duration exceeding 60 seconds and return a message indicating the duration limit
4. WHEN the Safety_Supervisor attaches a valid file to an Incident_Report, THE Incident_System SHALL store the file and record an Audit_Record with the file name, MIME type, size in bytes, and user who attached it
5. IF the file does not comply with MIME type, size, or duration validations, THEN THE Incident_System SHALL reject the file and return a message indicating the specific restriction violated

### Requirement 13: Persons Involved

**User Story:** As a Safety_Supervisor, I want to record all persons involved in an incident with their specific role, so that complete traceability of event participants exists.

#### Acceptance Criteria

1. THE Incident_System SHALL support the following involvement types: injured/affected worker, witness, supervisor present, associated contractor/subcontractor
2. WHEN the Safety_Supervisor adds an involved person to an Incident_Report, THE Incident_System SHALL capture: full name (mandatory), role/involvement type (mandatory), organization (mandatory), worker identifier in the system (optional, linkable if the worker exists in ClearSite)
3. WHEN an involved person is added to or removed from an Incident_Report, THE Incident_System SHALL record an Audit_Record with the action performed, the person's data, and the user who made the change

### Requirement 14: Comments and Follow-up

**User Story:** As a Safety_Supervisor, I want to add internal comments, investigation notes, and actions taken to the incident report, so that a chronological record of case follow-up exists.

#### Acceptance Criteria

1. WHEN an authorized user adds a comment to an Incident_Report, THE Incident_System SHALL store the comment with: author identifier, textual content (maximum 5000 characters), and creation timestamp in UTC
2. WHEN the user queries the comments of an Incident_Report, THE Incident_System SHALL display the comments in ascending chronological order with author, content, and timestamp
3. WHEN a comment is added, THE Incident_System SHALL record an Audit_Record with the comment identifier, the author, and the timestamp
4. IF the comment content is empty, THEN THE Incident_System SHALL reject the comment creation

### Requirement 15: Immutable Timeline and Audit Trail

**User Story:** As a Compliance_Reviewer, I want to view a complete and immutable timeline of all incident events, so that auditable traceability of every action performed on the case exists.

#### Acceptance Criteria

1. THE Incident_System SHALL store and display an immutable timeline with the following event types: incident creation, severity change, state change, regulatory evaluation, regulatory review confirmation, External_Report_Status change, attachments added, comments added, involved persons modified, closure, reopening, notifications sent
2. WHEN the Compliance_Reviewer queries the timeline of an Incident_Report, THE Incident_System SHALL present all events in chronological order with: actor (user who performed the action), action type, relevant change data, and UTC timestamp
3. THE Incident_System SHALL preserve all timeline records immutably: once an Audit_Record is created, the system does not allow its modification or deletion

### Requirement 16: External Compliance Status

**User Story:** As a Compliance_Reviewer, I want to mark and track the external reporting status of each incident, so that the organization has visibility into the regulatory compliance of each case.

#### Acceptance Criteria

1. THE Incident_System SHALL support the following External_Report_Status values: not reportable, potentially reportable, reported to WorkSafeBC, reported to OSHA, external report pending, external report not applicable
2. WHEN the Compliance_Reviewer changes the External_Report_Status of an Incident_Report, THE Incident_System SHALL record an Audit_Record with the previous status, the new status, the user who made the change, and the UTC timestamp
3. WHILE an Incident_Report has External_Report_Status "external report pending", THE Incident_System SHALL display a warning-colored visual indicator in the incident list and in the incident detail header

### Requirement 17: Data Export

**User Story:** As a Compliance_Reviewer, I want to export incident data in formats useful for analysis and regulatory report preparation, so that the organization can fulfill recording and reporting obligations.

#### Acceptance Criteria

1. WHEN the Compliance_Reviewer requests an operational export, THE Incident_System SHALL generate a UTF-8 encoded CSV file with all incidents matching the filters selected by the user
2. WHEN the Compliance_Reviewer requests an OSHA log export, THE Incident_System SHALL generate a CSV file with the fields corresponding to OSHA_Form_300 for all incidents marked as OSHA recordable for the selected calendar period
3. WHEN the Compliance_Reviewer requests a regulatory report summary view, THE Incident_System SHALL generate a document with the consolidated minimum data necessary for manual preparation of regulatory reports
4. THE Incident_System SHALL include in each exported file: generation date in ISO 8601 format, period covered, description of applied filters, and name of the user who generated the export

### Requirement 18: Internal Notifications

**User Story:** As a Company_Administrator, I want the system to send automatic internal notifications for critical incidents and situations requiring attention, so that responsible parties act in a timely manner.

#### Acceptance Criteria

1. WHEN an Incident_Report is created with Critical Operational_Severity, THE Incident_System SHALL send an internal notification to the Safety_Supervisor assigned to the site and to the Compliance_Reviewer of the organization
2. WHEN the Regulatory_Engine determines that an incident is potentially reportable or immediately reportable, THE Incident_System SHALL send an internal notification to the Compliance_Reviewer of the organization
3. WHILE an Incident_Report with status "Open" or "Action required" does not receive any comment or state change during the internal deadline configured by the Company_Administrator, THE Incident_System SHALL send a reminder notification to the user assigned to the incident
4. WHEN the Incident_System sends an internal notification, THE Incident_System SHALL record the notification in the Audit_Record with: recipient, notification type, delivery channel, and UTC timestamp

### Requirement 19: Incident Closure

**User Story:** As a Safety_Supervisor, I want to close an incident documenting the resolution and actions taken, so that the case is formally concluded with a complete record.

#### Acceptance Criteria

1. WHEN the Safety_Supervisor requests to close an Incident_Report in "Resolved" status, THE Incident_System SHALL require: resolution notes documenting actions taken (minimum 20 characters), closure date, and user responsible for closure
2. IF the resolution notes are empty or have fewer than 20 characters when attempting to close an Incident_Report, THEN THE Incident_System SHALL reject the closure and indicate that resolution documentation is mandatory with minimum length
3. WHEN an Incident_Report is successfully closed, THE Incident_System SHALL change the status to "Closed" and record an Audit_Record with the resolution notes, closure date, and user who closed it
4. WHILE an Incident_Report has status "Closed", THE Incident_System SHALL preserve the complete history without allowing modifications to incident data, existing comments, or audit records

### Requirement 20: Incident Reopening

**User Story:** As a Compliance_Reviewer, I want to reopen a closed incident when new relevant information arises, so that the organization can correct and complete the case record.

#### Acceptance Criteria

1. WHEN the Compliance_Reviewer requests to reopen an Incident_Report in "Closed" status, THE Incident_System SHALL require a textual justification for reopening with a minimum length of 20 characters
2. WHEN an Incident_Report is successfully reopened, THE Incident_System SHALL change the status to "Open" and record an Audit_Record with the provided justification, user who reopened, and UTC timestamp
3. IF the reopening justification is empty or has fewer than 20 characters, THEN THE Incident_System SHALL reject the reopening and indicate that justification is mandatory with minimum length

### Requirement 21: Role-Based Access Control

**User Story:** As a Company_Administrator, I want access to the incident module to be controlled by existing ClearSite roles, so that sensitive health and safety information is protected according to each user's responsibilities.

#### Acceptance Criteria

1. THE Incident_System SHALL allow incident report creation only for users with role tenant_admin, site_admin, supervisor, cso, or Authorized_Contractor with explicit permissions
2. THE Incident_System SHALL restrict management of regulatory states, External_Report_Status changes, and case closure to users with role tenant_admin or cso
3. THE Incident_System SHALL restrict data export and access to worker health information to users with role tenant_admin, cso, or supervisor
4. IF a user without sufficient permissions attempts to access a restricted functionality of the incident module, THEN THE Incident_System SHALL deny access with HTTP code 403 and return a message indicating insufficient permissions
5. THE Incident_System SHALL filter the visible incident list based on user role: tenant_admin sees all incidents in the organization, site_admin and supervisor see incidents for their assigned sites, Authorized_Contractor sees only incidents they reported

### Requirement 22: Mobile Experience

**User Story:** As an Authorized_Contractor, I want to report incidents from a mobile device in the field, so that events are recorded immediately without depending on desktop computer access.

#### Acceptance Criteria

1. THE Incident_System SHALL present the incident creation form with a responsive design that adapts to screens with a minimum width of 320px
2. WHEN the Authorized_Contractor accesses the creation form from a mobile device, THE Incident_System SHALL allow photo capture directly from the device camera via the browser media capture API
3. WHEN the Authorized_Contractor loads the incident creation form from a mobile device with a 4G connection (minimum speed 5 Mbps), THE Incident_System SHALL complete the form load in less than 3 seconds measured from the HTTP request to the complete rendering of the interactive form

### Requirement 23: Jurisdictional Configurability

**User Story:** As a Company_Administrator, I want to configure the applicable regulatory jurisdiction for each site in my organization, so that the Regulatory_Engine applies the correct rules based on geographic location.

#### Acceptance Criteria

1. THE Incident_System SHALL support per-site Jurisdiction configuration with the following options: British Columbia, Alberta, Ontario, Quebec, other Canadian provinces, US states (individual state selection)
2. WHEN an Incident_Report is created at a site with a configured Jurisdiction, THE Regulatory_Engine SHALL automatically apply the regulatory rules corresponding to the site's Jurisdiction
3. IF a site does not have a configured Jurisdiction at the time of creating an Incident_Report, THEN THE Incident_System SHALL request Jurisdiction selection as a mandatory field in the incident creation form
4. WHEN the Company_Administrator modifies the Jurisdiction of a site, THE Incident_System SHALL record the change in the Audit_Record and apply the new Jurisdiction only to incidents created after the change

### Requirement 24: Legal Disclaimer

**User Story:** As a Company_Administrator, I want the system to display a clear legal disclaimer indicating that regulatory suggestions are operational support, so that users understand the system's limitations and do not confuse it with legal advice.

#### Acceptance Criteria

1. WHEN the Regulatory_Engine presents a regulatory suggestion to the user, THE Incident_System SHALL display a legal disclaimer with the text: "The regulatory suggestions provided by this system are operational support and do not constitute legal advice. Consult with a qualified legal professional to determine your specific regulatory obligations."
2. THE Incident_System SHALL display the legal disclaimer in: the regulatory evaluation view of the Incident_Report, the Immediate_Notification_Alert, and as a footer in all exported documents containing regulatory suggestions
3. THE Incident_System SHALL require the user to confirm having read the legal disclaimer the first time they access the regulatory evaluation functionality in each session
