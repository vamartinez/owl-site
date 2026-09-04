# Bugfix Requirements Document

## Introduction

The incident creation form in the admin portal has two usability issues:

1. **Wizard steps are unnecessary** — The `IncidentCreateForm` uses a 4-step wizard (Basic Info → Classification → Regulatory Indicators → Review & Submit) that adds friction to incident reporting. All fields should be displayed in a single scrollable form without step navigation or a review step.

2. **Date picker clicks fail inside modals** — Native `<input type="date">` and `<input type="datetime-local">` elements do not respond correctly to clicks when rendered inside the `Modal` component. The Modal's `<dialog>` element has an `onClick` handler (`if (e.target === dialogRef.current) onClose()`) intended for backdrop-close behavior, but click events from the native date picker calendar popup bubble up to the dialog element, causing the modal to close or the date selection to be lost.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user opens the incident creation form THEN the system displays a 4-step wizard requiring sequential navigation (Next/Back) through Basic Info, Classification, Regulatory Indicators, and Review & Submit steps before the form can be submitted

1.2 WHEN a user is on any wizard step other than the final Review step THEN the system does not allow form submission, requiring the user to navigate through all steps regardless of completeness

1.3 WHEN a user clicks on a native date picker calendar popup inside a Modal component (e.g., in LinkFormModal or ExportPanel) THEN the system closes the modal or loses the date selection because the click event bubbles up to the dialog's onClick handler which interprets it as a backdrop click

1.4 WHEN a user clicks on the datetime-local input's calendar popup in the IncidentCreateForm (rendered without a modal but potentially affected by parent click handlers) THEN the system may fail to register the date selection correctly

### Expected Behavior (Correct)

2.1 WHEN a user opens the incident creation form THEN the system SHALL display all form fields (basic info, classification, regulatory indicators) in a single scrollable form without step navigation, step indicators, or a review step

2.2 WHEN a user has filled in all required fields in the single-page incident form THEN the system SHALL allow immediate form submission via a submit button visible without navigating through steps

2.3 WHEN a user clicks on a native date picker calendar popup inside a Modal component THEN the system SHALL allow the date selection to complete without closing the modal or losing the selection

2.4 WHEN a user clicks on the datetime-local input's calendar popup in any incident-related form THEN the system SHALL correctly register the selected date/time value

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user fills in form fields and submits the incident creation form THEN the system SHALL CONTINUE TO validate all fields using the existing Zod schema and display validation errors

3.2 WHEN a user clicks the Modal backdrop (the semi-transparent overlay area outside the modal content) THEN the system SHALL CONTINUE TO close the modal

3.3 WHEN a user presses Escape or clicks the X button in a Modal THEN the system SHALL CONTINUE TO close the modal

3.4 WHEN a user interacts with non-date form fields (text inputs, selects, checkboxes, comboboxes) inside a Modal THEN the system SHALL CONTINUE TO function correctly without interference

3.5 WHEN a user captures photos via camera in the incident form THEN the system SHALL CONTINUE TO attach photos and display previews

3.6 WHEN a user submits a valid incident form THEN the system SHALL CONTINUE TO call the create incident API and invoke the onSuccess callback with the incident ID and regulatory result

---

## Bug Condition (Structured Pseudocode)

### Bug Condition 1: Wizard Steps

```pascal
FUNCTION isBugCondition_Wizard(X)
  INPUT: X of type FormRenderContext
  OUTPUT: boolean
  
  // The bug is that the form always renders as a multi-step wizard
  RETURN X.component = "IncidentCreateForm"
END FUNCTION
```

### Property: Fix Checking — Single Page Form

```pascal
FOR ALL X WHERE isBugCondition_Wizard(X) DO
  rendered ← renderIncidentCreateForm(X)
  ASSERT rendered.hasNoStepIndicator
    AND rendered.hasNoNextButton
    AND rendered.hasNoBackButton
    AND rendered.hasNoReviewStep
    AND rendered.allFieldsVisibleInSingleScroll
    AND rendered.hasSubmitButton
END FOR
```

### Bug Condition 2: Date Picker Click

```pascal
FUNCTION isBugCondition_DatePicker(X)
  INPUT: X of type ClickEvent
  OUTPUT: boolean
  
  // The bug triggers when a click originates from the native date picker popup
  // inside a <dialog> element with a backdrop-close onClick handler
  RETURN X.originatesFromNativeDatePickerPopup
    AND X.isInsideDialogElement
    AND X.dialogHasBackdropCloseHandler
END FUNCTION
```

### Property: Fix Checking — Date Picker Clicks

```pascal
FOR ALL X WHERE isBugCondition_DatePicker(X) DO
  result ← handleClick(X)
  ASSERT result.modalRemainsOpen
    AND result.dateSelectionCompleted
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking — Modal backdrop close still works
FOR ALL X WHERE NOT isBugCondition_DatePicker(X) DO
  ASSERT F(X) = F'(X)
  // Specifically: clicking the actual backdrop still closes the modal
  // and all other form interactions remain unaffected
END FOR
```
