# Requirements Document

## Introduction

AI Report Validation module for ClearSite that enables users to upload construction reports (Word or PDF), request AI-powered validation against British Columbia construction laws, receive compliance feedback, iterate on improvements, and submit finalized reports.

The module leverages AWS Bedrock Knowledge Bases with S3 Vectors for cost-effective RAG (Retrieval-Augmented Generation), Bedrock Data Automation (BDA) for structured data extraction from PDFs, and Claude 3.5 Haiku for compliance analysis. The knowledge base contains WorkSafeBC OHS Regulation, BC Building Code, and Construction Safety Standards.

### Architecture Overview

- **Document Processing**: PDF/Word → S3 → BDA (structured extraction)
- **RAG Pipeline**: Knowledge Base (S3 Vectors) → RetrieveAndGenerate → Claude 3.5 Haiku
- **Integration**: API Gateway → Lambda → Bedrock services → Admin Portal

### First Version Scope

**Includes:** Report upload (Word/PDF), draft status management, AI validation request, compliance feedback display, iterative validation cycles, report submission, validation history, basic compliance scoring.

**Does not include:** Real-time collaborative editing, automatic report correction/rewriting, multi-language report support, integration with external regulatory submission systems, offline validation, batch validation of multiple reports simultaneously.

## Glossary

- **Report_Validation_System**: Main module handling report upload, AI validation, and submission workflow within ClearSite
- **Validation_Engine**: Component that orchestrates the RAG pipeline to analyze reports against BC construction law knowledge base
- **Draft_Report**: A report document uploaded by the user that has not yet been submitted; eligible for AI validation and editing
- **Validation_Request**: A user-initiated request to analyze a Draft_Report against BC construction laws
- **Validation_Result**: The structured AI-generated feedback containing compliance findings, suggestions, and references to applicable regulations
- **Compliance_Finding**: An individual issue or observation identified by the Validation_Engine, categorized by severity and linked to specific regulation references
- **Knowledge_Base**: AWS Bedrock Knowledge Base containing indexed BC construction law documents (WorkSafeBC OHS Regulation, BC Building Code, Construction Safety Standards) with S3 Vectors as the vector store
- **BDA_Processor**: AWS Bedrock Data Automation component that extracts structured text and data from uploaded PDF documents
- **Report_Status**: The lifecycle state of a report: draft, validating, validated, submitted
- **Compliance_Score**: A numerical indicator (0-100) representing the overall compliance level of a report based on validation findings
- **Regulation_Reference**: A citation to a specific section, clause, or article of BC construction law referenced in a Compliance_Finding
- **Report_Owner**: The user who uploaded the report and has permission to request validation and submit it
- **Safety_Reviewer**: User with supervisor or cso role who can view validation results and submitted reports across their assigned sites
- **Knowledge_Base_Context_Bucket**: Dedicated S3 bucket for storing regulatory and standards documents that feed the Knowledge Base for RAG queries
- **Context_Document**: A regulatory or standards document (WorkSafeBC OHS Regulation, BC Building Code, Construction Safety Standards, Canada-wide standards) uploaded to the Knowledge Base context bucket for indexing

## Requirements

### Requirement 1: Report Upload

**User Story:** As a Report_Owner, I want to upload Word or PDF documents as draft reports, so that I can later request AI validation on their compliance with BC construction laws.

#### Acceptance Criteria

1. THE Report_Validation_System SHALL accept file uploads with MIME types application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx), and application/msword (.doc)
2. IF the uploaded file exceeds 25 MB in size or is less than 1 KB in size, THEN THE Report_Validation_System SHALL reject the upload and return a message indicating the minimum and maximum allowed file size
3. WHEN the Report_Owner uploads a valid file, THE Report_Validation_System SHALL store the file in S3, create a report record with Report_Status "draft", assign a unique report identifier, and record the upload timestamp in UTC
4. WHEN the Report_Owner uploads a valid file, THE Report_Validation_System SHALL extract and store metadata including: file name (maximum 255 characters), file size in bytes, MIME type, number of pages (for PDF), and uploading user identifier
5. IF the uploaded file has an unsupported MIME type, THEN THE Report_Validation_System SHALL reject the upload and return a message listing the accepted file formats
6. IF the Report_Validation_System fails to store the file in S3 or fails to create the report record, THEN THE Report_Validation_System SHALL not persist partial data, SHALL return an error message indicating the upload could not be completed, and SHALL not create a report record without a successfully stored file
7. WHEN the Report_Owner uploads a valid file, THE Report_Validation_System SHALL confirm successful upload by returning the assigned report identifier, the Report_Status "draft", and the recorded upload timestamp to the Report_Owner within 10 seconds of upload completion

### Requirement 2: Report Status Lifecycle

**User Story:** As a Report_Owner, I want my report to follow a clear lifecycle from draft through validation to submission, so that I can track its progress and know when actions are available.

#### Acceptance Criteria

1. THE Report_Validation_System SHALL support the following Report_Status values: draft, validating, validated, submitted
2. THE Report_Validation_System SHALL allow only the following status transitions: draft → validating, validating → validated, validated → draft (when user uploads a new version), validated → submitted, draft → submitted (direct submission without validation)
3. IF a user attempts a status transition not included in the allowed transitions, THEN THE Report_Validation_System SHALL reject the operation and return an error message indicating the current status and the list of valid transitions from that status
4. WHILE a Draft_Report has Report_Status "validating", THE Report_Validation_System SHALL disable upload and submission actions and display a message indicating that the report is currently being validated
5. WHEN the Report_Status of a report changes, THE Report_Validation_System SHALL record the transition with the previous status, new status, user who triggered the change, and UTC timestamp

### Requirement 3: AI Validation Request

**User Story:** As a Report_Owner, I want to request AI validation on my draft report, so that I receive feedback on its compliance with BC construction laws before submitting.

#### Acceptance Criteria

1. WHILE a report has Report_Status "draft", THE Report_Validation_System SHALL display a validation request action available to the Report_Owner for that report
2. WHEN the Report_Owner submits a Validation_Request, THE Report_Validation_System SHALL change the Report_Status to "validating" and initiate the RAG pipeline processing within 5 seconds of the request
3. WHEN the Report_Owner submits a Validation_Request, THE BDA_Processor SHALL extract text content from the uploaded document and pass the extracted text to the Validation_Engine
4. WHEN the BDA_Processor completes text extraction, THE Validation_Engine SHALL query the Knowledge_Base using RetrieveAndGenerate with the extracted report content to identify compliance gaps against WorkSafeBC OHS Regulation, BC Building Code, and Construction Safety Standards
5. IF the BDA_Processor fails to extract text from the uploaded document, THEN THE Report_Validation_System SHALL change the Report_Status back to "draft" and return an error message indicating the document could not be processed
6. IF the Validation_Engine encounters a service error during RAG processing, THEN THE Report_Validation_System SHALL change the Report_Status back to "draft", record the error, and return a message indicating the validation could not be completed
7. IF the BDA_Processor extracts fewer than 50 characters of text from the uploaded document, THEN THE Report_Validation_System SHALL change the Report_Status back to "draft" and return a message indicating the document does not contain sufficient text content for compliance validation
8. IF a Validation_Request has not completed processing within 5 minutes of submission, THEN THE Report_Validation_System SHALL mark the request as timed out, change the Report_Status back to "draft", and notify the Report_Owner that validation could not be completed

### Requirement 4: Validation Result Structure

**User Story:** As a Report_Owner, I want to receive structured and actionable feedback from the AI validation, so that I can understand exactly what needs to be corrected and why.

#### Acceptance Criteria

1. WHEN the Validation_Engine completes analysis, THE Report_Validation_System SHALL generate a Validation_Result containing: a list of Compliance_Findings (maximum 50 findings), an overall Compliance_Score (0-100), a summary of the analysis (maximum 2000 characters), and the validation completion timestamp in UTC
2. THE Report_Validation_System SHALL categorize each Compliance_Finding with one of the following severity levels: critical (regulatory violation), major (significant compliance gap), minor (improvement recommendation), informational (best practice suggestion)
3. WHEN the Validation_Engine identifies a compliance issue, THE Report_Validation_System SHALL include in each Compliance_Finding: a description of the issue (maximum 500 characters), the severity level, the specific section of the report where the issue was found identified by section heading or page number, a suggested correction (maximum 500 characters), and one or more Regulation_References citing the applicable law or standard
4. WHEN the Validation_Engine completes analysis, THE Report_Validation_System SHALL change the Report_Status to "validated" and associate the Validation_Result with the report record
5. THE Report_Validation_System SHALL calculate the Compliance_Score starting from 100 and deducting points based on the number and severity of findings: deducting 15 points per critical finding, 8 points per major finding, 3 points per minor finding, and 0 points per informational finding, with a minimum score of 0
6. IF the Validation_Engine completes analysis and identifies zero Compliance_Findings, THEN THE Report_Validation_System SHALL generate a Validation_Result with an empty findings list, a Compliance_Score of 100, and a summary indicating no compliance issues were identified

### Requirement 5: Validation Result Display

**User Story:** As a Report_Owner, I want to view the validation results in a clear and navigable format, so that I can efficiently review all findings and understand the required corrections.

#### Acceptance Criteria

1. WHEN the Report_Owner views a Validation_Result, THE Report_Validation_System SHALL display the overall Compliance_Score as a numeric value (0-100) with a color-coded indicator: green (80-100), yellow (50-79), red (0-49)
2. WHEN the Report_Owner views a Validation_Result, THE Report_Validation_System SHALL display the list of Compliance_Findings grouped by severity level in descending order (critical first, then major, minor, informational), showing a maximum of 50 findings per severity group with an indication of the total count if more exist
3. WHEN the Report_Owner selects a specific Compliance_Finding, THE Report_Validation_System SHALL display the full finding details including: issue description, affected report section, suggested correction, and Regulation_References displayed as navigable links that open the referenced regulation clause in a new browser tab
4. WHEN the Report_Owner views the analysis summary, THE Report_Validation_System SHALL display the total count of findings per severity level and the overall compliance assessment text (maximum 1000 characters) generated by the Validation_Engine
5. IF a Validation_Result contains zero Compliance_Findings, THEN THE Report_Validation_System SHALL display the Compliance_Score as 100 with the green indicator and a message indicating no compliance issues were identified
6. IF the Report_Validation_System fails to load the Validation_Result data within 10 seconds, THEN THE Report_Validation_System SHALL display an error message indicating the results could not be loaded and offer a retry action

### Requirement 6: Iterative Validation Cycle and Version History

**User Story:** As a Report_Owner, I want to update my report based on AI feedback and request validation again, so that I can iteratively improve compliance and retain a complete history of all versions with their associated feedback.

#### Acceptance Criteria

1. WHILE a report has Report_Status "validated", THE Report_Validation_System SHALL enable the Report_Owner to upload a new version of the document, which changes the Report_Status back to "draft"
2. WHEN the Report_Owner uploads a new version of a report, THE Report_Validation_System SHALL store the new file as a new version, increment the version number sequentially starting from 1 for the initial upload, and permanently preserve the previous document version and its associated Validation_Result
3. THE Report_Validation_System SHALL permanently store each Validation_Result linked to its corresponding document version, ensuring that AI feedback is never lost when new versions are uploaded, and SHALL retain all version history for the lifetime of the report record
4. WHEN the Report_Owner requests validation on a report that has previous Validation_Results, THE Validation_Engine SHALL perform a complete new analysis on the current document version without referencing or being influenced by previous Validation_Results
5. THE Report_Validation_System SHALL display the validation history for a report in reverse chronological order (most recent version first) showing: version number, document file name, validation date, Compliance_Score, total number of findings, and a link to view the full Validation_Result for each past version
6. WHEN the Report_Owner selects a historical version from the validation history, THE Report_Validation_System SHALL display the complete Validation_Result associated with that version including all Compliance_Findings and the Compliance_Score
7. THE Report_Validation_System SHALL not impose a limit on the number of validation iterations a Report_Owner can perform on a single report
8. IF the upload of a new version fails due to a storage error or file validation failure, THEN THE Report_Validation_System SHALL retain the current Report_Status and existing version unchanged, not increment the version number, and return an error message indicating the reason for failure

### Requirement 7: Report Submission

**User Story:** As a Report_Owner, I want to submit my report when I am satisfied with its compliance level, so that it is formally delivered and its status reflects completion.

#### Acceptance Criteria

1. WHILE a report has Report_Status "draft" or "validated", THE Report_Validation_System SHALL enable the Report_Owner to submit the report
2. WHEN the Report_Owner submits a report, THE Report_Validation_System SHALL change the Report_Status to "submitted" and record the submission timestamp in UTC and the submitting user identifier
3. WHILE a report has Report_Status "submitted", THE Report_Validation_System SHALL prevent further uploads, validation requests, or status changes by the Report_Owner
4. WHEN the Report_Owner submits a report that has Report_Status "validated", THE Report_Validation_System SHALL associate the most recent Validation_Result with the submitted report as the final compliance assessment
5. WHEN the Report_Owner submits a report that has Report_Status "draft" (without prior validation), THE Report_Validation_System SHALL display a confirmation dialog stating that the report has not been validated for compliance, presenting explicit "Confirm Submission" and "Cancel" actions
6. WHEN the Report_Owner selects "Confirm Submission" on the unvalidated report confirmation dialog, THE Report_Validation_System SHALL proceed with the submission as specified in criterion 2
7. WHEN the Report_Owner selects "Cancel" on the unvalidated report confirmation dialog, THE Report_Validation_System SHALL dismiss the dialog and retain the report in Report_Status "draft" without recording a submission
8. IF the Report_Validation_System cannot complete the submission operation due to a system error, THEN THE Report_Validation_System SHALL retain the report in its current Report_Status, display an error message indicating that submission failed, and allow the Report_Owner to retry the submission

### Requirement 8: Report List and Management

**User Story:** As a Report_Owner, I want to view and manage all my reports in a list, so that I can track the status of each report and access them for validation or submission.

#### Acceptance Criteria

1. WHEN the Report_Owner accesses the reports section, THE Report_Validation_System SHALL display a paginated list of reports (maximum 20 reports per page) showing: report title (derived from file name, truncated to 100 characters with ellipsis if longer), Report_Status, last Compliance_Score (if validated), upload date, last validation date, and version count, sorted by upload date descending by default
2. THE Report_Validation_System SHALL allow the Report_Owner to filter reports by Report_Status (draft, validating, validated, submitted) and sort by upload date or last validation date in ascending or descending order, displaying filtered results within 3 seconds for up to 500 reports
3. WHEN the Report_Owner selects a report from the list, THE Report_Validation_System SHALL navigate to the report detail view showing the current document, validation results (if available), and available actions based on current Report_Status: "Request Validation" and "Submit" for draft, no actions for validating, "Upload New Version" and "Submit" for validated, no actions for submitted
4. THE Report_Validation_System SHALL display only reports owned by the authenticated user
5. IF the authenticated user has role tenant_admin or cso, THEN THE Report_Validation_System SHALL display all reports belonging to users within the same tenant as the authenticated user
6. IF the authenticated user has role site_admin, THEN THE Report_Validation_System SHALL display all reports belonging to users assigned to the same sites as the authenticated user
7. IF the Report_Owner has no reports in the system, THEN THE Report_Validation_System SHALL display an empty state message indicating no reports exist and providing guidance to upload a first report

### Requirement 9: Document Text Extraction

**User Story:** As a Report_Owner, I want the system to reliably extract text from my uploaded documents regardless of format, so that the AI validation can analyze the full content of my report.

#### Acceptance Criteria

1. WHEN a PDF document is uploaded, THE BDA_Processor SHALL extract all text content including text within tables, headers, footers, and embedded text in images using OCR capabilities, and SHALL complete extraction within 60 seconds of upload receipt for documents up to 50 pages
2. WHEN a Word document (.docx or .doc) is uploaded, THE Report_Validation_System SHALL extract all text content including paragraphs, tables, headers, footers, and list items, and SHALL complete extraction within 30 seconds of upload receipt
3. IF the BDA_Processor extracts fewer than 50 characters of text from a document, THEN THE Report_Validation_System SHALL flag the document as potentially unreadable and notify the Report_Owner that the document may not contain sufficient text for validation
4. WHEN text extraction completes successfully, THE Report_Validation_System SHALL store the extracted text associated with the report record for use in validation processing within 5 seconds of extraction completion
5. IF a document is password-protected, corrupted, or cannot be parsed by the extraction process, THEN THE Report_Validation_System SHALL notify the Report_Owner with an error message indicating the specific reason extraction failed and SHALL not store partial extraction results for that document
6. IF an uploaded document exceeds 200 pages or 50 MB in file size, THEN THE Report_Validation_System SHALL reject the document and notify the Report_Owner that the document exceeds the maximum supported size
7. IF a document is uploaded in a format other than PDF, .docx, or .doc, THEN THE Report_Validation_System SHALL reject the document and notify the Report_Owner indicating the accepted formats

### Requirement 10: Validation Processing Feedback

**User Story:** As a Report_Owner, I want to see an engaging animated progress indicator while my validation is processing, so that I know the system is actively working and can estimate when results will be available.

#### Acceptance Criteria

1. WHILE a report has Report_Status "validating", THE Report_Validation_System SHALL display an animated step-progress indicator showing four sequential stages (document extraction, knowledge base query, compliance analysis, result generation) where completed stages are visually distinct from the current active stage and pending stages
2. WHILE a report has Report_Status "validating", THE Report_Validation_System SHALL display a repeating visual animation on the report card in the report list view to indicate active processing, distinguishable from static status indicators
3. WHILE a report has Report_Status "validating", THE Report_Validation_System SHALL display an elapsed time counter (in seconds) starting from when the Validation_Request was initiated, alongside a displayed estimated total time range of 30 to 90 seconds based on document page count (30 seconds for documents of 1-5 pages, 60 seconds for 6-20 pages, 90 seconds for 21 or more pages)
4. WHEN the processing stage changes during validation, THE Report_Validation_System SHALL update the step-progress indicator to mark the completed stage and highlight the newly active stage within 2 seconds of the stage transition occurring
5. IF a Validation_Request has been processing for more than 5 minutes without completion, THEN THE Report_Validation_System SHALL mark the request as timed out, change the Report_Status back to "draft", and notify the Report_Owner with a message indicating that validation could not be completed and the request may be retried
6. WHEN the Report_Owner navigates away from and returns to a report that has Report_Status "validating", THE Report_Validation_System SHALL restore the progress indicator showing the current active stage and the elapsed time since the Validation_Request was initiated

### Requirement 11: Role-Based Access Control

**User Story:** As a platform operator, I want report validation access controlled by existing ClearSite roles, so that sensitive report data is protected according to organizational responsibilities.

#### Acceptance Criteria

1. THE Report_Validation_System SHALL allow report upload and validation requests only for users with role tenant_admin, site_admin, supervisor, or cso
2. THE Report_Validation_System SHALL restrict report viewing and Validation_Result viewing to: the Report_Owner for their own reports, users with role site_admin or supervisor for reports belonging to their assigned sites, and users with role tenant_admin or cso for all reports within their tenant
3. THE Report_Validation_System SHALL restrict report submission to the Report_Owner of the specific report
4. IF a user without sufficient permissions attempts to access a report or validation functionality, THEN THE Report_Validation_System SHALL deny access with HTTP code 403 and return a message indicating insufficient permissions without revealing whether the requested resource exists
5. IF a request is received without a valid authenticated session, THEN THE Report_Validation_System SHALL deny access with HTTP code 401 and return a message indicating authentication is required

### Requirement 12: AI Disclaimer

**User Story:** As a Report_Owner, I want to see a clear disclaimer about the AI validation limitations, so that I understand the feedback is advisory and does not replace professional compliance review.

#### Acceptance Criteria

1. WHEN the Report_Owner views a Validation_Result, THE Report_Validation_System SHALL display a disclaimer with the text: "This AI-generated compliance analysis is provided as advisory support only. It does not constitute legal advice or guarantee regulatory compliance. Always consult with qualified professionals for final compliance determinations."
2. WHEN the Report_Owner initiates their first Validation_Request after authenticating (i.e., once per authenticated session), THE Report_Validation_System SHALL display the disclaimer in a modal dialog and require the Report_Owner to activate an explicit acknowledgment control before the Validation_Request is submitted to the Validation_Engine
3. IF the Report_Owner does not acknowledge the disclaimer presented before a Validation_Request, THEN THE Report_Validation_System SHALL prevent the Validation_Request from being submitted and SHALL keep the disclaimer dialog displayed until the Report_Owner either acknowledges or cancels the request
4. THE Report_Validation_System SHALL include the disclaimer text as the last content section in any exported validation result document, appearing after all Compliance_Findings and the Compliance_Score, in both PDF and CSV export formats

### Requirement 13: Knowledge Base Context Document Management

**User Story:** As a tenant_admin, I want to upload regulatory documents (WorkSafeBC regulations, BC Building Code, Canada-wide construction standards) to a dedicated S3 bucket, so that the Knowledge Base has the necessary context to perform accurate compliance validation.

#### Acceptance Criteria

1. THE Report_Validation_System SHALL provision a dedicated S3 bucket (separate from the report uploads bucket) for storing Knowledge Base context documents
2. THE Report_Validation_System SHALL accept context document uploads with MIME types application/pdf and application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx) for the Knowledge Base context bucket, with a maximum file size of 50 MB per document
3. WHEN the tenant_admin uploads a context document, THE Report_Validation_System SHALL store the document in the Knowledge Base context bucket and record metadata including: file name (maximum 255 characters), upload date, document category (WorkSafeBC OHS Regulation, BC Building Code, Construction Safety Standards, Canada General), file size in bytes, and uploading user identifier
4. THE Report_Validation_System SHALL organize context documents in the bucket by category using S3 prefixes: worksafebc/, bc-building-code/, safety-standards/, canada-general/
5. WHEN a new context document is uploaded to the Knowledge Base context bucket, THE Report_Validation_System SHALL trigger a Knowledge Base sync to index the new document for use in RAG queries, and the sync status SHALL transition to "indexed" within 120 seconds of upload completion under normal operating conditions
6. IF a user without the role tenant_admin or platform_admin attempts to upload, delete, or manage context documents, THEN THE Report_Validation_System SHALL deny the request and return an error indicating insufficient permissions
7. WHEN the tenant_admin accesses the Knowledge Base management section, THE Report_Validation_System SHALL display a list of all uploaded context documents showing: file name, category, upload date, file size, and sync status (indexed, pending, error) within 5 seconds of the request
8. IF a context document upload fails due to an unsupported MIME type, file size exceeding 50 MB, or a storage error, THEN THE Report_Validation_System SHALL reject the upload, return an error message indicating the specific reason for rejection, and retain no partial record for that document
9. IF the Knowledge Base sync fails to index a document, THEN THE Report_Validation_System SHALL set the document sync status to "error" and display the failed status in the Knowledge Base management list
10. WHEN the tenant_admin deletes a context document from the Knowledge Base management section, THE Report_Validation_System SHALL remove the document from the S3 bucket, remove the associated metadata record, and trigger a Knowledge Base re-sync to remove the document from the RAG index
