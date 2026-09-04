/**
 * TypeScript interfaces and enums for the Forms Service domain.
 * Covers Form, FormVersion, FormResponse, and AuditEntry entities.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum FormStatus {
  BORRADOR = 'borrador',
  PUBLICADO = 'publicado',
  DESPUBLICADO = 'despublicado',
}

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
  /** 1-200 characters */
  label: string;
}

export interface FieldValidation {
  /** For numero: -999999999 to 999999999 */
  min_value?: number;
  /** For numero: -999999999 to 999999999 */
  max_value?: number;
  /** For texto: 0 or greater */
  min_length?: number;
  /** For texto: up to 10000 */
  max_length?: number;
  /** Regex pattern for texto fields */
  pattern?: string;
  /** ISO 8601 date string for fecha fields */
  min_date?: string;
  /** ISO 8601 date string for fecha fields */
  max_date?: string;
  /** Allowed file extensions, e.g. ['pdf', 'jpeg', 'png'] */
  allowed_file_types?: string[];
  /** Maximum file size in MB (default 10) */
  max_file_size_mb?: number;
}

export interface FieldConfig {
  /** UUID v4 */
  field_id: string;
  type: FieldType;
  /** 1-200 characters */
  label: string;
  required: boolean;
  /** Sequential order from 1 to N */
  order: number;
  /** Max 200 characters */
  placeholder?: string;
  /** Max 500 characters */
  help_text?: string;
  /** Required for seleccion_simple/seleccion_multiple (2-50 options) */
  options?: FieldOption[];
  validation?: FieldValidation;
}

// ─── Form ─────────────────────────────────────────────────────────────────────

export interface Form {
  /** UUID v4 */
  form_id: string;
  tenant_id: string;
  /** 3-200 characters */
  name: string;
  /** Max 1000 characters */
  description?: string;
  status: FormStatus;
  fields: FieldConfig[];
  /** UUID v4, generated on publish */
  token_publico?: string;
  current_version?: number;
  author_id: string;
  /** ISO 8601 UTC */
  created_at: string;
  /** ISO 8601 UTC */
  updated_at: string;
  /** ISO 8601 UTC */
  published_at?: string;
}

// ─── Form Version ─────────────────────────────────────────────────────────────

export interface FormVersion {
  form_id: string;
  /** Sequential from 1 */
  version_number: number;
  /** Immutable snapshot of fields at time of publish */
  fields_snapshot: FieldConfig[];
  /** ISO 8601 UTC */
  created_at: string;
  /** ID of the user who published */
  created_by: string;
}

// ─── Form Response ────────────────────────────────────────────────────────────

export interface FormResponseMetadata {
  /** 'qr' | 'url_directa' */
  origin_type: string;
  /** Max 500 characters */
  user_agent: string;
  ip_address: string;
}

export interface FormResponse {
  /** UUID v4 */
  response_id: string;
  form_id: string;
  version_number: number;
  /** 8 alphanumeric characters */
  folio: string;
  /** ISO 8601 UTC */
  submitted_at: string;
  /** Field answers keyed by field_id */
  answers: Record<string, unknown>;
  /** S3 keys for uploaded files, keyed by field_id */
  file_keys?: Record<string, string>;
  metadata: FormResponseMetadata;
  tenant_id: string;
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export enum AuditEntityType {
  FORMULARIO = 'formulario',
  RESPUESTA = 'respuesta',
  QR = 'qr',
}

export enum AuditAction {
  FORMULARIO_CREADO = 'formulario_creado',
  FORMULARIO_EDITADO = 'formulario_editado',
  FORMULARIO_PUBLICADO = 'formulario_publicado',
  FORMULARIO_DESPUBLICADO = 'formulario_despublicado',
  FORMULARIO_DUPLICADO = 'formulario_duplicado',
  QR_DESCARGADO = 'qr_descargado',
  RESPUESTA_ENVIADA = 'respuesta_enviada',
}

export interface AuditEntry {
  entity_type: AuditEntityType;
  entity_id: string;
  action: AuditAction;
  actor_id: string;
  /** ISO 8601 UTC */
  timestamp: string;
  ip_address: string;
  metadata: Record<string, unknown>;
  tenant_id: string;
  /** TTL epoch in seconds (365 days from creation) */
  expiresAt: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of fields per form */
export const MAX_FIELDS_PER_FORM = 50;

/** Maximum file size in MB for carga_archivo fields */
export const MAX_FILE_SIZE_MB = 10;

/** Allowed file types for carga_archivo fields */
export const ALLOWED_FILE_TYPES = ['pdf', 'jpeg', 'png'];

/** Presigned URL expiry in seconds (15 minutes) */
export const SIGNED_URL_EXPIRY_SECONDS = 15 * 60;

/** Rate limit: max submissions per IP per form per window */
export const RATE_LIMIT_MAX_REQUESTS = 10;

/** Rate limit window in milliseconds (5 minutes) */
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

/** Folio length (alphanumeric characters) */
export const FOLIO_LENGTH = 8;

/** Audit TTL in seconds (365 days) */
export const AUDIT_TTL_SECONDS = 365 * 24 * 60 * 60;
