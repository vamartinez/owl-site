/**
 * Client-side form validation module.
 *
 * This module mirrors the server-side validation logic from
 * packages/backend/src/services/forms/form-validation.ts
 *
 * Pure validation logic — no React dependencies, no side effects.
 * Designed for real-time validation (<500ms) on blur and on submit.
 *
 * Requirements: 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import {
  FieldType,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE_MB,
} from './types';
import type {
  FieldConfig,
  FieldValidationError,
  FileMetadata,
  ValidationResult,
} from './types';

// ─── Main Validation Function ─────────────────────────────────────────────────

/**
 * Validates all submitted field values against the form schema.
 * Returns ALL validation errors simultaneously (not fail-fast).
 */
export function validateFormResponse(
  fields: FieldConfig[],
  answers: Record<string, unknown>,
  fileMetadata?: Record<string, FileMetadata>
): ValidationResult {
  const errors: FieldValidationError[] = [];

  for (const field of fields) {
    const value = answers[field.field_id];
    const fieldErrors = validateField(field, value, fileMetadata?.[field.field_id]);
    errors.push(...fieldErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─── Single Field Validation ──────────────────────────────────────────────────

/**
 * Validates a single field value against its configuration.
 * Returns all applicable errors for this field.
 */
export function validateField(
  field: FieldConfig,
  value: unknown,
  fileMeta?: FileMetadata
): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  // Required check (applies to all field types)
  if (field.required && isEmpty(value, field.type)) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" es obligatorio`,
    });
    // If required and empty, no further validation needed for this field
    return errors;
  }

  // If value is empty and not required, skip further validation
  if (isEmpty(value, field.type)) {
    return errors;
  }

  // Type-specific validation
  switch (field.type) {
    case FieldType.TEXTO_CORTO:
    case FieldType.TEXTO_LARGO:
      errors.push(...validateText(field, value));
      break;

    case FieldType.NUMERO:
      errors.push(...validateNumeric(field, value));
      break;

    case FieldType.FECHA:
      errors.push(...validateDate(field, value));
      break;

    case FieldType.SELECCION_SIMPLE:
      errors.push(...validateSingleSelection(field, value));
      break;

    case FieldType.SELECCION_MULTIPLE:
      errors.push(...validateMultipleSelection(field, value));
      break;

    case FieldType.CHECKBOX_ACEPTACION:
      errors.push(...validateCheckbox(field, value));
      break;

    case FieldType.CARGA_ARCHIVO:
      errors.push(...validateFile(field, fileMeta));
      break;
  }

  return errors;
}

// ─── Empty Check ──────────────────────────────────────────────────────────────

/**
 * Determines if a value is considered "empty" for a given field type.
 */
function isEmpty(value: unknown, fieldType: FieldType): boolean {
  if (value === undefined || value === null) return true;

  switch (fieldType) {
    case FieldType.TEXTO_CORTO:
    case FieldType.TEXTO_LARGO:
      return typeof value !== 'string' || value.trim().length === 0;

    case FieldType.NUMERO:
      return value === '' || value === undefined || value === null;

    case FieldType.FECHA:
      return typeof value !== 'string' || value.trim().length === 0;

    case FieldType.SELECCION_SIMPLE:
      return typeof value !== 'string' || value.trim().length === 0;

    case FieldType.SELECCION_MULTIPLE:
      if (value === null || value === undefined) return true;
      if (Array.isArray(value)) return value.length === 0;
      return false;

    case FieldType.CHECKBOX_ACEPTACION:
      return value === undefined || value === null;

    case FieldType.CARGA_ARCHIVO:
      return typeof value !== 'string' || value.trim().length === 0;

    default:
      return true;
  }
}

// ─── Text Validation ──────────────────────────────────────────────────────────

function validateText(field: FieldConfig, value: unknown): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  if (typeof value !== 'string') {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" debe ser texto`,
    });
    return errors;
  }

  const validation = field.validation;
  if (!validation) return errors;

  // min_length check
  if (validation.min_length !== undefined && value.length < validation.min_length) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" debe tener al menos ${validation.min_length} caracteres`,
    });
  }

  // max_length check
  if (validation.max_length !== undefined && value.length > validation.max_length) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" no debe exceder ${validation.max_length} caracteres. Longitud actual: ${value.length}`,
    });
  }

  // pattern (regex) check
  if (validation.pattern) {
    try {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(value)) {
        errors.push({
          field_id: field.field_id,
          field_label: field.label,
          message: `El campo "${field.label}" no cumple con el formato requerido`,
        });
      }
    } catch {
      // Invalid regex pattern in configuration — skip pattern validation
    }
  }

  return errors;
}

// ─── Numeric Validation ───────────────────────────────────────────────────────

function validateNumeric(field: FieldConfig, value: unknown): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  const numValue = typeof value === 'number' ? value : Number(value);

  if (isNaN(numValue)) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" debe ser un valor numérico`,
    });
    return errors;
  }

  const validation = field.validation;
  if (!validation) return errors;

  const hasMin = validation.min_value !== undefined;
  const hasMax = validation.max_value !== undefined;

  if (hasMin && hasMax) {
    if (numValue < validation.min_value! || numValue > validation.max_value!) {
      errors.push({
        field_id: field.field_id,
        field_label: field.label,
        message: `El campo "${field.label}" debe estar entre ${validation.min_value} y ${validation.max_value}. El valor mínimo es ${validation.min_value} y el máximo es ${validation.max_value}`,
      });
    }
  } else if (hasMin && numValue < validation.min_value!) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" debe ser mayor o igual a ${validation.min_value}. El valor mínimo es ${validation.min_value}`,
    });
  } else if (hasMax && numValue > validation.max_value!) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" debe ser menor o igual a ${validation.max_value}. El valor máximo es ${validation.max_value}`,
    });
  }

  return errors;
}

// ─── Date Validation ──────────────────────────────────────────────────────────

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateDate(field: FieldConfig, value: unknown): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  if (typeof value !== 'string') {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" debe ser una fecha válida en formato YYYY-MM-DD`,
    });
    return errors;
  }

  // Format check
  if (!ISO_DATE_REGEX.test(value)) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" debe tener formato de fecha YYYY-MM-DD`,
    });
    return errors;
  }

  // Valid date check
  const dateObj = new Date(value + 'T00:00:00Z');
  if (isNaN(dateObj.getTime())) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" contiene una fecha inválida`,
    });
    return errors;
  }

  // Verify the parsed date matches the input (catches invalid dates like 2024-02-30)
  const [year, month, day] = value.split('-').map(Number);
  if (
    dateObj.getUTCFullYear() !== year ||
    dateObj.getUTCMonth() + 1 !== month ||
    dateObj.getUTCDate() !== day
  ) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" contiene una fecha inválida`,
    });
    return errors;
  }

  const validation = field.validation;
  if (!validation) return errors;

  // min_date check
  if (validation.min_date) {
    const minDate = new Date(validation.min_date + 'T00:00:00Z');
    if (!isNaN(minDate.getTime()) && dateObj < minDate) {
      errors.push({
        field_id: field.field_id,
        field_label: field.label,
        message: `El campo "${field.label}" no puede ser anterior a ${validation.min_date}`,
      });
    }
  }

  // max_date check
  if (validation.max_date) {
    const maxDate = new Date(validation.max_date + 'T00:00:00Z');
    if (!isNaN(maxDate.getTime()) && dateObj > maxDate) {
      errors.push({
        field_id: field.field_id,
        field_label: field.label,
        message: `El campo "${field.label}" no puede ser posterior a ${validation.max_date}`,
      });
    }
  }

  return errors;
}

// ─── Selection Validation ─────────────────────────────────────────────────────

function validateSingleSelection(field: FieldConfig, value: unknown): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  if (typeof value !== 'string') {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" debe ser una opción válida`,
    });
    return errors;
  }

  const validOptionIds = new Set((field.options ?? []).map((opt) => opt.option_id));

  if (!validOptionIds.has(value)) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" contiene una opción no válida`,
    });
  }

  return errors;
}

function validateMultipleSelection(field: FieldConfig, value: unknown): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  if (!Array.isArray(value)) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" debe ser una lista de opciones`,
    });
    return errors;
  }

  const validOptionIds = new Set((field.options ?? []).map((opt) => opt.option_id));
  const invalidOptions: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string' || !validOptionIds.has(item)) {
      invalidOptions.push(String(item));
    }
  }

  if (invalidOptions.length > 0) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" contiene opciones no válidas: ${invalidOptions.join(', ')}`,
    });
  }

  return errors;
}

// ─── Checkbox Validation ──────────────────────────────────────────────────────

function validateCheckbox(field: FieldConfig, value: unknown): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  if (typeof value !== 'boolean') {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" debe ser verdadero o falso`,
    });
    return errors;
  }

  if (field.required && value === false) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" es obligatorio`,
    });
  }

  return errors;
}

// ─── File Validation ──────────────────────────────────────────────────────────

function normalizeFileType(contentType: string): string {
  const mimeMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
    'image/png': 'png',
  };

  const lower = contentType.toLowerCase().trim();

  if (mimeMap[lower]) {
    return mimeMap[lower]!;
  }

  const ext = lower.replace(/^\./, '');
  if (ext === 'jpg') return 'jpeg';
  return ext;
}

function validateFile(field: FieldConfig, fileMeta?: FileMetadata): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  if (!fileMeta) {
    return errors;
  }

  const allowedTypes = field.validation?.allowed_file_types ?? ALLOWED_FILE_TYPES;
  const maxSizeMb = field.validation?.max_file_size_mb ?? MAX_FILE_SIZE_MB;
  const maxSizeBytes = maxSizeMb * 1024 * 1024;

  // File type check
  const normalizedType = normalizeFileType(fileMeta.content_type);
  const normalizedAllowed = allowedTypes.map((t) => normalizeFileType(t));

  if (!normalizedAllowed.includes(normalizedType)) {
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" solo acepta archivos de tipo: ${allowedTypes.map((t) => t.toUpperCase()).join(', ')}`,
    });
  }

  // File size check
  if (fileMeta.size_bytes > maxSizeBytes) {
    const sizeMb = (fileMeta.size_bytes / (1024 * 1024)).toFixed(1);
    errors.push({
      field_id: field.field_id,
      field_label: field.label,
      message: `El campo "${field.label}" excede el tamaño máximo de ${maxSizeMb} MB. Tamaño actual: ${sizeMb} MB`,
    });
  }

  return errors;
}
