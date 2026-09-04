# Implementation Plan

## Overview

Fix two usability bugs in the admin portal's incident reporting flow: (1) replace the 4-step wizard in `IncidentCreateForm` with a single scrollable form, and (2) fix the Modal component's backdrop-close handler to use coordinate-based detection so native date picker clicks don't close the modal.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Wizard Steps and Date Picker Modal Close
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate both bugs exist
  - **Scoped PBT Approach**: Scope the property to concrete failing cases for reproducibility
  - Test 1 (Wizard Bug): Render `IncidentCreateForm`, assert there is NO step indicator (`[aria-label="Form steps"]`), assert NO "Next" button, assert NO "Back" button, assert NO "Review & Submit" text, assert a submit button IS present on initial render, assert all fields (title, incident_type select, regulatory indicator checkboxes) are visible simultaneously
  - Test 2 (Date Picker Bug): Render `Modal` with a date input inside, simulate a click event where `e.target === dialogRef.current` but click coordinates (`clientX`, `clientY`) are INSIDE the dialog's bounding rectangle (simulating a date picker popup click), assert `onClose` is NOT called
  - From Bug Condition in design: `isBugCondition_Wizard(X)` returns true when component is "IncidentCreateForm" and it renders step indicators/navigation; `isBugCondition_DatePicker(X)` returns true when click originates from native date picker popup inside dialog with backdrop-close handler
  - Expected Behavior: All fields rendered inline without wizard, modal stays open for clicks inside dialog bounds
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves both bugs exist: wizard steps are present, and modal closes on inside-bounds clicks)
  - Document counterexamples: (1) Step indicator with "Step 1 of 4" is present, "Next" button exists, submit button NOT on first step; (2) `onClose` IS called when click target equals dialog regardless of coordinates
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Modal Backdrop Close and Form Validation
  - **IMPORTANT**: Follow observation-first methodology
  - **CRITICAL**: Run these on UNFIXED code first to capture baseline behavior
  - Observe on UNFIXED code: Modal closes when click has `e.target === dialogRef.current` AND coordinates are outside dialog bounds (actual backdrop click)
  - Observe on UNFIXED code: Modal closes when Escape is pressed or X button is clicked
  - Observe on UNFIXED code: Form validation errors appear when submitting with missing required fields
  - Observe on UNFIXED code: Non-date form fields (text inputs, selects, checkboxes) inside Modal work correctly without triggering close
  - Write property-based test 1: For all click events where `e.target === dialog` AND `clientX`/`clientY` coordinates are OUTSIDE the dialog's `getBoundingClientRect()`, `onClose` IS called (from Preservation Requirements 3.2 in design)
  - Write property-based test 2: For all click events where `e.target !== dialog` (clicks on inner elements), `onClose` is NOT called (from Preservation Requirements 3.4 in design)
  - Write test 3: Form Zod validation still triggers on submit with invalid data, displaying inline errors (from Preservation Requirements 3.1)
  - Write test 4: Camera photo capture continues to work - simulate file selection, verify photos added and previews render (from Preservation Requirements 3.5)
  - Property-based testing generates many random coordinate pairs for strong boundary guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for wizard removal and date picker modal close

  - [x] 3.1 Fix Modal.tsx date picker click handling
    - Replace the `onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}` handler with coordinate-based validation
    - Use `dialogRef.current.getBoundingClientRect()` to get dialog bounds
    - Only call `onClose()` when click coordinates (`e.clientX`, `e.clientY`) fall OUTSIDE the dialog's bounding rectangle
    - Implementation: `if (e.target !== dialogRef.current) return; const rect = dialogRef.current.getBoundingClientRect(); const clickedInside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom; if (!clickedInside) { onClose(); }`
    - _Bug_Condition: isBugCondition_DatePicker(X) where X.target = dialogElement AND X.originatesFromNativeDatePickerPopup = true_
    - _Expected_Behavior: Modal remains open when click coordinates are inside dialog bounds_
    - _Preservation: Backdrop clicks (coordinates outside dialog bounds) still close the modal_
    - _Requirements: 2.3, 2.4, 3.2, 3.3, 3.4_

  - [x] 3.2 Simplify IncidentCreateForm.tsx - Remove wizard infrastructure
    - Remove `FormStep` enum definition
    - Remove `STEP_LABELS` constant
    - Remove `TOTAL_STEPS` constant
    - Remove `fieldsPerStep` mapping
    - Remove `useState<FormStep>(FormStep.BASIC_INFO)` (the `currentStep` state)
    - Remove `goToNextStep()` function
    - Remove `goToPreviousStep()` function
    - Remove `renderStepIndicator()` function
    - Remove `renderReviewStep()` function
    - Remove `renderCurrentStep()` switch statement function
    - Remove `ReviewField` helper component
    - Remove the `trigger` import/usage for per-step validation (keep `handleSubmit` for full-form validation)
    - _Bug_Condition: isBugCondition_Wizard(X) where X.component = "IncidentCreateForm"_
    - _Expected_Behavior: All form sections rendered inline in single scrollable view_
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Simplify IncidentCreateForm.tsx - Inline all form sections
    - Render `renderBasicInfoStep()`, `renderClassificationStep()`, and `renderRegulatoryStep()` content sequentially within the single `<form>` element (can keep as internal render functions, but call all three unconditionally)
    - Replace step navigation buttons (Next/Back) with only Cancel (if `onCancel` provided) and Submit buttons
    - Update `CardHeader` description from `Step ${currentStep + 1} of ${TOTAL_STEPS}: ${STEP_LABELS[currentStep]}` to a static message like "Fill in the details below"
    - Keep the `handleSubmit(onSubmit)` form handler — Zod validation occurs on submit for all visible fields
    - _Bug_Condition: isBugCondition_Wizard(X) — wizard navigation eliminated_
    - _Expected_Behavior: Single scrollable form with direct submit access_
    - _Preservation: Zod validation, camera capture, API submission, react-hook-form bindings all preserved_
    - _Requirements: 2.1, 2.2, 3.1, 3.5, 3.6_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Wizard Steps and Date Picker Modal Close
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms: (1) all fields rendered inline without wizard, (2) modal stays open for clicks inside dialog bounds
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms both bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Modal Backdrop Close and Form Validation
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm: backdrop clicks outside dialog bounds still close modal, Escape/X still close modal, form validation still works, camera capture still works, non-date form interactions unaffected

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite to confirm no regressions
  - Verify exploration test (Property 1) passes after fix
  - Verify preservation tests (Property 2) pass after fix
  - Verify existing project tests still pass
  - Ensure all tests pass, ask the user if questions arise

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1", "3.2"] },
    { "id": 2, "tasks": ["3.3"] },
    { "id": 3, "tasks": ["3.4", "3.5"] },
    { "id": 4, "tasks": ["4"] }
  ]
}
```

## Notes

- Tasks 1 and 2 MUST be completed BEFORE any implementation tasks (3.x) since they validate the bug exists and capture baseline behavior
- The exploration test (task 1) is expected to FAIL on unfixed code — this is correct behavior confirming the bug
- The preservation tests (task 2) are expected to PASS on unfixed code — this captures the correct baseline
- After implementing the fix (tasks 3.1–3.3), both test suites should PASS
- Key files: `packages/admin-portal/src/components/ui/Modal.tsx`, `packages/admin-portal/src/features/incidents/IncidentCreateForm.tsx`
