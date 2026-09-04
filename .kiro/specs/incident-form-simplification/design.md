# Incident Form Simplification Bugfix Design

## Overview

This bugfix addresses two usability issues in the admin portal's incident reporting flow:

1. **Wizard removal** — The `IncidentCreateForm` component uses an unnecessary 4-step wizard (Basic Info → Classification → Regulatory Indicators → Review & Submit) that slows down incident reporting. The fix restructures it into a single scrollable form with all fields visible and a direct submit button.

2. **Date picker modal close** — The `Modal` component's backdrop-close handler (`onClick` on `<dialog>`) incorrectly interprets click events from native date picker calendar popups as backdrop clicks, closing the modal prematurely. The fix distinguishes actual backdrop clicks from bubbled events originating inside modal content.

## Glossary

- **Bug_Condition (C)**: Two conditions — (1) the form rendering as a multi-step wizard instead of a single page, and (2) native date picker clicks inside a `<dialog>` triggering `onClose()`
- **Property (P)**: (1) All incident fields rendered inline in one scrollable form with a submit button; (2) date picker interactions complete without closing the modal
- **Preservation**: Modal backdrop-close, Escape/X close, Zod validation, photo capture, API submission, and all non-date form interactions inside modals must remain unchanged
- **FormStep enum**: The current step state machine (`BASIC_INFO | CLASSIFICATION | REGULATORY | REVIEW`) in `IncidentCreateForm.tsx` — to be removed
- **dialogRef**: The `useRef<HTMLDialogElement>` in `Modal.tsx` used for `showModal()`/`close()` and backdrop-click detection

## Bug Details

### Bug Condition 1: Wizard Steps

The bug manifests whenever `IncidentCreateForm` renders. The component unconditionally creates a step-based wizard with `useState<FormStep>`, step navigation buttons, a step indicator, per-step field validation via `trigger()`, and a `renderCurrentStep()` switch statement. Users must navigate 4 steps sequentially to submit an incident.

**Formal Specification:**
```
FUNCTION isBugCondition_Wizard(input)
  INPUT: input of type FormRenderContext
  OUTPUT: boolean
  
  RETURN input.component = "IncidentCreateForm"
         AND input.rendersStepIndicator = true
         AND input.rendersStepNavigation = true
         AND input.hasReviewStep = true
END FUNCTION
```

### Bug Condition 2: Date Picker Click in Modal

The bug manifests when a user interacts with native `<input type="date">` or `<input type="datetime-local">` calendar popups inside the `Modal` component. The `<dialog>` element's `onClick` handler checks `if (e.target === dialogRef.current) onClose()`. Native date picker popups render in a browser-managed layer but their click events can bubble to the dialog element with `e.target` pointing to the `<dialog>` itself (since the popup is outside the normal DOM children), triggering the close handler.

**Formal Specification:**
```
FUNCTION isBugCondition_DatePicker(input)
  INPUT: input of type MouseEvent on <dialog>
  OUTPUT: boolean
  
  RETURN input.target = dialogElement
         AND input.originatedFromNativeDatePickerPopup = true
         AND dialogHasBackdropCloseHandler(dialogElement)
END FUNCTION
```

### Examples

- User opens incident form → sees Step 1 of 4 with "Next" button instead of all fields at once (Bug 1)
- User fills in Basic Info, clicks Next, fills Classification, clicks Next, fills Regulatory, clicks Next → finally sees Review step with Submit (Bug 1)
- User opens LinkFormModal, clicks on `<input type="date">` date-from field, clicks a date in the calendar popup → modal closes unexpectedly (Bug 2)
- User in ExportPanel clicks datetime-local for date range filter inside a modal → modal closes on calendar interaction (Bug 2)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Zod schema validation (`incidentCreateSchema`) continues to validate all fields on submit, displaying inline errors
- Modal closes when user clicks the actual backdrop area (the semi-transparent overlay outside the dialog box)
- Modal closes when user presses Escape or clicks the X button
- Non-date form fields (text inputs, selects, checkboxes, comboboxes) inside modals continue to function correctly
- Camera capture in the incident form continues to work (attach photos, display previews)
- Form submission calls the create incident API and invokes `onSuccess` with `incident_id` and `regulatoryResult`
- react-hook-form `Controller` components and `register` bindings remain functional
- The `<dialog>` element continues to use `showModal()`/`close()` API for proper modal behavior

**Scope:**
All interactions that do NOT involve (1) the wizard navigation in `IncidentCreateForm` or (2) native date picker popup clicks inside a `<dialog>` should be completely unaffected by this fix. This includes:
- Mouse clicks on non-date form controls inside modals
- Keyboard interactions (Enter, Tab, Escape)
- Touch interactions on mobile
- All other components that use `Modal` without date pickers

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Wizard Pattern by Design**: The `IncidentCreateForm` was intentionally built with a `FormStep` enum and step-based rendering. This is not a regression but an architectural choice that has proven detrimental to UX. The fix removes this pattern entirely.

2. **Dialog onClick Target Detection**: In `Modal.tsx`, the check `e.target === dialogRef.current` is intended to detect backdrop clicks. With native `<dialog>` elements using `showModal()`, clicking the backdrop sets `e.target` to the `<dialog>` itself. However, native date picker popups are rendered by the browser outside the normal DOM tree but within the dialog's coordinate space. When the user clicks inside the date picker popup, the event can bubble to the `<dialog>` with `e.target === dialogRef.current` being true (because the popup is not a DOM child of the dialog content). This triggers `onClose()` erroneously.

3. **No Coordinate Validation**: The onClick handler does not verify whether the click coordinates (`e.clientX`, `e.clientY`) are within the dialog content's bounding rectangle. A coordinate check would distinguish actual backdrop clicks (outside content bounds) from events that bubble from date picker popups (which occur over the content area).

## Correctness Properties

Property 1: Bug Condition - Single Page Form Rendering

_For any_ render of `IncidentCreateForm`, the component SHALL display all form sections (basic info, classification, regulatory indicators) inline within a single scrollable view, with a submit button directly accessible, without step indicators, Next/Back navigation buttons, or a Review step.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition - Date Picker Modal Stability

_For any_ click event originating from a native date picker calendar popup inside a Modal component, the Modal SHALL remain open and the date selection SHALL complete successfully without triggering `onClose()`.

**Validates: Requirements 2.3, 2.4**

Property 3: Preservation - Modal Backdrop Close

_For any_ click event on the actual backdrop area of a Modal (coordinates outside the dialog content bounds) that does NOT originate from a native date picker popup, the Modal SHALL close by invoking `onClose()`, preserving existing backdrop-close behavior.

**Validates: Requirements 3.2, 3.3, 3.4**

Property 4: Preservation - Form Validation and Submission

_For any_ form submission of the simplified `IncidentCreateForm`, the component SHALL validate all fields using the existing Zod schema, display validation errors inline, and on valid submission call the create incident API with the same payload structure as before.

**Validates: Requirements 3.1, 3.6**

## Fix Implementation

### Changes Required

**File**: `packages/admin-portal/src/features/incidents/IncidentCreateForm.tsx`

**Specific Changes**:

1. **Remove FormStep enum and related constants**: Delete `FormStep`, `STEP_LABELS`, `TOTAL_STEPS`, and `fieldsPerStep` definitions

2. **Remove step state and navigation**: Delete `useState<FormStep>(FormStep.BASIC_INFO)`, `goToNextStep()`, `goToPreviousStep()` functions

3. **Remove step indicator rendering**: Delete `renderStepIndicator()` function entirely

4. **Remove Review step**: Delete `renderReviewStep()` function and `ReviewField` helper component entirely

5. **Remove renderCurrentStep switch**: Delete the `renderCurrentStep()` function with its switch statement

6. **Inline all sections**: Render the content of `renderBasicInfoStep()`, `renderClassificationStep()`, and `renderRegulatoryStep()` sequentially within a single scrollable `<form>` element. These can remain as internal functions but are all called together instead of conditionally.

7. **Simplify navigation buttons**: Remove the Next/Back button logic. Keep only Cancel (if `onCancel` provided) and Submit buttons

8. **Update CardHeader**: Remove step counter from description (e.g., "Step 1 of 4: Basic Information" → "Fill in the details below")

9. **Remove per-step validation trigger**: Since all fields are visible, validation happens naturally on submit via `handleSubmit`. Remove the `trigger(fieldsToValidate)` call.

---

**File**: `packages/admin-portal/src/components/ui/Modal.tsx`

**Function**: `Modal` component — `onClick` handler on `<dialog>`

**Specific Changes**:

1. **Replace simple target check with coordinate-based validation**: Instead of `if (e.target === dialogRef.current) onClose()`, check whether the click coordinates fall outside the dialog content's bounding rectangle:

   ```tsx
   onClick={(e) => {
     if (e.target !== dialogRef.current) return;
     const rect = dialogRef.current.getBoundingClientRect();
     const clickedInsideContent =
       e.clientX >= rect.left &&
       e.clientX <= rect.right &&
       e.clientY >= rect.top &&
       e.clientY <= rect.bottom;
     if (!clickedInsideContent) {
       onClose();
     }
   }}
   ```

   **Rationale**: With `<dialog>` using `showModal()`, the dialog element takes up the full viewport (its `getBoundingClientRect()` returns the full viewport). However, the visible content box (the styled `max-w-*` rounded-lg element) is positioned within the dialog via CSS. The actual approach should use the dialog's first child element (the content wrapper) to get the content bounds:

   ```tsx
   onClick={(e) => {
     if (e.target !== dialogRef.current) return;
     const dialog = dialogRef.current;
     const contentEl = dialog.firstElementChild as HTMLElement | null;
     if (!contentEl) return;
     const rect = contentEl.getBoundingClientRect();
     const clickedInside =
       e.clientX >= rect.left &&
       e.clientX <= rect.right &&
       e.clientY >= rect.top &&
       e.clientY <= rect.bottom;
     if (!clickedInside) {
       onClose();
     }
   }}
   ```

   Wait — looking at the actual Modal structure, the dialog IS the content container (it has `max-w-*` and `rounded-lg`). With `showModal()`, the backdrop is rendered as a pseudo-element `::backdrop`, not as part of the dialog element itself. The `e.target === dialogRef.current` check catches clicks on the dialog's padding area (which acts as the backdrop since the dialog stretches to fill viewport).

   **Corrected approach**: The `<dialog>` with `showModal()` is centered with the browser's default UA styles. The dialog element itself IS the content box. Clicks on the `::backdrop` don't fire click events on the dialog. The problem is that with some browsers, the dialog is given `width: fit-content` and centered, but padding can be added. In this codebase, the dialog has `p-0` and specific `max-w-*` and `w-full`, so it does NOT span the full viewport.

   The actual issue: When `showModal()` is used, clicks on the `::backdrop` pseudo-element DO fire as click events on the `<dialog>` element in most browsers, with `e.target` being the dialog. The `getBoundingClientRect()` of the dialog returns the bounds of the visible dialog box. So the fix is:

   ```tsx
   onClick={(e) => {
     const dialog = dialogRef.current;
     if (e.target !== dialog) return;
     const rect = dialog.getBoundingClientRect();
     const clickedInsideDialog =
       e.clientX >= rect.left &&
       e.clientX <= rect.right &&
       e.clientY >= rect.top &&
       e.clientY <= rect.bottom;
     if (!clickedInsideDialog) {
       onClose();
     }
   }}
   ```

   This correctly distinguishes:
   - Backdrop clicks → coordinates outside dialog bounds → close
   - Date picker popup clicks → `e.target` is dialog but coordinates are inside dialog bounds (popup overlays the dialog area) → don't close

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate both bugs BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write component tests using Vitest + React Testing Library that render the current components and assert the buggy behavior exists.

**Test Cases**:
1. **Wizard Step Presence Test**: Render `IncidentCreateForm`, assert that a step indicator with "Step 1 of 4" exists, assert "Next" button exists, assert submit button does NOT exist on step 1 (will pass on unfixed code — demonstrating the bug)
2. **Fields Hidden Test**: Render `IncidentCreateForm`, assert that Classification fields (incident_type select) are NOT visible on initial render (will pass on unfixed code — demonstrating the bug)
3. **Modal Close on Date Click**: Render a Modal with a date input inside, simulate click event with `e.target` as dialog and coordinates inside dialog bounds, assert `onClose` is called (will pass on unfixed code — demonstrating the bug)
4. **Review Step Required Test**: Assert that submit button only appears on step 4 (will pass on unfixed code)

**Expected Counterexamples**:
- Step indicator and Next/Back buttons are present in the rendered output
- Submit button not accessible without navigating through all steps
- Modal onClose triggered when click target is dialog element regardless of coordinates

### Fix Checking

**Goal**: Verify that for all inputs where the bug conditions hold, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL render of IncidentCreateForm DO
  result := render(<IncidentCreateForm />)
  ASSERT NOT result.querySelector('[aria-label="Form steps"]')
  ASSERT NOT result.queryByText('Next')
  ASSERT NOT result.queryByText('Back')
  ASSERT NOT result.queryByText('Review & Submit')
  ASSERT result.querySelector('button[type="submit"]')
  ASSERT result.querySelector('[name="title"]')
  ASSERT result.querySelector('[name="incident_type"]')
  ASSERT result.querySelector('[id*="indicator-"]')
END FOR

FOR ALL click WHERE target = dialog AND coords inside dialog bounds DO
  result := handleClick(click)
  ASSERT onClose NOT called
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL click WHERE target = dialog AND coords OUTSIDE dialog bounds DO
  ASSERT onClose IS called (backdrop close preserved)
END FOR

FOR ALL form submission with valid data DO
  ASSERT createIncidentMutation.mutateAsync called with correct payload
  ASSERT onSuccess called with incident_id and regulatoryResult
END FOR

FOR ALL form submission with invalid data DO
  ASSERT validation errors displayed inline
  ASSERT form NOT submitted
END FOR
```

**Testing Approach**: Property-based testing is recommended for the Modal preservation checking because:
- It generates many random coordinate pairs to verify boundary behavior
- It catches edge cases around dialog edges that manual unit tests might miss
- It provides strong guarantees that backdrop-close still works for all click positions outside content bounds

**Test Plan**: Observe behavior on UNFIXED code first for backdrop clicks and form submissions, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Backdrop Click Preservation**: Generate random click coordinates outside dialog bounds, verify `onClose` is called for each
2. **Form Validation Preservation**: Submit incident form with missing required fields, verify Zod validation errors appear inline
3. **API Submission Preservation**: Submit valid incident form data, verify `buildCreateIncidentPayload` produces correct payload and mutation is called
4. **Photo Capture Preservation**: Simulate camera file selection, verify photos are added to state and previews render

### Unit Tests

- Test that `IncidentCreateForm` renders all sections (basic info, classification, regulatory) simultaneously
- Test that submit button is present without step navigation
- Test that validation errors display inline on submit with missing required fields
- Test Modal `onClick` with coordinates inside dialog bounds (should not close)
- Test Modal `onClick` with coordinates outside dialog bounds (should close)
- Test Modal `onClick` with `e.target` not equal to dialog (should not close — clicks on inner elements)

### Property-Based Tests

- Generate random click coordinates and dialog bounding rects to verify Modal only closes when coordinates are outside bounds
- Generate random form data combinations to verify Zod validation behavior matches before/after fix
- Generate random sets of regulatory indicators to verify checkbox state management works in single-page layout

### Integration Tests

- Test full incident creation flow: fill all fields in single page, submit, verify API call and success callback
- Test incident form inside a modal context (if applicable): fill date fields, verify modal stays open
- Test LinkFormModal with date range filters: select dates, verify modal remains open and dates are captured
