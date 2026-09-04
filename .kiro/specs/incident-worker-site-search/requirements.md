# Requirements Document

## Introduction

This feature enhances the incident creation and editing form by replacing the plain text site_id input with a searchable Site selector and adding a new optional searchable Worker selector. Both selectors use a custom reusable Combobox/Autocomplete component built with Tailwind CSS, server-side filtering via debounced API requests, and integrate with the existing react-hook-form + zod validation stack.

## Glossary

- **Combobox**: A custom reusable UI component that combines a text input with a dropdown list, supporting keyboard navigation, server-side search, and accessible interactions.
- **Incident_Form**: The multi-step incident creation and editing form located in the admin-portal, using react-hook-form with zod validation.
- **Worker_Selector**: An instance of the Combobox configured to search and select workers from the GET /workers endpoint.
- **Site_Selector**: An instance of the Combobox configured to search and select sites from the GET /sites endpoint.
- **Search_Query**: A text string entered by the user into the Combobox input field to filter results server-side.
- **Debounce_Delay**: A configurable time interval (default 300ms) that delays API requests until the user stops typing.
- **Identity_Service**: The backend service exposing the GET /workers endpoint.
- **Policy_Service**: The backend service exposing the GET /sites endpoint.

## Requirements

### Requirement 1: Reusable Combobox Component

**User Story:** As a developer, I want a reusable Combobox/Autocomplete component, so that I can use it for both worker and site selection without duplicating code.

#### Acceptance Criteria

1. THE Combobox SHALL render a text input field and a dropdown list of options.
2. WHEN the user types a Search_Query into the Combobox input, THE Combobox SHALL emit the Search_Query value after the configured Debounce_Delay elapses.
3. WHILE the Combobox dropdown is open, THE Combobox SHALL support keyboard navigation using Arrow Up, Arrow Down, Enter, and Escape keys.
4. WHEN the user selects an option from the dropdown, THE Combobox SHALL display the selected option label in the input field and close the dropdown.
5. WHEN the user presses Escape or clicks outside the Combobox, THE Combobox SHALL close the dropdown without changing the current selection.
6. THE Combobox SHALL accept an `error` prop and display validation error messages below the input when present.
7. THE Combobox SHALL be styled using Tailwind CSS classes consistent with the existing Input and Select components.
8. WHILE the Combobox is loading results, THE Combobox SHALL display a loading indicator within the dropdown area.
9. WHEN the API returns zero matching results, THE Combobox SHALL display an empty state message within the dropdown.
10. THE Combobox SHALL implement WAI-ARIA combobox pattern attributes including `role="combobox"`, `aria-expanded`, `aria-activedescendant`, and `aria-controls`.
11. WHEN the user clears the input field, THE Combobox SHALL reset the selected value and notify the parent form via the onChange callback.

### Requirement 2: Site Selector in Incident Form

**User Story:** As a user creating an incident, I want to search and select a site from a dropdown, so that I can accurately associate the incident with the correct site without memorizing site IDs.

#### Acceptance Criteria

1. THE Incident_Form SHALL display the Site_Selector in Step 1 (Basic Information) in place of the existing plain text site_id Input field.
2. WHEN the user types a Search_Query into the Site_Selector, THE Site_Selector SHALL send a GET request to the Policy_Service /sites endpoint with the Search_Query as a filter parameter after the Debounce_Delay.
3. THE Site_Selector SHALL display site name and address in each dropdown option to help distinguish sites.
4. WHEN the user selects a site, THE Site_Selector SHALL store the site_id value in the form state via react-hook-form.
5. THE Site_Selector SHALL remain a required field with zod validation enforcing a non-empty site_id value.
6. IF the GET /sites request fails, THEN THE Site_Selector SHALL display an error message within the dropdown indicating the search could not be completed.
7. WHEN the Incident_Form receives a pre-populated siteId prop, THE Site_Selector SHALL display the corresponding site name as the initial selected value.

### Requirement 3: Worker Selector in Incident Form

**User Story:** As a user creating an incident, I want to optionally search and select a worker from a dropdown, so that I can link the incident to a specific worker record.

#### Acceptance Criteria

1. THE Incident_Form SHALL display the Worker_Selector in Step 1 (Basic Information) as a new optional field.
2. WHEN the user types a Search_Query into the Worker_Selector, THE Worker_Selector SHALL send a GET request to the Identity_Service /workers endpoint with the Search_Query as a filter parameter after the Debounce_Delay.
3. THE Worker_Selector SHALL display the worker legal name and preferred name (when available) in each dropdown option.
4. WHEN the user selects a worker, THE Worker_Selector SHALL store the worker_id value in the form state via react-hook-form.
5. THE Worker_Selector SHALL allow the field to remain empty (no worker selected) without triggering validation errors.
6. IF the GET /workers request fails, THEN THE Worker_Selector SHALL display an error message within the dropdown indicating the search could not be completed.
7. WHEN the user clears the Worker_Selector selection, THE Worker_Selector SHALL set the worker_id form value to undefined.

### Requirement 4: Backend Search/Filter Support

**User Story:** As a frontend developer, I want the GET /workers and GET /sites endpoints to accept a search query parameter, so that the Combobox can perform server-side filtering.

#### Acceptance Criteria

1. WHEN the GET /workers endpoint receives a `search` query parameter, THE Identity_Service SHALL return only workers whose legal_name or preferred_name contains the search value (case-insensitive).
2. WHEN the GET /sites endpoint receives a `search` query parameter, THE Policy_Service SHALL return only sites whose name or address contains the search value (case-insensitive).
3. WHEN no `search` query parameter is provided, THE Identity_Service SHALL return the default unfiltered workers list.
4. WHEN no `search` query parameter is provided, THE Policy_Service SHALL return the default unfiltered sites list.
5. THE Identity_Service SHALL limit search results to a maximum of 20 items per response when a search parameter is present.
6. THE Policy_Service SHALL limit search results to a maximum of 20 items per response when a search parameter is present.

### Requirement 5: Data Fetching with React Query

**User Story:** As a developer, I want search queries managed through @tanstack/react-query, so that caching, deduplication, and loading states are handled consistently.

#### Acceptance Criteria

1. THE Worker_Selector SHALL use a @tanstack/react-query query hook to fetch workers from the GET /workers endpoint with the current Search_Query as a query key parameter.
2. THE Site_Selector SHALL use a @tanstack/react-query query hook to fetch sites from the GET /sites endpoint with the current Search_Query as a query key parameter.
3. WHILE the Search_Query is empty, THE query hooks SHALL fetch the initial unfiltered list of workers or sites.
4. THE query hooks SHALL set `staleTime` to avoid redundant network requests for repeated identical Search_Query values within a reasonable window.
5. WHEN the Search_Query changes, THE query hooks SHALL cancel any in-flight request for the previous Search_Query value before issuing the new request.

### Requirement 6: Form Schema Update

**User Story:** As a developer, I want the incident form zod schema updated to include the optional worker_id field, so that form validation handles the new field correctly.

#### Acceptance Criteria

1. THE incidentCreateSchema SHALL include a `worker_id` field defined as an optional string.
2. THE incidentCreateSchema SHALL continue to require `site_id` as a non-empty string.
3. WHEN the form is submitted with a worker_id value, THE Incident_Form SHALL include worker_id in the CreateIncidentRequest payload.
4. WHEN the form is submitted without a worker_id value, THE Incident_Form SHALL omit worker_id from the CreateIncidentRequest payload.
