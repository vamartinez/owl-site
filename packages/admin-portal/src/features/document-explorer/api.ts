/**
 * API client functions for the Document Explorer feature.
 * Uses the shared apiClient for consistent auth headers (Cognito idToken) and error handling.
 */

import { apiClient } from '@/services/api-client';
import type {
  OrganizationMode,
  FolderContentsResponse,
  DocumentSearchResponse,
  DocumentMetadataResponse,
  DownloadInitResponse,
  BatchDownloadStatusResponse,
  IntegrityVerificationResponse,
  DocumentFilters,
  AuditLogEntry,
} from './types';

// ─── Folder Navigation ────────────────────────────────────────────────────────

/** GET /documents/folders — List folder contents at a given path */
export function fetchFolderContents(
  path: string,
  page: number,
  pageSize: number,
  orgMode: OrganizationMode
): Promise<FolderContentsResponse> {
  const params: Record<string, string> = {
    path,
    page: String(page),
    page_size: String(pageSize),
    org_mode: orgMode,
  };
  return apiClient.get<FolderContentsResponse>('/documents/folders', params);
}

// ─── Search ───────────────────────────────────────────────────────────────────

/** GET /documents/search — Global document search with filters */
export function searchDocuments(
  query: string,
  filters: DocumentFilters,
  page: number
): Promise<DocumentSearchResponse> {
  const params: Record<string, string> = {
    q: query,
    page: String(page),
  };

  if (filters.category) {
    params.category = filters.category;
  }
  if (filters.dateFrom) {
    params.date_from = filters.dateFrom;
  }
  if (filters.dateTo) {
    params.date_to = filters.dateTo;
  }
  if (filters.siteId) {
    params.site_id = filters.siteId;
  }

  return apiClient.get<DocumentSearchResponse>('/documents/search', params);
}

// ─── Document Details ─────────────────────────────────────────────────────────

/** GET /documents/{id}/metadata — Fetch full document metadata */
export function fetchDocumentMetadata(id: string): Promise<DocumentMetadataResponse> {
  return apiClient.get<DocumentMetadataResponse>(`/documents/${id}/metadata`);
}

/** GET /documents/{id}/preview — Fetch presigned preview URL */
export function fetchDocumentPreview(id: string): Promise<{ previewUrl: string; expiresAt: string }> {
  return apiClient.get<{ previewUrl: string; expiresAt: string }>(`/documents/${id}/preview`);
}

// ─── Downloads ────────────────────────────────────────────────────────────────

/** POST /documents/download — Initiate single or batch download */
export function initiateDownload(documentIds: string[]): Promise<DownloadInitResponse> {
  return apiClient.post<DownloadInitResponse>('/documents/download', { documentIds });
}

/** GET /documents/download/{downloadId}/status — Poll batch download status */
export function pollDownloadStatus(downloadId: string): Promise<BatchDownloadStatusResponse> {
  return apiClient.get<BatchDownloadStatusResponse>(`/documents/download/${downloadId}/status`);
}

// ─── Integrity Verification ───────────────────────────────────────────────────

/** POST /documents/{id}/verify-integrity — Trigger integrity verification */
export function verifyIntegrity(documentId: string): Promise<IntegrityVerificationResponse> {
  return apiClient.post<IntegrityVerificationResponse>(`/documents/${documentId}/verify-integrity`);
}

// ─── Organization Preferences ─────────────────────────────────────────────────

/** GET /documents/preferences/organization-mode — Get current organization mode preference */
export function getOrganizationMode(): Promise<{ mode: OrganizationMode }> {
  return apiClient.get<{ mode: OrganizationMode }>('/documents/preferences/organization-mode');
}

/** PUT /documents/preferences/organization-mode — Set organization mode preference */
export function setOrganizationMode(mode: OrganizationMode): Promise<{ mode: OrganizationMode }> {
  return apiClient.put<{ mode: OrganizationMode }>('/documents/preferences/organization-mode', { mode });
}

// ─── Audit Logging ────────────────────────────────────────────────────────────

/** POST /documents/audit-log — Log an audit event for document access */
export function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  return apiClient.post<void>('/documents/audit-log', entry);
}
