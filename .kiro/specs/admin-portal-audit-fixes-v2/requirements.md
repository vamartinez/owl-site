# Requirements — Admin Portal Audit Fixes V2 (Residual Issues)

## Overview

This spec addresses residual issues identified during independent verification of the `admin-portal-audit-fixes` implementation. Three bugs were marked complete but are not actually resolved, and one has a latent defect that will surface at scale.

---

## Requirement 1: Report Validation API Gateway Resource (Bug 5 Real Fix)

### 1.1
GIVEN the `report-validation` Lambda handler exists at `packages/backend/src/services/report-validation/handler.ts`
WHEN a platform_admin user calls `GET /report-validation/reports`
THEN the request MUST reach the Lambda (not return 403 from API Gateway due to missing resource)
AND the response MUST contain a list of reports or an empty array

### 1.2
GIVEN the API Gateway stack (`api-stack.ts`)
WHEN the CDK stack is synthesized
THEN there MUST be a Lambda function declaration for the `report-validation` service
AND there MUST be API Gateway resources for all report-validation routes:
  - `POST /report-validation/reports`
  - `GET /report-validation/reports`
  - `GET /report-validation/reports/{id}`
  - `POST /report-validation/reports/{id}/validate`
  - `POST /report-validation/reports/{id}/versions`
  - `POST /report-validation/reports/{id}/submit`
  - `GET /report-validation/reports/{id}/history`
  - `POST /report-validation/kb/documents`
  - `GET /report-validation/kb/documents`
  - `DELETE /report-validation/kb/documents/{id}`

### 1.3
GIVEN the report-validation Lambda function
WHEN declared in api-stack.ts
THEN it MUST use the same Cognito authorizer as other API routes
AND it MUST have read/write access to all DynamoDB tables (same as other services)
AND it MUST have S3 read/write access to the media bucket (for document upload/retrieval)

---

## Requirement 2: Contractors Total Count (Latent Pagination Bug)

### 2.1
GIVEN the `listContractors` function in `packages/backend/src/services/contractors/contractor.ts`
WHEN a tenant has more contractors than the page size (default 20)
THEN the response MUST include a `total` field with the accurate total count across all pages
AND the `total` MUST be computed via a `Select: 'COUNT'` query (no `Limit`) on the same partition key

### 2.2
GIVEN the frontend `ContractorList.tsx`
WHEN the backend returns a response with a `total` field
THEN the header MUST prefer `data.total` over `data.contractors.length`
AND when `total` is not present, fall back to `data.contractors.length`

---

## Requirement 3: Site Profile Detail Page Compliance Display

### 3.1
GIVEN the `SiteProfile.tsx` detail page (line ~98)
WHEN `data.compliancePercent` is undefined or null
THEN the compliance stat card MUST display "N/A" instead of bare `%`
AND the display MUST match the fix already applied to the Sites list page

### 3.2
GIVEN the `SiteProfile.tsx` detail page
WHEN `data.activeWorkers` is undefined or null
THEN the active workers stat card MUST display "0" or "N/A" instead of "undefined"

### 3.3
GIVEN the `SiteProfile.tsx` detail page
WHEN `data.contractor` is undefined or null
THEN the contractor stat card MUST display "N/A" or "Not assigned" instead of "undefined"

---

## Requirement 4: Preservation

### 4.1
GIVEN all other API routes in `api-stack.ts`
WHEN the report-validation Lambda and resources are added
THEN no existing routes or Lambda functions MUST be modified or broken

### 4.2
GIVEN existing contractors with fewer items than the page size
WHEN the `total` field is added to `listContractors`
THEN the response MUST still include `contractors` and `nextCursor` unchanged

### 4.3
GIVEN `SiteProfile.tsx` with valid numeric `compliancePercent`
WHEN the page renders
THEN the display MUST show `{compliancePercent}%` exactly as before (no regression)
