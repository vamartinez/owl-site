/**
 * Types for client-side form validation.
 * Mirrors the server-side types from packages/backend/src/services/forms/types.ts
 * but without backend-specific dependencies.
 */

// ─── Field Types ──────────────────────────────────────────────────────────────

export enum FieldType {
  TEXTO_CORTO = 'texto_corto',
  TEXTO_LARGO = 'texto_largo',
  NUMERO = 'numero',
  FECHA = 'fecha',
  SELECCION_SIMPLE = 'seleccion_simple',
  SELECCION_MULTIPLE = 'seleccion_multiple',
  CHECKBOX_ACEPTACION = 'checkbox_aceptacion',
  CARGA_ARCHIVO = 'carga_archivo',
}

// ─── Field Configuration ──────────────────────────────────────────────────────

export interface FieldOption {
  option_id: string;
  label: string;
}

export interface FieldValidation {
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  pattern?: string;
  min_date?: string;
  max_date?: string;
  allowed_file_types?: string[];
  max_file_size_mb?: number;
}

export interface FieldConfig {
  field_id: string;
  type: FieldType;
  label: string;
  required: boolean;
  order: number;
  placeholder?: string;
  help_text?: string;
  options?: FieldOption[];
  validation?: FieldValidation;
}

// ─── Validation Error ─────────────────────────────────────────────────────────

export interface FieldValidationError {
  field_id: string;
  field_label: string;
  message: string;
}

// ─── File Metadata ────────────────────────────────────────────────────────────

export interface FileMetadata {
  filename: string;
  size_bytes: number;
  content_type: string;
}

// ─── Validation Result ────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: FieldValidationError[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALLOWED_FILE_TYPES = ['pdf', 'jpeg', 'png'];
export const MAX_FILE_SIZE_MB = 10;
