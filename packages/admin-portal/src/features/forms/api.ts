/**
 * API client functions for all 12 authenticated Forms endpoints.
 * Uses the shared apiClient for consistent auth headers and error handling.
 */

import { apiClient } from '@/services/api-client';
import type {
  CreateFormRequest,
  CreateFormResponse,
  UpdateFormRequest,
  UpdateFormResponse,
  PublishFormResponse,
  UnpublishFormResponse,
  DuplicateFormResponse,
  ListFormsResponse,
  GetFormResponse,
  ListFormResponsesParams,
  ListFormResponsesResponse,
  GetFormResponseDetailResponse,
  ExportResponsesResponse,
  ListAuditResponse,
  UploadUrlRequest,
  UploadUrlResponse,
} from './types';

// ─── Form CRUD ────────────────────────────────────────────────────────────────

/** POST /forms — Create a new form */
export function createForm(data: CreateFormRequest): Promise<CreateFormResponse> {
  return apiClient.post<CreateFormResponse>('/forms', data);
}

/** GET /forms — List all forms for the current tenant */
export function listForms(params?: Record<string, string>): Promise<ListFormsResponse> {
  return apiClient.get<ListFormsResponse>('/forms', params);
}

/** GET /forms/{id} — Get a single form by ID */
export function getForm(formId: string): Promise<GetFormResponse> {
  return apiClient.get<GetFormResponse>(`/forms/${formId}`);
}

/** PATCH /forms/{id} — Update a draft form */
export function updateForm(formId: string, data: UpdateFormRequest): Promise<UpdateFormResponse> {
  return apiClient.patch<UpdateFormResponse>(`/forms/${formId}`, data);
}

// ─── Form Lifecycle ───────────────────────────────────────────────────────────

/** POST /forms/{id}/publish — Publish a draft form */
export function publishForm(formId: string): Promise<PublishFormResponse> {
  return apiClient.post<PublishFormResponse>(`/forms/${formId}/publish`);
}

/** POST /forms/{id}/unpublish — Unpublish a published form */
export function unpublishForm(formId: string): Promise<UnpublishFormResponse> {
  return apiClient.post<UnpublishFormResponse>(`/forms/${formId}/unpublish`);
}

/** POST /forms/{id}/duplicate — Duplicate a form */
export function duplicateForm(formId: string): Promise<DuplicateFormResponse> {
  return apiClient.post<DuplicateFormResponse>(`/forms/${formId}/duplicate`);
}


// ─── Responses ────────────────────────────────────────────────────────────────

/** GET /forms/{id}/responses — List responses with pagination and filters */
export function listFormResponses(
  formId: string,
  params?: ListFormResponsesParams
): Promise<ListFormResponsesResponse> {
  const queryParams: Record<string, string> = {};
  if (params?.page) queryParams.page = String(params.page);
  if (params?.start_date) queryParams.start_date = params.start_date;
  if (params?.end_date) queryParams.end_date = params.end_date;
  if (params?.status) queryParams.status = params.status;
  if (params?.contractor) queryParams.contractor = params.contractor;

  return apiClient.get<ListFormResponsesResponse>(`/forms/${formId}/responses`, queryParams);
}

/** GET /forms/{id}/responses/{responseId} — Get response detail */
export async function getFormResponseDetail(
  formId: string,
  responseId: string
): Promise<GetFormResponseDetailResponse> {
  const data = await apiClient.get<{ response: GetFormResponseDetailResponse['response']; version_schema: GetFormResponseDetailResponse['version'] }>(
    `/forms/${formId}/responses/${responseId}`
  );
  return {
    response: data.response,
    version: data.version_schema,
  };
}

/** GET /forms/{id}/responses/export — Export responses as CSV */
export function exportResponses(formId: string): Promise<ExportResponsesResponse> {
  return apiClient.get<ExportResponsesResponse>(`/forms/${formId}/responses/export`);
}

// ─── Audit ────────────────────────────────────────────────────────────────────

/** GET /forms/{id}/audit — List audit entries for a form */
export function listFormAudit(
  formId: string,
  params?: Record<string, string>
): Promise<ListAuditResponse> {
  return apiClient.get<ListAuditResponse>(`/forms/${formId}/audit`, params);
}

// ─── Audit ─────────────────────────────────────────────────────────────────────

/** POST /forms/{id}/audit — Log an audit event (e.g., QR download) */
export function logAuditEvent(
  formId: string,
  data: { action: string; metadata?: Record<string, unknown> }
): Promise<void> {
  return apiClient.post<void>(`/forms/${formId}/audit`, data);
}

// ─── File Upload ──────────────────────────────────────────────────────────────

/** POST /forms/{id}/upload-url — Generate a presigned URL for file upload */
export function getUploadUrl(
  formId: string,
  data: UploadUrlRequest
): Promise<UploadUrlResponse> {
  return apiClient.post<UploadUrlResponse>(`/forms/${formId}/upload-url`, data);
}
