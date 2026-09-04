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

export interface Certification {
  certification_id: string;
  worker_id: string;
  tenant_id: string;
  certification_type: CertificationType;
  issuer: string;
  issue_date: string;
  expiry_date: string;
  document_key?: string;
  validation_status: CertificationStatus;
  validated_by?: string;
  validated_at?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
}

export type ExpiryStatus = 'valid' | 'expiring' | 'expired';

// API Request/Response interfaces

export interface CreateCertificationRequest {
  certification_type: CertificationType;
  issuer: string;
  issue_date: string;
  expiry_date: string;
  document_content_type: string;
  document_size: number;
  document_filename: string;
}

export interface CreateCertificationResponse {
  certification: Certification;
  upload_url: string;
}

export interface UpdateCertificationRequest {
  validation_status?: CertificationStatus;
  rejection_reason?: string;
}

export type ListCertificationsResponse = Certification[];
