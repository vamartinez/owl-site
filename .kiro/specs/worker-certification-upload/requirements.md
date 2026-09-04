# Requirements Document

## Introduction

This feature provides the Admin Portal frontend with a complete certification management UI for construction workers. It enables administrators to view a worker's certifications, upload new certifications (with document upload to S3 via signed URLs), validate or reject pending certifications, and receive visual warnings for expiring certifications. The backend API endpoints already exist; this feature focuses on the frontend implementation within the existing React/TanStack Query architecture.

## Glossary

- **Admin_Portal**: The React-based frontend application used by administrators to manage construction compliance
- **Certification_Form**: The UI form component for creating a new certification record with metadata and document attachment
- **Certification_List**: The UI component displaying all certifications for a specific worker
- **Upload_Service**: The frontend module responsible for obtaining a signed S3 URL from the API and uploading the document file directly to S3
- **Validation_Panel**: The UI component that allows authorized administrators to approve or reject pending certifications
- **Expiry_Warning**: A visual indicator displayed when a certification is approaching its expiry date
- **Signed_URL**: A time-limited pre-signed S3 URL returned by the backend API for direct file upload
- **Worker_Profile_Page**: The existing page displaying worker details, which will be extended with certification management capabilities

## Requirements

### Requirement 1: Display Worker Certifications List

**User Story:** As a site administrator, I want to view all certifications for a specific worker, so that I can assess their compliance status at a glance.

#### Acceptance Criteria

1. WHEN the Worker_Profile_Page loads, THE Certification_List SHALL fetch certifications from GET /workers/{id}/certifications and display them in a table
2. THE Certification_List SHALL display the certification type, issuer, issue date, expiry date, and validation status for each certification
3. WHEN the API request fails, THE Certification_List SHALL display an error message with a retry option
4. WHILE certifications are loading, THE Certification_List SHALL display a loading skeleton placeholder
5. THE Certification_List SHALL sort certifications by expiry date in ascending order by default

### Requirement 2: Upload New Certification

**User Story:** As a site administrator, I want to upload a new certification for a worker, so that their compliance records stay up to date.

#### Acceptance Criteria

1. WHEN the administrator clicks the "Add Certification" button, THE Admin_Portal SHALL display the Certification_Form in a modal dialog
2. THE Certification_Form SHALL require selection of certification type from: WHMIS 2015, Fall Protection, SiteReadyBC, First Aid
3. THE Certification_Form SHALL require input of issuer name, issue date, and expiry date
4. WHEN the expiry date is on or before the issue date, THE Certification_Form SHALL display an inline validation error and prevent submission
5. THE Certification_Form SHALL require a document file attachment
6. WHEN the selected file is not PDF, JPEG, or PNG format, THE Certification_Form SHALL display a validation error indicating allowed formats
7. WHEN the selected file exceeds 10 MB, THE Certification_Form SHALL display a validation error indicating the maximum file size
8. WHEN the form is submitted with valid data, THE Upload_Service SHALL POST certification metadata to /workers/{id}/certifications and receive a Signed_URL in the response
9. WHEN the Signed_URL is received, THE Upload_Service SHALL upload the document file directly to S3 using an HTTP PUT request to the Signed_URL
10. WHEN both the metadata submission and file upload succeed, THE Admin_Portal SHALL close the modal, display a success notification, and refresh the Certification_List
11. IF the metadata submission fails, THEN THE Certification_Form SHALL display the API error message and remain open for correction
12. IF the file upload to S3 fails, THEN THE Upload_Service SHALL retry the upload once and display an error notification if the retry also fails

### Requirement 3: Validate or Reject Certifications

**User Story:** As a site administrator, I want to validate or reject pending certifications, so that only legitimate certifications are accepted into the compliance system.

#### Acceptance Criteria

1. WHEN a certification has a "pending" status, THE Validation_Panel SHALL display "Validate" and "Reject" action buttons
2. WHEN the administrator clicks "Validate", THE Admin_Portal SHALL send a PATCH request to /workers/{id}/certifications/{certId} with validation_status set to "validated"
3. WHEN the administrator clicks "Reject", THE Admin_Portal SHALL display a text input for a rejection reason before sending the PATCH request
4. THE Certification_Form SHALL require a rejection reason of at least 10 characters before allowing rejection submission
5. WHEN the validation or rejection succeeds, THE Admin_Portal SHALL update the certification status in the Certification_List without a full page reload
6. IF the status update request fails, THEN THE Admin_Portal SHALL display an error notification with the failure reason
7. WHERE the user role lacks the "certifications.validate" permission, THE Validation_Panel SHALL hide the Validate and Reject action buttons

### Requirement 4: Display Certification Expiry Warnings

**User Story:** As a site administrator, I want to see visual warnings for certifications nearing expiry, so that I can proactively notify workers to renew them.

#### Acceptance Criteria

1. WHEN a certification expiry date is within 30 days from the current date, THE Expiry_Warning SHALL display an amber warning badge next to the certification
2. WHEN a certification expiry date has passed, THE Expiry_Warning SHALL display a red "Expired" badge next to the certification
3. WHEN a certification expiry date is more than 30 days away, THE Certification_List SHALL display a green "Valid" badge next to the certification
4. THE Certification_List SHALL display a summary count of expiring and expired certifications at the top of the list

### Requirement 5: File Upload Progress Feedback

**User Story:** As a site administrator, I want to see upload progress while a certification document is being uploaded, so that I know the system is working and can estimate wait time.

#### Acceptance Criteria

1. WHILE the document file is uploading to S3, THE Certification_Form SHALL display a progress bar indicating upload percentage
2. WHILE the upload is in progress, THE Certification_Form SHALL disable the submit button and display a "Uploading..." label
3. WHEN the upload completes, THE Certification_Form SHALL update the progress bar to 100% before closing the modal
4. IF the user closes the browser tab during upload, THEN THE Upload_Service SHALL cancel the in-progress upload request

### Requirement 6: Re-upload Rejected Certification

**User Story:** As a site administrator, I want to re-upload a document for a rejected certification, so that workers can correct issues without creating duplicate records.

#### Acceptance Criteria

1. WHEN a certification has a "rejected" status, THE Certification_List SHALL display a "Re-upload" action button
2. WHEN the administrator clicks "Re-upload", THE Admin_Portal SHALL display the Certification_Form pre-filled with the existing certification metadata and allow only the document file to be changed
3. WHEN the re-upload form is submitted, THE Upload_Service SHALL PATCH the certification status back to "pending" and upload the new document using a fresh Signed_URL
4. WHEN the re-upload succeeds, THE Admin_Portal SHALL display a success notification and refresh the Certification_List
