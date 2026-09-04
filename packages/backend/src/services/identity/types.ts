/**
 * TypeScript interfaces for the Identity Service domain.
 * Covers WorkerIdentity and Certification entities.
 */

import { CertificationStatus } from '../../shared/types/common.js';
import type { CertificationType, LanguagePreference } from '../../shared/types/common.js';

export interface WorkerIdentity {
  worker_id: string;
  tenant_id: string;
  legal_name: string;
  preferred_name?: string;
  phone: string;
  language_preference: LanguagePreference;
  email?: string;
  qr_identity_reference?: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface Certification {
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

export interface CreateWorkerInput {
  legal_name: string;
  preferred_name?: string;
  phone: string;
  language_preference: LanguagePreference;
  email?: string;
}

export interface UpdateWorkerInput {
  legal_name?: string;
  preferred_name?: string;
  phone?: string;
  language_preference?: LanguagePreference;
  email?: string;
}

export interface CreateCertificationInput {
  certification_type: CertificationType;
  issuer: string;
  issue_date: string;
  expiry_date: string;
  document_content_type?: string;
  document_size?: number;
  document_filename?: string;
}

export interface UpdateCertificationInput {
  validation_status?: CertificationStatus;
  rejection_reason?: string;
  validated_by?: string;
}

/**
 * Valid certification status transitions.
 * Key: current status, Value: array of allowed next statuses.
 */
export const VALID_STATUS_TRANSITIONS: Record<CertificationStatus, CertificationStatus[]> = {
  [CertificationStatus.PENDING]: [CertificationStatus.VALIDATED, CertificationStatus.REJECTED, CertificationStatus.EXPIRED],
  [CertificationStatus.VALIDATED]: [CertificationStatus.EXPIRED],
  [CertificationStatus.REJECTED]: [CertificationStatus.PENDING, CertificationStatus.EXPIRED],
  [CertificationStatus.EXPIRED]: [],
};

/**
 * Allowed document MIME types for certification uploads.
 */
export const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/**
 * Maximum document size in bytes (10 MB).
 */
export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

/**
 * S3 signed URL expiry in seconds (15 minutes).
 */
export const SIGNED_URL_EXPIRY_SECONDS = 15 * 60;
