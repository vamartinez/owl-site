# Implementation Plan: Worker Certification Upload

## Overview

This plan implements the certification management UI for the Worker Profile Page. It follows an incremental approach: types and schemas first, then utility functions, hooks, components, and finally integration into the existing Worker Profile Page. Property-based tests validate correctness properties from the design, and unit tests cover component behavior.

## Tasks

- [x] 1. Set up feature module structure, types, and validation schemas
  - [x] 1.1 Create types and enums for certifications
    - Create `src/features/certifications/types.ts` with `CertificationType`, `CertificationStatus`, `Certification`, `ExpiryStatus` types, and API request/response interfaces
    - Create `src/features/certifications/index.ts` barrel export
    - _Requirements: 1.2, 2.2_

  - [x] 1.2 Create Zod validation schemas
    - Create `src/features/certifications/schemas.ts` with `certificationFormSchema` (type, issuer, dates, file validation with MIME type and size checks, date ordering refinement) and `rejectionReasonSchema`
    - Define `ALLOWED_MIME_TYPES` and `MAX_FILE_SIZE` constants
    - _Requirements: 2.4, 2.6, 2.7, 3.4_

  - [x] 1.3 Create expiry classification utility
    - Create `src/features/certifications/utils/classifyExpiry.ts` implementing `classifyExpiry(expiryDate: string): ExpiryStatus` that returns `'expired'`, `'expiring'`, or `'valid'` based on 30-day threshold
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 1.4 Write property tests for validation schemas (Properties 3, 4, 9)
    - Create `src/features/certifications/__tests__/validation.property.test.ts`
    - Install `fast-check` as a dev dependency
    - **Property 3: Date ordering validation** — For any pair of ISO date strings, schema rejects iff expiry_date ≤ issue_date
    - **Property 4: Document file validation** — For any file, schema accepts iff MIME ∈ [pdf, jpeg, png] AND size ≤ 10 MB
    - **Property 9: Rejection reason minimum length** — For any string, rejectionReasonSchema rejects iff length < 10
    - **Validates: Requirements 2.4, 2.6, 2.7, 3.4**

  - [x] 1.5 Write property tests for expiry classification (Properties 5, 6)
    - Create `src/features/certifications/__tests__/classifyExpiry.property.test.ts`
    - **Property 5: Expiry classification correctness** — For any date, classifyExpiry returns correct category based on 30-day threshold
    - **Property 6: Expiry summary count consistency** — For any array of certifications, count of each category matches filter results
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 2. Implement custom hooks for API communication
  - [x] 2.1 Create useCertifications hook
    - Create `src/features/certifications/hooks/useCertifications.ts` wrapping `useApiQuery` for GET /workers/{id}/certifications
    - Return sorted list (ascending by expiry_date)
    - _Requirements: 1.1, 1.5_

  - [x] 2.2 Create useCreateCertification hook
    - Create `src/features/certifications/hooks/useCreateCertification.ts` wrapping `useApiMutation` for POST /workers/{id}/certifications
    - On success, trigger S3 upload via `useUploadToS3` and invalidate certifications query
    - _Requirements: 2.8, 2.9, 2.10_

  - [x] 2.3 Create useUpdateCertification hook
    - Create `src/features/certifications/hooks/useUpdateCertification.ts` wrapping `useApiMutation` for PATCH /workers/{id}/certifications/{certId}
    - Implement optimistic update with rollback on error
    - _Requirements: 3.2, 3.5, 3.6_

  - [x] 2.4 Create useUploadToS3 hook
    - Create `src/features/certifications/hooks/useUploadToS3.ts` using XMLHttpRequest for S3 PUT with progress tracking
    - Implement abort on unmount via useEffect cleanup
    - Implement single retry on first failure
    - Expose `upload`, `progress`, `isUploading`, `error`, `abort`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 2.9, 2.12_

  - [x] 2.5 Write property test for sort order (Property 2)
    - Create `src/features/certifications/__tests__/sortCertifications.property.test.ts`
    - **Property 2: Default sort order invariant** — For any list of certifications, output is sorted by expiry_date ascending
    - **Validates: Requirements 1.5**

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement UI components
  - [x] 4.1 Create ExpiryBadge component
    - Create `src/features/certifications/ExpiryBadge.tsx` rendering green/amber/red badge using `classifyExpiry` and the existing `Badge` component
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 4.2 Create UploadProgressBar component
    - Create `src/features/certifications/UploadProgressBar.tsx` displaying upload percentage with accessible progress bar
    - _Requirements: 5.1, 5.3_

  - [x] 4.3 Create CertificationSummary component
    - Create `src/features/certifications/CertificationSummary.tsx` displaying counts of expiring and expired certifications at top of list
    - Use `classifyExpiry` to compute counts from certification array
    - _Requirements: 4.4_

  - [x] 4.4 Create CertificationList component
    - Create `src/features/certifications/CertificationList.tsx` using `DataTable` to render certification rows with type, issuer, dates, status, and ExpiryBadge
    - Integrate `useCertifications` hook, loading skeleton, error state with retry, and empty state
    - Include CertificationSummary at top
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 4.5 Create ValidationPanel component
    - Create `src/features/certifications/ValidationPanel.tsx` with Validate/Reject buttons gated by `useRBAC` (`certifications.validate` permission)
    - On Reject click, show rejection reason input validated by `rejectionReasonSchema`
    - Wire to `useUpdateCertification` hook
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 4.6 Create CertificationForm modal component
    - Create `src/features/certifications/CertificationForm.tsx` using `Modal`, react-hook-form with zodResolver, and all form fields (type select, issuer input, date inputs, file input)
    - Support re-upload mode via `existingCertification` prop (pre-fill metadata, allow only file change)
    - Integrate `useCreateCertification` and `useUploadToS3` hooks
    - Show UploadProgressBar during upload, disable submit button while uploading
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 5.1, 5.2, 5.3, 6.2, 6.3_

  - [x] 4.7 Write property tests for action buttons and RBAC (Properties 7, 8)
    - Create `src/features/certifications/__tests__/actionButtons.property.test.ts`
    - **Property 7: Action buttons determined by certification status** — For any certification, visible buttons match status rules (pending→Validate/Reject, rejected→Re-upload, validated/expired→none)
    - **Property 8: RBAC permission gating** — For any user role, Validate/Reject buttons visible iff role has `certifications.validate` permission
    - **Validates: Requirements 3.1, 3.7, 6.1**

  - [x] 4.8 Write property test for certification display completeness (Property 1)
    - Create `src/features/certifications/__tests__/renderCertRow.property.test.ts`
    - **Property 1: Certification display completeness** — For any valid Certification object, rendered row contains type, issuer, issue_date, expiry_date, and validation_status
    - **Validates: Requirements 1.2**

- [x] 5. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Integrate into Worker Profile Page and wire Re-upload flow
  - [x] 6.1 Integrate CertificationList into Worker Profile Page
    - Add CertificationList component to the existing Worker Profile Page below worker details
    - Add "Add Certification" button that opens CertificationForm modal
    - Wire "Re-upload" button on rejected certifications to open CertificationForm in re-upload mode
    - _Requirements: 1.1, 2.1, 6.1, 6.2, 6.4_

  - [x] 6.2 Write unit tests for CertificationList and CertificationForm
    - Create `src/features/certifications/__tests__/CertificationList.test.tsx` — test loading skeleton, error with retry, empty state, renders rows
    - Create `src/features/certifications/__tests__/CertificationForm.test.tsx` — test renders all fields, pre-fills in re-upload mode, shows validation errors
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 6.2_

  - [x] 6.3 Write unit tests for ValidationPanel and useUploadToS3
    - Create `src/features/certifications/__tests__/ValidationPanel.test.tsx` — test shows reason input on Reject, calls PATCH on Validate, hides buttons without permission
    - Create `src/features/certifications/__tests__/useUploadToS3.test.ts` — test abort on unmount, retry on failure, progress updates
    - _Requirements: 3.1, 3.3, 3.7, 5.1, 5.4, 2.12_

- [x] 7. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- `fast-check` must be installed as a dev dependency before running property tests
- All components reuse existing shared UI primitives (Modal, DataTable, Badge, Button, Input, Select, ErrorDisplay)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "2.1", "2.4"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.5"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 5, "tasks": ["4.4", "4.5", "4.6"] },
    { "id": 6, "tasks": ["4.7", "4.8"] },
    { "id": 7, "tasks": ["6.1"] },
    { "id": 8, "tasks": ["6.2", "6.3"] }
  ]
}
```
