# Design Document: Incident Worker & Site Search

## Overview

This document describes the architecture and technical design for replacing the plain-text site_id input with a searchable Site selector and adding an optional Worker selector to the incident creation form. A reusable Combobox component provides the shared UI pattern, backed by debounced server-side filtering via new `search` query parameter support on the existing GET /workers and GET /sites endpoints.

## Architecture

The feature spans three layers:

1. **UI Component Layer** — A generic `Combobox` component in `packages/admin-portal/src/components/ui/Combobox.tsx` that encapsulates keyboard navigation, debounced input, dropdown rendering, ARIA attributes, and loading/error/empty states.
2. **Data Layer** — Two React Query hooks (`useWorkerSearch`, `useSiteSearch`) that manage server-side fetch, caching, and request cancellation.
3. **Backend Layer** — Filter logic added to the existing `handleListWorkers` and `handleListSites` functions, applying case-insensitive substring matching and a 20-item result cap when a `search` query parameter is present.

```
┌─────────────────────────────────────────────────────┐
│  IncidentCreateForm (Step 1 - Basic Information)    │
│  ┌───────────────┐  ┌───────────────────────────┐  │
│  │ Site Selector │  │ Worker Selector (optional) │  │
│  └──────┬────────┘  └──────────┬────────────────┘  │
│         │                      │                    │
│         ▼                      ▼                    │
│  ┌─────────────────────────────────────────┐        │
│  │         Combobox Component              │        │
│  │  (input + dropdown + keyboard nav)      │        │
│  └──────────────────┬──────────────────────┘        │
└─────────────────────┼───────────────────────────────┘
                      │ debounced search string
                      ▼
         ┌────────────────────────┐
         │  useSiteSearch /       │
         │  useWorkerSearch       │
         │  (React Query hooks)   │
         └───────────┬────────────┘
                     │ GET /sites?search=x
                     │ GET /workers?search=x
                     ▼
         ┌────────────────────────┐
         │  Backend Lambda        │
         │  (filter + limit 20)   │
         └────────────────────────┘
```

## Components and Interfaces

### 1. Combobox Component

**Path:** `packages/admin-portal/src/components/ui/Combobox.tsx`

A generic, accessible, reusable combobox built with Tailwind CSS. Renders a text input wired to a dropdown listbox. Manages internal state for: open/closed, highlighted index, input text (local), and selected value (controlled).

Key behaviors:
- Debounces `onSearchChange` callback by a configurable delay (default 300ms)
- Keyboard: ArrowDown/ArrowUp move highlight (clamped to list bounds), Enter selects highlighted, Escape closes
- Click outside closes dropdown without changing selection
- Displays loading spinner, empty state message, or error message inside the dropdown area
- ARIA: `role="combobox"`, `aria-expanded`, `aria-controls` pointing to listbox id, `aria-activedescendant` tracking highlighted option

### 2. Site Selector Integration

Replaces the existing `<Input label="Site ID" />` in `renderBasicInfoStep()` with a `<Controller>` wrapping the `Combobox`. The `useSiteSearch` hook supplies options. When a site is selected, `field.onChange(site.id)` is called. The display label format is `"{name} — {address}"`.

When `siteId` prop is provided, the component fetches the site by ID to display the initial label.

### 3. Worker Selector Integration

A new optional `<Controller>` field in `renderBasicInfoStep()` wrapping the `Combobox` with `useWorkerSearch`. The display label format is `"{legal_name}"` or `"{legal_name} ({preferred_name})"` when preferred_name exists. Clearing the field sets `field.onChange(undefined)`.

### 4. Backend Search Filtering

Both `handleListWorkers` and `handleListSites` are extended to read `queryStringParameters?.search`. When present, a DynamoDB `FilterExpression` applies case-insensitive `contains()` on the relevant fields and a `Limit` of 20 is enforced on the result set (post-filter slice).

### Combobox Props

```typescript
export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary text shown below the label */
  description?: string;
}

export interface ComboboxProps {
  /** Currently selected value (controlled) */
  value: string | undefined;
  /** Callback when selection changes */
  onChange: (value: string | undefined) => void;
  /** Options to display in the dropdown */
  options: ComboboxOption[];
  /** Callback with debounced search text */
  onSearchChange: (query: string) => void;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Label text above the input */
  label?: string;
  /** Validation error message */
  error?: string;
  /** Whether options are currently loading */
  isLoading?: boolean;
  /** Whether the fetch errored */
  isError?: boolean;
  /** Error message to display in dropdown */
  errorMessage?: string;
  /** Message when no results match */
  emptyMessage?: string;
  /** Debounce delay in milliseconds (default 300) */
  debounceMs?: number;
  /** Whether the field is disabled */
  disabled?: boolean;
}
```

### Search Hook Return Types

```typescript
interface UseSearchResult<T> {
  options: ComboboxOption[];
  rawData: T[];
  isLoading: boolean;
  isError: boolean;
  error: ApiClientError | null;
}

// useSiteSearch(query: string): UseSearchResult<Site>
// useWorkerSearch(query: string): UseSearchResult<Worker>
```

### Backend Response Shapes (unchanged structure, filtered)

```typescript
// GET /workers?search=abc → 200
interface WorkersResponse {
  workers: {
    worker_id: string;
    legal_name: string;
    preferred_name?: string;
    phone?: string;
    language_preference?: string;
    created_at: string;
  }[];
  total: number;
}

// GET /sites?search=abc → 200
interface SitesResponse {
  sites: {
    id: string;
    name: string;
    address: string;
    timezone?: string;
    status?: string;
    created_at: string;
  }[];
  total: number;
}
```

### Updated Incident Create Schema

```typescript
export const incidentCreateSchema = z
  .object({
    // ... existing fields unchanged ...
    site_id: z.string().min(1, 'Site is required'),
    worker_id: z.string().optional(), // NEW
    // ...
  })
  // existing refinements unchanged
```

### Updated CreateIncidentRequest

```typescript
export interface CreateIncidentRequest {
  // ... existing fields ...
  site_id: string;
  worker_id?: string; // NEW — included only when a worker is selected
}
```

## Data Models

No new DynamoDB tables or indexes are required. The existing Workers and Sites tables are queried with an additional client-side or `FilterExpression`-based filter.

**Workers Table Key Schema:**
- PK: `TENANT#{tenant_id}`
- SK: `WORKER#{worker_id}`
- Attributes used for filtering: `legal_name`, `preferred_name`

**Sites Table Key Schema:**
- PK: `TENANT#{tenant_id}`
- SK: `SITE#{site_id}`
- Attributes used for filtering: `name`, `address`

## Error Handling

| Scenario | Behavior |
|----------|----------|
| GET /workers or GET /sites returns 4xx/5xx | Combobox shows inline error message: "Unable to load results. Please try again." |
| Network timeout | React Query retry (up to 2 retries for 5xx) then displays error state |
| User types while a request is in-flight | Previous request is cancelled via `AbortController` (React Query built-in with `queryKey` change) |
| Empty search results | Combobox shows "No results found" message |
| site_id submitted empty | Zod validation blocks submission with "Site is required" error |
| worker_id submitted empty | Passes validation (optional field) |

## File Structure

```
packages/admin-portal/src/
├── components/ui/
│   └── Combobox.tsx                    # New reusable component
├── features/incidents/
│   ├── IncidentCreateForm.tsx          # Modified — replaces Input with Combobox
│   ├── schemas.ts                      # Modified — adds worker_id field
│   ├── types.ts                        # Modified — updates CreateIncidentRequest
│   └── hooks/
│       ├── useSiteSearch.ts            # New hook
│       └── useWorkerSearch.ts          # New hook

packages/backend/src/services/
├── identity/handler.ts                 # Modified — search filter in handleListWorkers
└── policy/handler.ts                   # Modified — search filter in handleListSites
```

## Testing Strategy

- **Property-based tests**: Backend filter functions (worker search, site search) and the Combobox keyboard navigation / selection logic are tested with property-based tests using generated inputs.
- **Unit tests**: Schema validation (site_id required, worker_id optional), payload construction, and option label formatting are covered with example-based unit tests.
- **Component tests**: Combobox rendering, ARIA attributes, loading/error/empty states, and integration with react-hook-form are covered with React Testing Library tests.
- **Integration tests**: End-to-end flow of typing in the selector, debouncing, API call, and selection are tested with mocked API responses.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Debounce delays emission

*For any* input string and any configured debounce delay, the `onSearchChange` callback SHALL NOT be invoked until the full delay has elapsed without further input changes.

**Validates: Requirements 1.2**

### Property 2: Keyboard navigation stays within bounds

*For any* list of N options (N ≥ 0) and any sequence of ArrowUp/ArrowDown key presses, the highlighted index SHALL always remain in the range [0, N-1] (or no highlight when N = 0).

**Validates: Requirements 1.3**

### Property 3: Selection stores value and displays label

*For any* option in the dropdown, selecting it SHALL cause the input to display that option's label AND the `onChange` callback to be called with that option's value.

**Validates: Requirements 1.4, 2.4, 3.4**

### Property 4: Dismiss preserves current selection

*For any* current selection state (selected or empty), pressing Escape or clicking outside the Combobox SHALL close the dropdown and the selected value SHALL remain unchanged.

**Validates: Requirements 1.5**

### Property 5: Clear resets selection to undefined

*For any* previously selected value, clearing the input text to empty SHALL invoke `onChange(undefined)` and reset the internal selected state.

**Validates: Requirements 1.11, 3.7**

### Property 6: ARIA attributes are consistent with state

*For any* combination of open/closed state and highlighted option index, the Combobox SHALL have `aria-expanded` equal to the open state, `aria-activedescendant` pointing to the highlighted option's ID (or absent when closed), and `aria-controls` pointing to the listbox element ID.

**Validates: Requirements 1.10**

### Property 7: Site option rendering completeness

*For any* site object with a `name` and `address`, the rendered option label SHALL contain both the site name and the site address.

**Validates: Requirements 2.3**

### Property 8: Worker option rendering completeness

*For any* worker object, the rendered option label SHALL contain the `legal_name`, and when `preferred_name` is present, the label SHALL also contain the `preferred_name`.

**Validates: Requirements 3.3**

### Property 9: Worker search filter correctness

*For any* set of workers and *for any* search string (including empty), the filter function SHALL return only workers whose `legal_name` or `preferred_name` contains the search string (case-insensitive), and when the search string is empty, all workers SHALL be returned.

**Validates: Requirements 4.1, 4.3**

### Property 10: Site search filter correctness

*For any* set of sites and *for any* search string (including empty), the filter function SHALL return only sites whose `name` or `address` contains the search string (case-insensitive), and when the search string is empty, all sites SHALL be returned.

**Validates: Requirements 4.2, 4.4**

### Property 11: Search result limit

*For any* dataset of workers or sites and *for any* non-empty search string, the response SHALL contain at most 20 items.

**Validates: Requirements 4.5, 4.6**

### Property 12: site_id required validation

*For any* form data where `site_id` is an empty string or undefined, schema validation SHALL fail with an error message.

**Validates: Requirements 2.5, 6.2**

### Property 13: worker_id optional validation

*For any* valid form data where `worker_id` is undefined or omitted, schema validation SHALL pass without error.

**Validates: Requirements 3.5, 6.1**

### Property 14: Payload conditional worker_id inclusion

*For any* valid form submission, the resulting request payload SHALL include `worker_id` if and only if a worker was selected (value is a non-empty string); otherwise `worker_id` SHALL be omitted from the payload.

**Validates: Requirements 6.3, 6.4**
