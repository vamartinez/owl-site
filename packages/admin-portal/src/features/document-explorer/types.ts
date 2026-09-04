// === Enums and Literals ===

export type DocumentCategory =
  | 'reports'
  | 'forms'
  | 'certifications'
  | 'incidents'
  | 'safety_evidence';

export type OrganizationMode =
  | 'category_site_year_month' // {Category}/{Site Name}/{Year}/{Month}
  | 'category_year_month_site'; // {Category}/{Year}/{Month}/{Site Name}

export type PreviewableFormat = 'application/pdf' | 'image/jpeg' | 'image/png';

// === Core Models ===

export interface FolderNode {
  id: string;
  name: string;
  path: string[]; // Full path segments from root
  childFolderCount: number;
  documentCount: number;
  lastUpdated: string; // ISO 8601 with timezone
}

export interface DocumentSummary {
  id: string;
  name: string;
  category: DocumentCategory;
  mimeType: string;
  fileSize: number; // bytes
  createdAt: string; // ISO 8601 with timezone
  siteName: string;
  siteId: string;
  folderPath: string[];
}

export interface DocumentDetail extends DocumentSummary {
  creatorUserId: string;
  creatorUserName: string;
  tenantId: string;
  sha256Hash: string;
  downloadCount: number;
  lastDownloadedAt: string | null;
}

export interface DocumentMetadataResponse {
  document: DocumentDetail;
  integrityStatus: 'verified' | 'mismatch' | 'pending' | 'unavailable';
  lastVerifiedAt: string | null;
}

// === API Response Types ===

export interface FolderContentsResponse {
  currentPath: string[];
  folders: FolderNode[];
  documents: DocumentSummary[];
  totalDocuments: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DocumentSearchResponse {
  results: (DocumentSummary & { matchFolderPath: string[] })[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DownloadInitResponse {
  downloadId: string;
  downloadUrl: string; // Presigned S3 URL
  expiresAt: string;
  totalSize: number;
  fileCount: number;
}

export interface BatchDownloadStatusResponse {
  downloadId: string;
  status: 'preparing' | 'ready' | 'failed' | 'expired';
  progress: number; // 0-100
  downloadUrl?: string;
  errorMessage?: string;
  skippedDocuments?: { id: string; name: string; reason: string }[];
}

export interface IntegrityVerificationResponse {
  documentId: string;
  storedHash: string;
  computedHash: string;
  match: boolean;
  verifiedAt: string;
}

// === Filter Types ===

export interface DocumentFilters {
  category: DocumentCategory | null;
  dateFrom: string | null; // ISO date
  dateTo: string | null; // ISO date
  siteId: string | null;
}

// === Download Progress ===

export interface DownloadProgress {
  downloadId: string;
  status: 'initiating' | 'downloading' | 'packaging' | 'complete' | 'failed' | 'timeout';
  bytesDownloaded: number;
  totalBytes: number;
  startedAt: number; // timestamp ms
  estimatedRemainingMs: number | null;
  errorMessage?: string;
}

// === Audit Log ===

export interface AuditLogEntry {
  eventType: 'download_single' | 'download_batch';
  documentIds: string[];
  userId: string;
  timestamp: string; // ISO 8601 with timezone
}
