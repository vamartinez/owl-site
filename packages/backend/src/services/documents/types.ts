/**
 * TypeScript interfaces and type literals for the Document Explorer service.
 * Covers unified document model, folder structure, source table config, and API response types.
 */

// ─── Type Literals ────────────────────────────────────────────────────────────

export type DocumentCategory =
  | 'reports'
  | 'forms'
  | 'certifications'
  | 'incidents'
  | 'safety_evidence';

export type OrganizationMode =
  | 'category_site_year_month'
  | 'category_year_month_site';

export type IntegrityStatus = 'verified' | 'mismatch' | 'pending' | 'unavailable';

export type DownloadStatus = 'preparing' | 'ready' | 'failed' | 'expired';

export type AuditEventType = 'download_single' | 'download_batch';

// ─── Core Models ──────────────────────────────────────────────────────────────

export interface UnifiedDocument {
  id: string;
  name: string;
  category: DocumentCategory;
  mimeType: string;
  fileSize: number;
  /** ISO 8601 with timezone */
  createdAt: string;
  siteName: string;
  siteId: string;
  tenantId: string;
  s3Key: string;
  sha256Hash: string | null;
  /** Computed from category + metadata + org_mode */
  folderPath: string[];
}

export interface FolderNode {
  id: string;
  name: string;
  path: string[];
  childFolderCount: number;
  documentCount: number;
  lastUpdated: string;
}

export interface DocumentDetail extends UnifiedDocument {
  creatorUserId: string;
  creatorUserName: string;
  downloadCount: number;
  lastDownloadedAt: string | null;
  integrityStatus: IntegrityStatus;
  lastVerifiedAt: string | null;
}

// ─── Source Table Configuration ───────────────────────────────────────────────

export interface SourceTableConfig {
  tableName: string;
  category: DocumentCategory;
  fieldMap: Record<
    keyof Pick<
      UnifiedDocument,
      | 'id'
      | 'name'
      | 'mimeType'
      | 'fileSize'
      | 'createdAt'
      | 'siteName'
      | 'siteId'
      | 'tenantId'
      | 's3Key'
      | 'sha256Hash'
    >,
    string
  >;
}

// ─── Response Interfaces ──────────────────────────────────────────────────────

export interface FolderContentsResponse {
  currentPath: string[];
  folders: FolderNode[];
  documents: Omit<UnifiedDocument, 'tenantId' | 's3Key' | 'sha256Hash'>[];
  totalDocuments: number;
  page: number;
  pageSize: number;
  totalPages: number;
  unavailableSources?: string[];
}

export interface SearchResponse {
  results: (Omit<UnifiedDocument, 'tenantId' | 's3Key' | 'sha256Hash'> & {
    matchFolderPath: string[];
  })[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DownloadInitResponse {
  downloadId: string;
  downloadUrl: string;
  expiresAt: string;
  totalSize: number;
  fileCount: number;
  skippedDocuments?: { id: string; name: string; reason: string }[];
}

export interface BatchDownloadStatusResponse {
  downloadId: string;
  status: DownloadStatus;
  progress: number;
  downloadUrl?: string;
  errorMessage?: string;
}

export interface IntegrityVerificationResponse {
  documentId: string;
  storedHash: string;
  computedHash: string;
  match: boolean;
  verifiedAt: string;
}

export interface AuditLogEntry {
  eventType: AuditEventType;
  documentIds: string[];
  userId: string;
  tenantId: string;
  /** ISO 8601 with timezone */
  timestamp: string;
  /** DynamoDB TTL epoch seconds */
  ttl: number;
}
