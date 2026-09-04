# Implementation Plan: Incident Worker & Site Search

## Overview

Replace the plain-text site_id input with a searchable Site selector and add an optional Worker selector to the incident creation form. This involves creating a reusable Combobox component, two React Query search hooks, backend search/filter support on existing endpoints, and schema updates.

## Tasks

- [x] 1. Create reusable Combobox component
  - [x] 1.1 Implement the Combobox component with keyboard navigation, debounced search, dropdown rendering, and ARIA attributes
    - Create `packages/admin-portal/src/components/ui/Combobox.tsx`
    - Implement `ComboboxProps` interface as defined in design (value, onChange, options, onSearchChange, placeholder, label, error, isLoading, isError, errorMessage, emptyMessage, debounceMs, disabled)
    - Implement internal state management for open/closed, highlighted index, and input text
    - Implement debounced `onSearchChange` callback (default 300ms)
    - Implement keyboard handling: ArrowDown/ArrowUp move highlight (clamped), Enter selects, Escape closes
    - Implement click-outside to close without changing selection
    - Render loading spinner, empty state message, or error message inside dropdown
    - Add ARIA attributes: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`
    - Style using Tailwind CSS consistent with existing Input and Select components
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11_

  - [x] 1.2 Write property tests for Combobox debounce and keyboard navigation
    - **Property 1: Debounce delays emission**
    - **Property 2: Keyboard navigation stays within bounds**
    - **Property 4: Dismiss preserves current selection**
    - **Validates: Requirements 1.2, 1.3, 1.5**

  - [x] 1.3 Write property tests for Combobox selection and ARIA
    - **Property 3: Selection stores value and displays label**
    - **Property 5: Clear resets selection to undefined**
    - **Property 6: ARIA attributes are consistent with state**
    - **Validates: Requirements 1.4, 1.10, 1.11**

- [x] 2. Add backend search filtering for workers and sites
  - [x] 2.1 Add search filter to `handleListWorkers` in the Identity Service
    - Modify `packages/backend/src/services/identity/handler.ts`
    - Read `queryStringParameters?.search` from the event
    - When `search` is present, apply case-insensitive `contains` filter on `legal_name` and `preferred_name`
    - Limit filtered results to 20 items (post-filter slice)
    - When no `search` param is provided, maintain existing behavior (unfiltered list)
    - _Requirements: 4.1, 4.3, 4.5_

  - [x] 2.2 Add search filter to `handleListSites` in the Policy Service
    - Modify `packages/backend/src/services/policy/handler.ts`
    - Read `queryStringParameters?.search` from the event
    - When `search` is present, apply case-insensitive `contains` filter on `name` and `address`
    - Limit filtered results to 20 items (post-filter slice)
    - When no `search` param is provided, maintain existing behavior (unfiltered list)
    - _Requirements: 4.2, 4.4, 4.6_

  - [x] 2.3 Write property tests for backend search filter logic
    - **Property 9: Worker search filter correctness**
    - **Property 10: Site search filter correctness**
    - **Property 11: Search result limit**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create React Query search hooks
  - [x] 4.1 Implement `useSiteSearch` hook
    - Create `packages/admin-portal/src/features/incidents/hooks/useSiteSearch.ts`
    - Use `@tanstack/react-query` with query key `['sites', query]`
    - Fetch from GET /sites?search={query} using existing API client
    - Map response sites to `ComboboxOption[]` with label format `"{name} — {address}"`
    - Return `{ options, rawData, isLoading, isError, error }`
    - Set appropriate `staleTime` to avoid redundant requests
    - Fetch unfiltered list when query is empty
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 2.2_

  - [x] 4.2 Implement `useWorkerSearch` hook
    - Create `packages/admin-portal/src/features/incidents/hooks/useWorkerSearch.ts`
    - Use `@tanstack/react-query` with query key `['workers', query]`
    - Fetch from GET /workers?search={query} using existing API client
    - Map response workers to `ComboboxOption[]` with label format `"{legal_name}"` or `"{legal_name} ({preferred_name})"` when preferred_name exists
    - Return `{ options, rawData, isLoading, isError, error }`
    - Set appropriate `staleTime` to avoid redundant requests
    - Fetch unfiltered list when query is empty
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 3.2_

  - [x] 4.3 Write property tests for option label formatting
    - **Property 7: Site option rendering completeness**
    - **Property 8: Worker option rendering completeness**
    - **Validates: Requirements 2.3, 3.3**

- [x] 5. Update form schema and types
  - [x] 5.1 Add `worker_id` to the incident create schema and types
    - Modify `packages/admin-portal/src/features/incidents/schemas.ts` — add `worker_id: z.string().optional()` to `incidentCreateSchema`
    - Modify `packages/admin-portal/src/features/incidents/types.ts` — add `worker_id?: string` to `CreateIncidentRequest`
    - _Requirements: 6.1, 6.2_

  - [x] 5.2 Write property tests for schema validation
    - **Property 12: site_id required validation**
    - **Property 13: worker_id optional validation**
    - **Validates: Requirements 2.5, 3.5, 6.1, 6.2**

- [x] 6. Integrate selectors into the Incident Create Form
  - [x] 6.1 Replace plain text site_id Input with the Site Selector Combobox
    - Modify `packages/admin-portal/src/features/incidents/IncidentCreateForm.tsx`
    - Replace the `<Input label="Site ID" />` in `renderBasicInfoStep()` with a `<Controller>` wrapping the Combobox
    - Wire `useSiteSearch` hook to supply options
    - On selection, call `field.onChange(site.id)`
    - When `siteId` prop is provided, fetch and display the site name as initial label
    - Display validation error from `errors.site_id`
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 6.2 Add Worker Selector Combobox as an optional field
    - Add a new `<Controller>` field in `renderBasicInfoStep()` for the Worker Selector
    - Wire `useWorkerSearch` hook to supply options
    - On selection, call `field.onChange(worker.worker_id)`
    - On clear, call `field.onChange(undefined)`
    - Display worker legal_name and preferred_name in options
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 6.3 Update form submission to conditionally include worker_id in payload
    - Include `worker_id` in the `CreateIncidentRequest` payload only when a worker is selected (non-empty string)
    - Omit `worker_id` from payload when no worker is selected
    - _Requirements: 6.3, 6.4_

  - [x] 6.4 Write property test for payload conditional worker_id inclusion
    - **Property 14: Payload conditional worker_id inclusion**
    - **Validates: Requirements 6.3, 6.4**

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation language is TypeScript throughout (React + Node.js Lambda)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.3", "4.1", "4.2", "5.2"] },
    { "id": 2, "tasks": ["4.3", "6.1", "6.2"] },
    { "id": 3, "tasks": ["6.3", "6.4"] }
  ]
}
```
