# Implementation Plan: Certification Document Viewer

## Overview

This plan implements inline document preview for the admin portal's certification management table. The implementation adds a backend endpoint to generate S3 signed read URLs, a frontend hook to fetch those URLs, and a modal component that renders PDFs via iframe and images via img elements. Tasks are ordered so backend work completes first, then frontend components build incrementally on each other.

## Tasks

- [ ] 1. Backend: Add signed URL generation for document reads
  - [ ] 1.1 Implement `generateReadUrl` and `inferContentType` functions in certification.ts
    - Add `GetObjectCommand` import from `@aws-sdk/client-s3`
    - Implement `inferContentType(documentKey: string): string` that maps `.pdf` → `application/pdf`, `.jpg`/`.jpeg` → `image/jpeg`, `.png` → `image/png`, default → `application/octet-stream`
    - Implement `generateReadUrl(documentKey: string): Promise<{ read_url: string; content_type: string }>` using `getSignedUrl` with `SIGNED_URL_EXPIRY_SECONDS`
    - Export both functions
    - _Requirements: 5.2, 5.3, 5.6_

  - [ ]* 1.2 Write property test for `inferContentType`
    - **Property 4: Content type inference from document key**
    - **Validates: Requirements 3.1, 4.1, 5.6**

  - [ ] 1.3 Add `handleGetDocumentUrl` route handler in handler.ts
    - Import `generateReadUrl` from `./certification.js`
    - Add route matching for `GET /workers/{id}/certifications/{certId}/document-url`
    - Authenticate request and enforce `certifications:read` permission
    - Look up certification via `getCertification(tenant_id, workerId, certId)`
    - Return 404 if certification not found
    - Return 404 with "No document is associated with this certification" if `document_key` is falsy
    - Call `generateReadUrl(certification.document_key)` and return `{ url, content_type }` with 200
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

  - [ ] 1.4 Add API Gateway route for the document-url endpoint in api-stack.ts
    - Add `const workerCertDocumentUrl = workerCertId.addResource('document-url');`
    - Add `workerCertDocumentUrl.addMethod('GET', identityIntegration, authorizedMethodOptions);`
    - _Requirements: 5.1_

- [ ] 2. Checkpoint - Backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Frontend: Add document URL hook and viewer modal
  - [ ] 3.1 Create `useDocumentUrl` hook in hooks/useDocumentUrl.ts
    - Create file at `packages/admin-portal/src/features/certifications/hooks/useDocumentUrl.ts`
    - Define `DocumentUrlResponse` interface with `url: string` and `content_type: string`
    - Implement hook using `useQuery` from `@tanstack/react-query`
    - Query key: `['document-url', workerId, certificationId]`
    - Accept `enabled` parameter to only fetch when modal is open
    - Set `staleTime` to 10 minutes (less than URL expiry)
    - Disable retry on 404 errors
    - _Requirements: 6.1, 6.2_

  - [ ] 3.2 Create `DocumentViewerModal` component
    - Create file at `packages/admin-portal/src/features/certifications/DocumentViewerModal.tsx`
    - Import and use the existing `Modal` component with `size="lg"`
    - Use `useDocumentUrl` hook with `enabled` tied to `open` prop
    - Render loading spinner while `isLoading` is true
    - Render error state with retry button when `error` is present (show "Document not found" for 404, generic message with retry for other errors)
    - Render `DocumentRenderer` when `data` is available
    - Implement `DocumentRenderer` inline or as a sub-component:
      - Render `<iframe>` with `src={url}` when `content_type === 'application/pdf'`
      - Render `<img>` with `src={url}` and descriptive `alt` when `content_type` is `image/jpeg` or `image/png`
      - Handle `onError` on both elements to show render failure message
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 4.1, 4.2, 4.3, 6.1, 6.2, 7.1, 7.2, 7.3_

  - [ ]* 3.3 Write unit tests for `DocumentViewerModal`
    - Test loading state renders spinner
    - Test error state renders error message with retry
    - Test PDF content type renders iframe
    - Test image content type renders img with alt text
    - Test onError handler shows render failure message
    - _Requirements: 3.1, 4.1, 6.1, 7.1, 7.2, 7.3_

- [ ] 4. Frontend: Integrate View button into CertificationList
  - [ ] 4.1 Add View button and modal state to CertificationList
    - Add `useState` for `selectedCertification` (the cert to view) and `isViewerOpen` boolean
    - Add `openViewer(cert)` and `closeViewer()` handlers
    - In the actions column, render a "View" `Button` (variant="outline", size="sm") when `cert.document_key` is truthy
    - Render `DocumentViewerModal` at the bottom of the component, passing `open`, `onClose`, `certification`, and `workerId`
    - Ensure existing action buttons (ValidationPanel, Re-upload) remain alongside the new View button
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_

  - [ ]* 4.2 Write property test for View button visibility
    - **Property 1: View button visibility is determined by document_key**
    - **Validates: Requirements 1.1, 1.2**

- [ ] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The project uses TypeScript throughout (backend Node.js Lambda, frontend React with Vite)
- The existing `Modal` component uses the native `<dialog>` element with backdrop click handling already built in
- The `useQuery` pattern from `@tanstack/react-query` is already established in the hooks directory

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["3.3", "4.1"] },
    { "id": 5, "tasks": ["4.2"] }
  ]
}
```
