# Requirements Document

## Introduction

The Document Explorer Backend is a dedicated Lambda service that aggregates documents from existing platform tables (Reports, Forms, Certifications, Incidents, Safety Evidence) into a virtual folder structure. The service dynamically queries existing DynamoDB tables on each request—no new storage table is introduced. It exposes a set of REST endpoints under the `/documents/*` route prefix, providing folder navigation, search, metadata retrieval, preview URL generation, batch ZIP download, integrity verification, user preference persistence, and audit logging. Access control follows the existing RBAC pattern with tenant isolation.

## Glossary

- **Document_Service**: The new Lambda function handling all `/documents/*` API routes.
- **Virtual_Folder**: A computed folder structure assembled dynamically from document metadata and the user's selected organization mode, without persisting folder records in the database.
- **Organization_Mode**: A user preference controlling folder hierarchy layout—either `category_site_year_month` (`{Category}/{Site}/{Year}/{Month}`) or `category_year_month_site` (`{Category}/{Year}/{Month}/{Site}`).
- **Document_Source**: One of the existing platform tables from which documents are aggregated: Reports, Forms, Certifications, Incidents, or Safety Evidence.
- **Batch_Download**: A ZIP archive containing multiple selected documents, generated in Lambda `/tmp` storage and uploaded to S3, with a presigned URL returned to the client.
- **Presigned_URL**: A time-limited S3 URL granting temporary read access to a specific object without requiring AWS credentials on the client.
- **Integrity_Verification**: The process of computing the current SHA-256 hash of a stored file and comparing it against the hash recorded at upload time.
- **Audit_Log_Entry**: A record of a document access event (download, view) stored for compliance traceability with a minimum retention of 365 days.
- **Authenticated_User**: A user whose identity and role have been validated via Cognito JWT claims, including tenant_id, user_id, role, and assigned_sites attributes.

## Requirements

### Requirement 1: Lambda Service Infrastructure

**User Story:** As a platform engineer, I want a dedicated Lambda function for the Document Explorer API, so that the service scales independently and follows the established service pattern.

#### Acceptance Criteria

1. THE Document_Service SHALL be deployed as a separate AWS Lambda function with Node.js 20 runtime on ARM64 architecture, bundled using esbuild following the same pattern as the forms and incidents services.
2. THE Document_Service SHALL be defined in a CDK construct that creates the Lambda function, API Gateway route integration under the `/documents` resource prefix, and grants read access to all Document_Source DynamoDB tables and the documents S3 bucket.
3. WHEN the Document_Service receives an OPTIONS request, THE Document_Service SHALL respond with HTTP 200 and appropriate CORS headers allowing GET, POST, and PUT methods.
4. THE Document_Service SHALL use the shared error-handler module to produce consistent error responses with code, message, request_id, and timestamp fields.
5. THE Document_Service SHALL use the shared logger module to emit structured JSON logs with service name, correlation_id, and tenant_id on every request.

### Requirement 2: Authentication and Authorization

**User Story:** As a tenant admin, I want the document service to enforce role-based access control, so that only authorized users can access documents within their scope.

#### Acceptance Criteria

1. WHEN a request arrives without a valid Cognito JWT token, THE Document_Service SHALL return HTTP 401 with code UNAUTHORIZED within 2 seconds.
2. THE Document_Service SHALL be accessible only to users with roles platform_admin, tenant_admin, site_admin, supervisor, or cso.
3. WHEN a user with role gate_operator or worker sends a request to the Document_Service, THE Document_Service SHALL return HTTP 403 with code FORBIDDEN.
4. WHILE a user with role site_admin or supervisor is querying documents, THE Document_Service SHALL filter results to include only documents associated with sites listed in the user's assigned_sites attribute.
5. WHILE a user with role tenant_admin or cso is querying documents, THE Document_Service SHALL return all documents within that user's tenant_id without site-level filtering.
6. WHILE a user with role platform_admin is querying documents, THE Document_Service SHALL return documents from all tenants without tenant or site filtering.
7. THE Document_Service SHALL enforce tenant isolation by including tenant_id in all DynamoDB query key conditions, so that no user can access documents belonging to a different tenant, except platform_admin users.

### Requirement 3: Folder Navigation Endpoint

**User Story:** As an audit user, I want to browse documents in a virtual folder hierarchy, so that I can locate documents organized by category, site, and date.

#### Acceptance Criteria

1. WHEN the Document_Service receives GET `/documents/folders` with a `path` query parameter, THE Document_Service SHALL return the list of sub-folders and documents at that path level, computed dynamically from document metadata in the source tables.
2. WHEN the `path` parameter is empty or absent, THE Document_Service SHALL return the root-level folders representing the five document categories: Reports, Forms, Certifications, Incidents, and Safety Evidence.
3. THE Document_Service SHALL support an `org_mode` query parameter accepting values `category_site_year_month` or `category_year_month_site` to determine the folder hierarchy structure below category level.
4. WHEN the `org_mode` parameter is `category_site_year_month`, THE Document_Service SHALL compute the folder path as `{Category}/{Site Name}/{Year}/{Month}` using each document's site_name and created_at date.
5. WHEN the `org_mode` parameter is `category_year_month_site`, THE Document_Service SHALL compute the folder path as `{Category}/{Year}/{Month}/{Site Name}` using each document's created_at date and site_name.
6. THE Document_Service SHALL support pagination via `page` (default 1) and `page_size` (default 50, maximum 100) query parameters, applying pagination to the documents within the current folder level.
7. THE Document_Service SHALL return a response body containing `currentPath`, `folders` (array of folder nodes with id, name, path, childFolderCount, documentCount, lastUpdated), `documents` (array of document summaries), `totalDocuments`, `page`, `pageSize`, and `totalPages`.
8. IF the specified path does not correspond to any valid folder for the current user's accessible documents, THEN THE Document_Service SHALL return HTTP 200 with an empty folders array and empty documents array.

### Requirement 4: Document Search Endpoint

**User Story:** As an audit user, I want to search documents by name and filter by attributes, so that I can quickly find specific documents without manual navigation.

#### Acceptance Criteria

1. WHEN the Document_Service receives GET `/documents/search` with a `q` query parameter, THE Document_Service SHALL return documents whose names contain the search term using case-insensitive partial matching across all accessible document sources.
2. WHEN the `q` parameter has a trimmed length less than 2, THE Document_Service SHALL return HTTP 400 with a validation error message.
3. THE Document_Service SHALL support optional filter parameters: `category` (one of reports, forms, certifications, incidents, safety_evidence), `date_from` (ISO date), `date_to` (ISO date), and `site_id`.
4. WHEN multiple filter parameters are provided, THE Document_Service SHALL apply all filters conjunctively, returning only documents matching all active criteria.
5. THE Document_Service SHALL support pagination via `page` (default 1) and `page_size` (default 50, maximum 100) query parameters.
6. THE Document_Service SHALL return a response body containing `results` (array of document summaries with matchFolderPath), `total`, `page`, and `pageSize`.
7. THE Document_Service SHALL complete search requests within 3 seconds for datasets of up to 10,000 documents per tenant.

### Requirement 5: Document Metadata Endpoint

**User Story:** As an audit user, I want to retrieve full metadata for a document, so that I can verify provenance and integrity during audits.

#### Acceptance Criteria

1. WHEN the Document_Service receives GET `/documents/{id}/metadata`, THE Document_Service SHALL return the full document detail including creation timestamp in ISO 8601 format with timezone, creator user ID and name, associated site, document category, file size, SHA-256 hash, download count, and last downloaded timestamp.
2. IF the document with the specified ID does not exist or is not accessible to the requesting user, THEN THE Document_Service SHALL return HTTP 404 with code NOT_FOUND.
3. IF any metadata field cannot be retrieved or computed, THEN THE Document_Service SHALL include that field with a null value and set the integrity status to `unavailable` for hash-related fields.
4. THE Document_Service SHALL return the integrity status as one of `verified`, `mismatch`, `pending`, or `unavailable` based on the last verification result stored for the document.

### Requirement 6: Document Preview Endpoint

**User Story:** As an audit user, I want to get a preview URL for a document, so that I can view documents in-browser without downloading them.

#### Acceptance Criteria

1. WHEN the Document_Service receives GET `/documents/{id}/preview`, THE Document_Service SHALL generate a presigned S3 URL for the document file with a 15-minute expiration and return it with the expiration timestamp.
2. IF the document with the specified ID does not exist or is not accessible to the requesting user, THEN THE Document_Service SHALL return HTTP 404 with code NOT_FOUND.
3. IF the document's MIME type is not previewable (not PDF, JPEG, or PNG), THEN THE Document_Service SHALL return HTTP 400 with a message indicating preview is not available for that format.

### Requirement 7: Download Endpoints

**User Story:** As an audit user, I want to download one or multiple documents, so that I can collect evidence for external audit processes.

#### Acceptance Criteria

1. WHEN the Document_Service receives POST `/documents/download` with a `documentIds` array containing exactly one ID, THE Document_Service SHALL generate a presigned S3 URL for the single document and return it with a downloadId, downloadUrl, expiresAt, totalSize, and fileCount of 1.
2. WHEN the Document_Service receives POST `/documents/download` with a `documentIds` array containing 2 to 50 IDs, THE Document_Service SHALL create a ZIP archive in Lambda `/tmp` storage containing all accessible documents, upload the ZIP to S3, and return a presigned URL with downloadId, downloadUrl, expiresAt, totalSize, and fileCount.
3. IF the `documentIds` array is empty or contains more than 50 items, THEN THE Document_Service SHALL return HTTP 400 with a validation error.
4. IF the combined size of requested documents exceeds 500 MB, THEN THE Document_Service SHALL return HTTP 413 with code PAYLOAD_TOO_LARGE and a message indicating the size limit.
5. IF one or more documents in a batch download are inaccessible, THEN THE Document_Service SHALL include the accessible documents in the ZIP and return a `skippedDocuments` array in the response listing each skipped document ID, name, and reason.
6. WHEN the Document_Service receives GET `/documents/download/{downloadId}/status`, THE Document_Service SHALL return the current status of the batch download as one of `preparing`, `ready`, `failed`, or `expired`, along with progress percentage and downloadUrl when ready.
7. IF the ZIP creation exceeds 120 seconds, THEN THE Document_Service SHALL abort the operation and set the download status to `failed` with an appropriate error message.
8. THE Document_Service SHALL set presigned download URLs to expire after 60 minutes.

### Requirement 8: Integrity Verification Endpoint

**User Story:** As an audit user, I want to verify the integrity of a stored document, so that I can confirm the file has not been tampered with since upload.

#### Acceptance Criteria

1. WHEN the Document_Service receives POST `/documents/{id}/verify-integrity`, THE Document_Service SHALL download the file from S3, compute its SHA-256 hash, compare it against the stored hash recorded at upload time, and return the result with storedHash, computedHash, match (boolean), and verifiedAt timestamp.
2. IF the document with the specified ID does not exist or is not accessible to the requesting user, THEN THE Document_Service SHALL return HTTP 404 with code NOT_FOUND.
3. IF the file cannot be retrieved from S3 for hash computation, THEN THE Document_Service SHALL return HTTP 503 with code SERVICE_UNAVAILABLE and a message indicating verification is temporarily unavailable.
4. WHEN verification completes, THE Document_Service SHALL persist the verification result (match status and timestamp) associated with the document for future metadata queries.

### Requirement 9: User Preferences Endpoints

**User Story:** As an audit user, I want to save my folder organization preference, so that the document explorer remembers my preferred view between sessions.

#### Acceptance Criteria

1. WHEN the Document_Service receives GET `/documents/preferences/organization-mode`, THE Document_Service SHALL return the authenticated user's stored organization mode preference, defaulting to `category_site_year_month` if no preference has been saved.
2. WHEN the Document_Service receives PUT `/documents/preferences/organization-mode` with a body containing `mode` set to either `category_site_year_month` or `category_year_month_site`, THE Document_Service SHALL persist the preference and return the saved mode.
3. IF the `mode` value in the PUT request body is not one of the two valid values, THEN THE Document_Service SHALL return HTTP 400 with a validation error.
4. THE Document_Service SHALL store user preferences in the existing UserPreferences DynamoDB table using the partition key pattern `USER#{user_id}` and sort key `PREF#document_explorer`.

### Requirement 10: Audit Logging Endpoint

**User Story:** As a compliance officer, I want document access events to be logged, so that audit trails demonstrate who accessed which documents and when.

#### Acceptance Criteria

1. WHEN the Document_Service receives POST `/documents/audit-log` with an event body containing eventType, documentIds, and userId, THE Document_Service SHALL store the audit log entry in the AuditTrail table with the provided data plus a server-generated timestamp in ISO 8601 format with timezone.
2. THE Document_Service SHALL retain audit log entries for a minimum of 365 days by setting a DynamoDB TTL value of at least 365 days from creation.
3. THE Document_Service SHALL validate that the eventType is one of `download_single` or `download_batch`, and that documentIds is a non-empty array of valid UUIDs.
4. IF the audit log request body fails validation, THEN THE Document_Service SHALL return HTTP 400 with a validation error detailing which fields are invalid.
5. WHEN a download is initiated via POST `/documents/download`, THE Document_Service SHALL automatically create an audit log entry recording the download event with the requesting user's identity, timestamp, and list of document IDs.

### Requirement 11: Document Source Aggregation

**User Story:** As a platform engineer, I want the service to dynamically query all document sources, so that newly created documents appear in the explorer without additional data pipelines.

#### Acceptance Criteria

1. THE Document_Service SHALL query existing DynamoDB tables (Reports, Forms, Certifications, Incidents, SafetyEvidence) to aggregate document listings, using each table's existing GSI indexes where available.
2. WHEN assembling folder contents, THE Document_Service SHALL derive the document category from the source table: Reports table maps to `reports`, Forms table maps to `forms`, Certifications table maps to `certifications`, Incidents table maps to `incidents`, and SafetyEvidence table maps to `safety_evidence`.
3. THE Document_Service SHALL extract common document fields (id, name, mimeType, fileSize, createdAt, siteName, siteId, tenantId, s3Key, sha256Hash) from each source table, mapping table-specific field names to the unified document schema.
4. IF a Document_Source table query fails, THEN THE Document_Service SHALL log the error and continue processing results from other available sources, returning partial results with an indication of which sources were unavailable.
5. THE Document_Service SHALL compute folder counts (childFolderCount, documentCount) and lastUpdated timestamps dynamically from the aggregated document set for the current path and user scope.

### Requirement 12: Error Handling and Resilience

**User Story:** As a platform engineer, I want the service to handle failures gracefully, so that partial data is still useful and errors are observable.

#### Acceptance Criteria

1. IF an unexpected error occurs during request processing, THEN THE Document_Service SHALL return HTTP 500 with code INTERNAL_ERROR and log the error with full stack trace, correlation_id, and tenant_id.
2. IF a DynamoDB query times out or returns a throttling exception, THEN THE Document_Service SHALL retry the operation once with exponential backoff before returning an error response.
3. IF an S3 operation fails during download or preview URL generation, THEN THE Document_Service SHALL return HTTP 503 with code SERVICE_UNAVAILABLE and include a retry-after header suggesting a 5-second delay.
4. THE Document_Service SHALL validate all request parameters using Zod schemas and return HTTP 400 with detailed validation errors for invalid inputs.
5. THE Document_Service SHALL set a Lambda timeout of 130 seconds to accommodate batch ZIP downloads that may take up to 120 seconds of processing.
