/**
 * TypeScript types for the Forms feature in the admin portal.
 * Mirrors the backend domain types for use in the frontend.
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


// ─── Form ─────────────────────────────────────────────────────────────────────

export interface Form {
  form_id: string;
  tenant_id: string;
  name: string;
  description?: string;
  status: FormStatus;
  fields: FieldConfig[];
  token_publico?: string;
  current_version?: number;
  author_id: string;
  created_at: string;
  updated_at: string;
  published_at?: string;
}

// ─── Form Version ─────────────────────────────────────────────────────────────

export interface FormVersion {
  form_id: string;
  version_number: number;
  fields_snapshot: FieldConfig[];
  created_at: string;
  created_by: string;
}

// ─── Form Response ────────────────────────────────────────────────────────────

export interface FormResponseMetadata {
  origin_type: string;
  user_agent: string;
  ip_address: string;
}

export interface FormResponse {
  response_id: string;
  form_id: string;
  version_number: number;
  folio: string;
  submitted_at: string;
  answers: Record<string, unknown>;
  file_keys?: Record<string, string>;
  metadata: FormResponseMetadata;
  tenant_id: string;
}

// ─── API Request/Response Interfaces ──────────────────────────────────────────

export interface CreateFormRequest {
  name: string;
  description?: string;
}

export interface CreateFormResponse {
  form: Form;
}

export interface UpdateFormRequest {
  name?: string;
  description?: string;
  fields?: FieldConfig[];
}

export interface UpdateFormResponse {
  form: Form;
}

export interface PublishFormResponse {
  form: Form;
  token_publico: string;
  url_publica: string;
}

export interface UnpublishFormResponse {
  form: Form;
}

export interface DuplicateFormResponse {
  form: Form;
}

export interface ListFormsResponse {
  forms: Form[];
}

export interface GetFormResponse {
  form: Form;
}

export interface ListFormResponsesParams {
  page?: number;
  start_date?: string;
  end_date?: string;
  status?: string;
  contractor?: string;
}

export interface ListFormResponsesResponse {
  responses: FormResponse[];
  total: number;
  page: number;
  page_size: number;
}

export interface GetFormResponseDetailResponse {
  response: FormResponse;
  version: FormVersion;
}

export interface ExportResponsesResponse {
  csv_content: string;
  filename: string;
}

export interface AuditEntry {
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string;
  timestamp: string;
  ip_address: string;
  metadata: Record<string, unknown>;
  tenant_id: string;
}

export interface ListAuditResponse {
  entries: AuditEntry[];
  total: number;
}

export interface UploadUrlRequest {
  filename: string;
  content_type: string;
  size: number;
}

export interface UploadUrlResponse {
  upload_url: string;
  fields: Record<string, string>;
  file_key: string;
}
