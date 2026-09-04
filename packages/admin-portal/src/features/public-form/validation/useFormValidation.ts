/**
 * React hook for client-side form validation.
 *
 * Provides real-time validation (<500ms) on blur and on submit.
 * Shows validation errors in Spanish next to each field.
 * Shows all errors simultaneously on submit attempt.
 *
 * Requirements: 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import { useCallback, useRef, useState } from 'react';
import { validateField, validateFormResponse } from './form-validation';
import type {
  FieldConfig,
  FieldValidationError,
  FileMetadata,
  ValidationResult,
} from './types';

// ─── Hook State ───────────────────────────────────────────────────────────────

export interface FormValidationState {
  /** Map of field_id → array of error messages for that field */
  fieldErrors: Record<string, string[]>;
  /** Whether a submit attempt has been made (triggers showing all errors) */
  hasSubmitted: boolean;
  /** Set of field_ids that have been blurred (touched) */
  touchedFields: Set<string>;
}

// ─── Hook Return Type ─────────────────────────────────────────────────────────

export interface UseFormValidationReturn {
  /** Current field errors keyed by field_id */
  fieldErrors: Record<string, string[]>;
  /** Whether a submit attempt has been made */
  hasSubmitted: boolean;
  /** Validate a single field on blur. Returns errors for that field. */
  validateOnBlur: (
    fieldId: string,
    value: unknown,
    fileMeta?: FileMetadata
  ) => FieldValidationError[];
  /** Validate all fields on submit. Returns full validation result. */
  validateOnSubmit: (
    answers: Record<string, unknown>,
    fileMetadata?: Record<string, FileMetadata>
  ) => ValidationResult;
  /** Get error messages for a specific field (only if touched or submitted) */
  getFieldErrors: (fieldId: string) => string[];
  /** Get the first error message for a field (for single-error display) */
  getFieldError: (fieldId: string) => string | undefined;
  /** Get all errors as a flat Record<string, string> for the renderer (first error per field) */
  getErrorsForRenderer: () => Record<string, string>;
  /** Check if a specific field has errors (only if touched or submitted) */
  hasFieldError: (fieldId: string) => boolean;
  /** Mark a field as touched (e.g., on blur) without validating */
  touchField: (fieldId: string) => void;
  /** Clear all validation state (e.g., after successful submission) */
  clearErrors: () => void;
  /** Clear errors for a specific field */
  clearFieldErrors: (fieldId: string) => void;
  /** Set server-side validation errors (from API response) */
  setServerErrors: (errors: FieldValidationError[]) => void;
}

// ─── Hook Implementation ──────────────────────────────────────────────────────

export function useFormValidation(fields: FieldConfig[]): UseFormValidationReturn {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const touchedFieldsRef = useRef<Set<string>>(new Set());

  // Build a lookup map for fields by ID
  const fieldMapRef = useRef<Map<string, FieldConfig>>(new Map());
  fieldMapRef.current = new Map(fields.map((f) => [f.field_id, f]));

  const validateOnBlur = useCallback(
    (fieldId: string, value: unknown, fileMeta?: FileMetadata): FieldValidationError[] => {
      // Mark field as touched
      touchedFieldsRef.current.add(fieldId);

      const field = fieldMapRef.current.get(fieldId);
      if (!field) return [];

      const errors = validateField(field, value, fileMeta);

      setFieldErrors((prev) => {
        const next = { ...prev };
        if (errors.length > 0) {
          next[fieldId] = errors.map((e) => e.message);
        } else {
          delete next[fieldId];
        }
        return next;
      });

      return errors;
    },
    []
  );

  const validateOnSubmit = useCallback(
    (
      answers: Record<string, unknown>,
      fileMetadata?: Record<string, FileMetadata>
    ): ValidationResult => {
      setHasSubmitted(true);

      // Mark all fields as touched on submit
      for (const field of fields) {
        touchedFieldsRef.current.add(field.field_id);
      }

      const result = validateFormResponse(fields, answers, fileMetadata);

      // Group errors by field_id
      const errorsByField: Record<string, string[]> = {};
      for (const error of result.errors) {
        if (!errorsByField[error.field_id]) {
          errorsByField[error.field_id] = [];
        }
        errorsByField[error.field_id]!.push(error.message);
      }

      setFieldErrors(errorsByField);

      return result;
    },
    [fields]
  );

  const getFieldErrors = useCallback(
    (fieldId: string): string[] => {
      // Only show errors if field has been touched or form has been submitted
      if (!hasSubmitted && !touchedFieldsRef.current.has(fieldId)) {
        return [];
      }
      return fieldErrors[fieldId] ?? [];
    },
    [fieldErrors, hasSubmitted]
  );

  const getFieldError = useCallback(
    (fieldId: string): string | undefined => {
      if (!hasSubmitted && !touchedFieldsRef.current.has(fieldId)) {
        return undefined;
      }
      const errors = fieldErrors[fieldId];
      return errors?.[0];
    },
    [fieldErrors, hasSubmitted]
  );

  const getErrorsForRenderer = useCallback((): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [fieldId, errors] of Object.entries(fieldErrors)) {
      if (!hasSubmitted && !touchedFieldsRef.current.has(fieldId)) {
        continue;
      }
      const firstErr = errors?.[0];
      if (firstErr) {
        result[fieldId] = firstErr;
      }
    }
    return result;
  }, [fieldErrors, hasSubmitted]);

  const hasFieldError = useCallback(
    (fieldId: string): boolean => {
      if (!hasSubmitted && !touchedFieldsRef.current.has(fieldId)) {
        return false;
      }
      return (fieldErrors[fieldId]?.length ?? 0) > 0;
    },
    [fieldErrors, hasSubmitted]
  );

  const touchField = useCallback((fieldId: string) => {
    touchedFieldsRef.current.add(fieldId);
  }, []);

  const clearErrors = useCallback(() => {
    setFieldErrors({});
    setHasSubmitted(false);
    touchedFieldsRef.current.clear();
  }, []);

  const clearFieldErrors = useCallback((fieldId: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }, []);

  const setServerErrors = useCallback((errors: FieldValidationError[]) => {
    setHasSubmitted(true);

    // Mark all fields with errors as touched
    for (const error of errors) {
      touchedFieldsRef.current.add(error.field_id);
    }

    // Group errors by field_id
    const errorsByField: Record<string, string[]> = {};
    for (const error of errors) {
      if (!errorsByField[error.field_id]) {
        errorsByField[error.field_id] = [];
      }
      errorsByField[error.field_id]!.push(error.message);
    }

    setFieldErrors(errorsByField);
  }, []);

  return {
    fieldErrors,
    hasSubmitted,
    validateOnBlur,
    validateOnSubmit,
    getFieldErrors,
    getFieldError,
    getErrorsForRenderer,
    hasFieldError,
    touchField,
    clearErrors,
    clearFieldErrors,
    setServerErrors,
  };
}
