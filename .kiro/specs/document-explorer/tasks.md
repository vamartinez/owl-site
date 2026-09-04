# Implementation Plan: Document Explorer

## Overview

Implement the Document Explorer feature module within the admin portal. The module provides hierarchical folder navigation, document listing with pagination, search/filter, preview, download (single/batch), metadata display, integrity verification, and folder organization mode — all protected by role-based access control. Implementation follows a bottom-up approach: types/schemas → store → API hooks → components → page → router integration → tests.

## Tasks

- [x] 1. Set up types, schemas, and store foundation
  - [x] 1.1 Create TypeScript types file
    - Create `src/features/document-explorer/types.ts` with all type definitions: `DocumentCategory`, `OrganizationMode`, `PreviewableFormat`, `FolderNode`, `DocumentSummary`, `DocumentDetail`, `DocumentMetadataResponse`, `FolderContentsResponse`, `DocumentSearchResponse`, `DownloadInitResponse`, `BatchDownloadStatusResponse`, `IntegrityVerificationResponse`, `DocumentFilters`, `DownloadProgress`, `AuditLogEntry`
    - _Requirements: 1.2, 2.1, 3.2, 4.3, 6.6, 7.1_

  - [x] 1.2 Create Zod validation schemas
    - Create `src/features/document-explorer/schemas.ts` with runtime validation schemas: `documentCategorySchema`, `organizationModeSchema`, `documentFiltersSchema`, `downloadRequestSchema`, `folderNodeSchema`, `documentSummarySchema`, `folderContentsResponseSchema`
    - _Requirements: 2.1, 3.2, 4.3_

  - [x] 1.3 Create Zustand store
    - Create `src/features/document-explorer/store.ts` implementing `useDocExplorerStore` with navigation state (`currentPath`, `navigateTo`, `navigateUp`), selection state (`selectedDocumentIds`, `toggleDocumentSelection`, `selectAll`, `clearSelection`), preview state (`previewDocumentId`, `openPreview`, `closePreview`), search/filter state (`searchTerm`, `setSearchTerm`, `filters`, `setFilters`, `clearFilters`, `isSearchActive`), download progress state (`activeDownload`, `setDownloadProgress`), and organization mode (`organizationMode`, `setOrganizationMode`)
    - _Requirements: 1.1, 1.2, 3.3, 4.1, 4.5, 6.6_

  - [x] 1.4 Create utility functions for shared logic
    - Create `src/features/document-explorer/utils.ts` with: `isPreviewable(mimeType)` (returns true for PDF/JPEG/PNG), `isSearchTermValid(term)` (true if trimmed length >= 2), `canAccessDocumentExplorer(role)` (checks allowed roles), `computeOrganizationPath(document, mode)` (generates folder path array), `validateBatchDownloadSize(documents)` (checks <= 500MB), `calculateDownloadProgress(progress)` (computes percentage and ETA), `sortFolderContents(folders, documents)` (alphabetical with folders first), `matchesSearchTerm(documentName, searchTerm)` (case-insensitive partial match), `applyFilters(documents, filters)` (conjunctive filter logic), `formatBreadcrumbSegments(path)` (generates breadcrumb array)
    - _Requirements: 1.2, 2.2, 2.3, 3.2, 3.3, 4.1, 4.2, 4.4, 5.1, 6.6_

- [x] 2. Implement API client and React Query hooks
  - [x] 2.1 Create API client functions
    - Create `src/features/document-explorer/api.ts` with functions that call backend endpoints: `fetchFolderContents(path, page, pageSize, orgMode)`, `searchDocuments(query, filters, page)`, `fetchDocumentMetadata(id)`, `fetchDocumentPreview(id)`, `initiateDownload(documentIds)`, `pollDownloadStatus(downloadId)`, `verifyIntegrity(documentId)`, `getOrganizationMode()`, `setOrganizationMode(mode)`, `logAuditEvent(entry)`
    - Use the existing Cognito auth token from the auth store for Authorization headers
    - _Requirements: 1.1, 2.3, 3.1, 4.1, 7.1, 7.3, 7.5_

  - [x] 2.2 Create useFolders hook
    - Create `src/features/document-explorer/hooks/useFolders.ts` using `useQuery` from TanStack React Query. Query key includes current path and org mode from the store. Returns folder contents with loading/error states.
    - _Requirements: 1.1, 1.2, 1.6_

  - [x] 2.3 Create useDocuments hook
    - Create `src/features/document-explorer/hooks/useDocuments.ts` using `useQuery` for paginated documents in the current folder. Include page state and page size. Sort by createdAt descending by default.
    - _Requirements: 2.1, 2.2_

  - [x] 2.4 Create useDocumentSearch hook
    - Create `src/features/document-explorer/hooks/useDocumentSearch.ts` using `useQuery` with `enabled` flag gated by `isSearchTermValid`. Implements 500ms debounce via a debounced search term value. Combines search term with active filters.
    - _Requirements: 4.1, 4.2, 4.4, 4.7_

  - [x] 2.5 Create useDocumentPreview hook
    - Create `src/features/document-explorer/hooks/useDocumentPreview.ts` using `useQuery` to fetch presigned preview URL for a given document ID. Enabled only when previewDocumentId is set and document is previewable.
    - _Requirements: 2.3, 2.4_

  - [x] 2.6 Create useDocumentDownload hook
    - Create `src/features/document-explorer/hooks/useDocumentDownload.ts` using `useMutation` for initiating downloads and polling batch status. Manages download progress state in Zustand. Implements 120-second timeout, handles partial failures in batch downloads.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 2.7 Create useDocumentMetadata and useIntegrityVerify hooks
    - Create `src/features/document-explorer/hooks/useDocumentMetadata.ts` using `useQuery` to fetch full metadata for a document
    - Create `src/features/document-explorer/hooks/useIntegrityVerify.ts` using `useMutation` to trigger integrity verification and return result
    - _Requirements: 7.1, 7.4, 7.5_

  - [x] 2.8 Create useAuditLog and useOrganizationMode hooks
    - Create `src/features/document-explorer/hooks/useAuditLog.ts` using `useMutation` to POST audit log entries on successful downloads
    - Create `src/features/document-explorer/hooks/useOrganizationMode.ts` using `useQuery` + `useMutation` for GET/PUT organization preference with optimistic update
    - _Requirements: 6.6, 6.7, 7.3_

- [x] 3. Implement feature components (navigation and listing)
  - [x] 3.1 Create EmptyState component
    - Create `src/features/document-explorer/EmptyState.tsx` to display contextual messages for empty folders (Req 1.5) and no search results (Req 4.6). Include clear-filters action when in search mode.
    - _Requirements: 1.5, 4.6_

  - [x] 3.2 Create FolderTree component
    - Create `src/features/document-explorer/FolderTree.tsx` to render the folder hierarchy in a sidebar. Uses `useFolders` hook. Displays folder name, document count, and last-updated timestamp per folder. Handles folder click to navigate. Shows loading skeleton and error state with retry.
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 7.2_

  - [x] 3.3 Create DocumentList component
    - Create `src/features/document-explorer/DocumentList.tsx` using the shared `DataTable` and `Pagination` components. Renders document rows with name, type, creation date, site, and file size. Supports row selection (checkbox per row + select-all). Handles click to open preview. Sorted by creation date descending by default.
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 3.4 Create SearchFilters component
    - Create `src/features/document-explorer/SearchFilters.tsx` composing the shared `SearchBar` and `Filters` components. Wires search input to store `setSearchTerm`, filter dropdowns (category, date range, site) to store `setFilters`. Includes clear-all button. Enforces 2-character minimum before triggering search.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7_

  - [x] 3.5 Create FolderOrganizationSelector component
    - Create `src/features/document-explorer/FolderOrganizationSelector.tsx` as a dropdown that allows switching between `category_site_year_month` and `category_year_month_site` modes. Uses `useOrganizationMode` hook. Persists preference on change.
    - _Requirements: 6.6, 6.7_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement feature components (preview, download, metadata)
  - [x] 5.1 Create DocumentPreview component
    - Create `src/features/document-explorer/DocumentPreview.tsx` as a resizable side panel. Renders PDF via `<iframe>` and images via `<img>` using presigned URL from `useDocumentPreview`. Shows "Preview unavailable" with download button for non-previewable formats. Includes close button.
    - _Requirements: 2.3, 2.4_

  - [x] 5.2 Create DownloadProgressBar component
    - Create `src/features/document-explorer/DownloadProgressBar.tsx` showing percentage bar, bytes downloaded / total, and estimated time remaining. Handles timeout state display.
    - _Requirements: 3.3, 3.7_

  - [x] 5.3 Create DownloadActions component
    - Create `src/features/document-explorer/DownloadActions.tsx` with download button that triggers single or batch download based on selection count. Validates batch size (<=500MB, <=50 docs). Shows `DownloadProgressBar` during active download. Handles error states (network failure, timeout, partial failure summary). Preserves selection on error for retry.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 5.4 Create DocumentMetadata component
    - Create `src/features/document-explorer/DocumentMetadata.tsx` displaying full document detail: creation timestamp (ISO 8601), creator user, site, document type, SHA-256 hash, download count. Handles partial unavailability by showing "unavailable" for null fields.
    - _Requirements: 7.1, 7.4_

  - [x] 5.5 Create IntegrityVerification component
    - Create `src/features/document-explorer/IntegrityVerification.tsx` with a "Verify Integrity" button. Uses `useIntegrityVerify` mutation. Displays stored hash vs computed hash and match/mismatch status. Shows loading state during verification.
    - _Requirements: 7.5_

- [x] 6. Compose page and integrate router
  - [x] 6.1 Create DocumentExplorerPage
    - Create `src/pages/documents/DocumentExplorerPage.tsx` as the entry-point page component. Compose layout: Breadcrumbs (top), SearchFilters + FolderOrganizationSelector (toolbar), FolderTree (left sidebar on desktop), DocumentList (main content), DocumentPreview + DocumentMetadata + IntegrityVerification (right side panel when a document is selected), DownloadActions (action bar). Pass path from URL query param to store. Handle loading/error at page level.
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.3_

  - [x] 6.2 Add route and navigation entry
    - Update `src/app/router.tsx`: add lazy import for `DocumentExplorerPage`, add route `/documents` wrapped with `RoleGuard` using `documents.view` permission
    - Update sidebar navigation in `src/components/layout/Sidebar.tsx` to include Documents link with appropriate icon from lucide-react
    - Update RBAC hook/config to include `documents.view` permission mapping for roles: platform_admin, tenant_admin, site_admin, supervisor, cso
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Property-based tests
  - [x] 8.1 Write property test for alphabetical sorting
    - **Property 1: Folder contents are sorted alphabetically**
    - Create `src/features/document-explorer/__tests__/properties/sorting.property.test.ts`
    - Use fast-check to generate arbitrary arrays of folder names and document names. Verify `sortFolderContents` produces alphabetical order with folders before documents.
    - **Validates: Requirements 1.2**

  - [x] 8.2 Write property test for breadcrumb path completeness
    - **Property 2: Breadcrumb path completeness**
    - Create `src/features/document-explorer/__tests__/properties/breadcrumbs.property.test.ts`
    - Use fast-check to generate paths of depth 1-5. Verify `formatBreadcrumbSegments` produces array of length path.length + 1, each segment matching path ancestors.
    - **Validates: Requirements 1.3**

  - [x] 8.3 Write property test for document list field completeness
    - **Property 3: Document list renders all required fields**
    - Create in `sorting.property.test.ts` or separate file. Generate arbitrary `DocumentSummary` objects. Verify rendered output includes name, category, createdAt, siteName, fileSize.
    - **Validates: Requirements 2.1**

  - [x] 8.4 Write property test for default date sort order
    - **Property 4: Default document sort is descending by creation date**
    - Add to `src/features/document-explorer/__tests__/properties/sorting.property.test.ts`. Generate arrays of documents with random dates. Verify sort produces descending createdAt order.
    - **Validates: Requirements 2.2**

  - [x] 8.5 Write property test for preview eligibility
    - **Property 5: Preview eligibility classification**
    - Create `src/features/document-explorer/__tests__/properties/preview.property.test.ts`. Generate arbitrary mime type strings. Verify `isPreviewable` returns true only for 'application/pdf', 'image/jpeg', 'image/png'.
    - **Validates: Requirements 2.3, 2.4**

  - [x] 8.6 Write property test for batch download size validation
    - **Property 6: Batch download size validation**
    - Create `src/features/document-explorer/__tests__/properties/download.property.test.ts`. Generate arrays of 1-50 documents with random file sizes. Verify `validateBatchDownloadSize` allows iff total <= 500MB.
    - **Validates: Requirements 3.2, 3.5**

  - [x] 8.7 Write property test for download progress calculation
    - **Property 7: Download progress calculation**
    - Add to `download.property.test.ts`. Generate DownloadProgress states with valid bytesDownloaded/totalBytes. Verify percentage = (bytesDownloaded/totalBytes)*100 and ETA is non-negative.
    - **Validates: Requirements 3.3**

  - [x] 8.8 Write property test for case-insensitive partial matching
    - **Property 8: Case-insensitive partial name matching**
    - Create `src/features/document-explorer/__tests__/properties/search.property.test.ts`. Generate document names and substrings with random casing. Verify `matchesSearchTerm` returns true for valid substrings, false for non-substrings.
    - **Validates: Requirements 4.1**

  - [x] 8.9 Write property test for search trigger minimum length
    - **Property 9: Search trigger minimum length gate**
    - Add to `search.property.test.ts`. Generate strings of varying lengths. Verify `isSearchTermValid` returns true iff trimmed length >= 2.
    - **Validates: Requirements 4.2, 4.7**

  - [x] 8.10 Write property test for conjunctive filter intersection
    - **Property 10: Conjunctive filter intersection**
    - Create `src/features/document-explorer/__tests__/properties/filters.property.test.ts`. Generate documents and filter combinations. Verify `applyFilters` returns only documents satisfying ALL active criteria.
    - **Validates: Requirements 4.4**

  - [x] 8.11 Write property test for role-based access check
    - **Property 11: Role-based access check**
    - Create `src/features/document-explorer/__tests__/properties/access.property.test.ts`. Generate arbitrary role strings. Verify `canAccessDocumentExplorer` returns true only for the 5 allowed roles.
    - **Validates: Requirements 5.1, 5.3**

  - [x] 8.12 Write property test for organization mode path computation
    - **Property 12: Organization mode path computation**
    - Create `src/features/document-explorer/__tests__/properties/organization.property.test.ts`. Generate documents with random category, siteName, and createdAt. Verify `computeOrganizationPath` produces correct path for each mode.
    - **Validates: Requirements 6.6, 6.7**

  - [x] 8.13 Write property test for folder node count/timestamp display
    - **Property 13: Folder node displays count and timestamp**
    - Create `src/features/document-explorer/__tests__/properties/metadata.property.test.ts`. Generate FolderNode objects. Verify rendered output includes documentCount and lastUpdated.
    - **Validates: Requirements 7.2**

  - [x] 8.14 Write property test for metadata partial availability
    - **Property 14: Document metadata with partial availability**
    - Add to `metadata.property.test.ts`. Generate DocumentDetail with random null fields. Verify all expected metadata fields are either rendered with value or marked "unavailable".
    - **Validates: Requirements 7.1, 7.4**

- [x] 9. Unit and integration tests
  - [x] 9.1 Write unit tests for components
    - Create `src/features/document-explorer/__tests__/FolderTree.test.tsx` — test rendering folders, click navigation, loading state, error with retry
    - Create `src/features/document-explorer/__tests__/DocumentList.test.tsx` — test rendering rows, pagination, selection, empty state
    - Create `src/features/document-explorer/__tests__/DocumentPreview.test.tsx` — test PDF/image rendering, non-previewable format message
    - Create `src/features/document-explorer/__tests__/SearchFilters.test.tsx` — test search input, filter application, clear filters
    - Create `src/features/document-explorer/__tests__/DownloadActions.test.tsx` — test download button states, progress, error, partial failure
    - Create `src/features/document-explorer/__tests__/DocumentMetadata.test.tsx` — test full metadata render, partial null handling
    - _Requirements: 1.1, 1.5, 1.6, 1.7, 2.1, 2.3, 2.4, 2.5, 3.1, 3.3, 3.4, 3.5, 3.6, 4.1, 4.6, 7.1, 7.4_

  - [x] 9.2 Write integration test for page composition
    - Create `src/features/document-explorer/__tests__/DocumentExplorerPage.test.tsx` — test full page render with mocked hooks, navigation flow (folder click → breadcrumb back), search/filter interaction, download flow end-to-end with mocked API
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 4.1, 4.5_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout; all implementations use the project's existing React + TypeScript stack
- Shared components (DataTable, Pagination, SearchBar, Filters, Breadcrumbs) are reused from `src/components/`
- All API calls go through Cognito authentication consistent with the existing auth store pattern

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8"] },
    { "id": 4, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["6.2"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "8.11", "8.12", "8.13", "8.14"] },
    { "id": 9, "tasks": ["9.1", "9.2"] }
  ]
}
```
