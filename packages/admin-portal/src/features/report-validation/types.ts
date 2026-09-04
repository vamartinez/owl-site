export type ReportStatus = 'draft' | 'validating' | 'validated' | 'submitted';
export type FindingSeverity = 'critical' | 'major' | 'minor' | 'informational';
export type KBDocumentCategory = 'worksafebc' | 'bc-building-code' | 'safety-standards' | 'canada-general';
export type KBSyncStatus = 'pending' | 'indexed' | 'error';

export interface Report {
  report_id: string;
  tenant_id: string;
  owner_id: string;
  title: string;
  status: ReportStatus;
  current_version: number;
  created_at: string;
  updated_at: string;
  submitted_at?: string;
  latest_score?: number;
  latest_validation_date?: string;
}

export interface ReportVersion {
  report_id: string;
  version: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  page_count?: number;
  uploaded_at: string;
}

export interface ValidationResult {
  validation_id: string;
  report_id: string;
  version: number;
  status: 'processing' | 'completed' | 'failed' | 'timed_out';
  score?: number;
  summary?: string;
  findings: ComplianceFinding[];
  requested_at: string;
  completed_at?: string;
}

export interface ComplianceFinding {
  finding_id: string;
  severity: FindingSeverity;
  description: string;
  report_section: string;
  suggested_correction: string;
  regulation_references: RegulationReference[];
}

export interface RegulationReference {
  title: string;
  section: string;
  url?: string;
}

export interface KBContextDocument {
  document_id: string;
  file_name: string;
  file_size: number;
  category: KBDocumentCategory;
  sync_status: KBSyncStatus;
  uploaded_at: string;
}
