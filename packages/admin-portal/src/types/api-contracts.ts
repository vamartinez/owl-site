/**
 * API Contracts — Backend response types and frontend mappers.
 *
 * This file defines the exact shapes returned by the backend API (snake_case)
 * and provides normalizer functions to convert them into the camelCase
 * interfaces used by frontend components.
 *
 * Source of truth: packages/backend/src/services/identity/types.ts
 */

// ─── Enums (shared with backend) ────────────────────────────────────────────

export enum CertificationType {
  WHMIS_2015 = 'whmis_2015',
  FALL_PROTECTION = 'fall_protection',
  SITE_READY_BC = 'site_ready_bc',
  FIRST_AID = 'first_aid',
}

export enum CertificationStatus {
  PENDING = 'pending',
  VALIDATED = 'validated',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum LanguagePreference {
  ENGLISH = 'en',
  SPANISH = 'es',
  PUNJABI = 'pa',
}

// ─── API Response Types (snake_case — exactly as backend returns) ────────────

/** GET /workers — response.workers[] */
export interface ApiWorkerListItem {
  worker_id: string;
  legal_name: string;
  preferred_name?: string;
  phone: string;
  language_preference: string;
  created_at: string;
}

/** GET /workers — full response */
export interface ApiListWorkersResponse {
  workers: ApiWorkerListItem[];
  total: number;
}

/** GET /workers/{id} — response.worker */
export interface ApiWorkerDetail {
  worker_id: string;
  tenant_id: string;
  legal_name: string;
  preferred_name?: string;
  phone: string;
  language_preference: string;
  email?: string;
  qr_identity_reference?: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

/** GET /workers/{id} — full response */
export interface ApiGetWorkerResponse {
  worker: ApiWorkerDetail;
}

/** GET /workers/{id}/certifications — response.certifications[] */
export interface ApiCertification {
  certification_id: string;
  worker_id: string;
  tenant_id: string;
  certification_type: CertificationType;
  issuer: string;
  issue_date: string;
  expiry_date: string;
  document_key?: string;
  document_url?: string;
  validation_status: CertificationStatus;
  validated_by?: string;
  validated_at?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
}

/** GET /workers/{id}/certifications — full response */
export interface ApiListCertificationsResponse {
  certifications: ApiCertification[];
}

/** POST /workers/{id}/certifications — request body */
export interface ApiCreateCertificationRequest {
  certification_type: CertificationType;
  issuer: string;
  issue_date: string;
  expiry_date: string;
  document_content_type?: string;
  document_size?: number;
  document_filename?: string;
}

/** POST /workers/{id}/certifications — full response */
export interface ApiCreateCertificationResponse {
  certification: ApiCertification;
  upload_url: string;
}

/** PATCH /workers/{id}/certifications/{certId} — request body */
export interface ApiUpdateCertificationRequest {
  validation_status?: CertificationStatus;
  rejection_reason?: string;
}

/** PATCH /workers/{id}/certifications/{certId} — full response */
export interface ApiUpdateCertificationResponse {
  certification: ApiCertification;
}

/** POST /workers — request body */
export interface ApiCreateWorkerRequest {
  legal_name: string;
  preferred_name?: string;
  phone: string;
  language_preference: LanguagePreference;
  email?: string;
}

/** POST /workers — full response */
export interface ApiCreateWorkerResponse {
  worker: ApiWorkerDetail;
}

/** PATCH /workers/{id} — request body */
export interface ApiUpdateWorkerRequest {
  legal_name?: string;
  preferred_name?: string;
  phone?: string;
  language_preference?: LanguagePreference;
  email?: string;
}

// ─── Frontend Types (camelCase — used by components) ─────────────────────────

export interface Worker {
  id: string;
  legalName: string;
  preferredName: string;
  phone: string;
  languagePreference: string;
  email?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt?: string;
}

export interface WorkerListItem {
  id: string;
  legalName: string;
  preferredName: string;
  phone: string;
  languagePreference: string;
  createdAt: string;
}

export interface Certification {
  certificationId: string;
  workerId: string;
  tenantId: string;
  certificationType: CertificationType;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  documentKey?: string;
  documentUrl?: string;
  validationStatus: CertificationStatus;
  validatedBy?: string;
  validatedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Normalizers (API → Frontend) ────────────────────────────────────────────

export function normalizeWorkerListItem(item: ApiWorkerListItem): WorkerListItem {
  return {
    id: item.worker_id,
    legalName: item.legal_name,
    preferredName: item.preferred_name || '',
    phone: item.phone,
    languagePreference: item.language_preference,
    createdAt: item.created_at,
  };
}

export function normalizeWorkerDetail(item: ApiWorkerDetail): Worker {
  return {
    id: item.worker_id,
    legalName: item.legal_name,
    preferredName: item.preferred_name || '',
    phone: item.phone,
    languagePreference: item.language_preference,
    email: item.email,
    status: item.status,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export function normalizeCertification(item: ApiCertification): Certification {
  return {
    certificationId: item.certification_id,
    workerId: item.worker_id,
    tenantId: item.tenant_id,
    certificationType: item.certification_type,
    issuer: item.issuer,
    issueDate: item.issue_date,
    expiryDate: item.expiry_date,
    documentKey: item.document_key,
    documentUrl: item.document_url,
    validationStatus: item.validation_status,
    validatedBy: item.validated_by,
    validatedAt: item.validated_at,
    rejectionReason: item.rejection_reason,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

// ─── Denormalizers (Frontend → API) ──────────────────────────────────────────

export function toApiCreateCertificationRequest(data: {
  certificationType: CertificationType;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  documentContentType?: string;
  documentSize?: number;
  documentFilename?: string;
}): ApiCreateCertificationRequest {
  return {
    certification_type: data.certificationType,
    issuer: data.issuer,
    issue_date: data.issueDate,
    expiry_date: data.expiryDate,
    document_content_type: data.documentContentType,
    document_size: data.documentSize,
    document_filename: data.documentFilename,
  };
}

export function toApiUpdateCertificationRequest(data: {
  validationStatus?: CertificationStatus;
  rejectionReason?: string;
}): ApiUpdateCertificationRequest {
  return {
    validation_status: data.validationStatus,
    rejection_reason: data.rejectionReason,
  };
}

export function toApiCreateWorkerRequest(data: {
  legalName: string;
  preferredName?: string;
  phone: string;
  languagePreference: LanguagePreference;
  email?: string;
}): ApiCreateWorkerRequest {
  return {
    legal_name: data.legalName,
    preferred_name: data.preferredName,
    phone: data.phone,
    language_preference: data.languagePreference,
    email: data.email,
  };
}
