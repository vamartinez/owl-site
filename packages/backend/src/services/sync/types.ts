/**
 * TypeScript interfaces for the Sync Service domain.
 *
 * Requirements: 15.1, 15.2, 15.3, 18.17
 */

export interface OfflineScanSession {
  session_id: string;
  worker_id: string;
  site_id: string;
  tenant_id: string;
  scan_timestamp: string; // ISO 8601 UTC
  scanner_type: string;
  device_id: string;
  token_reference?: string;
  cached_decision?: string; // Decision made offline
  cached_at: string; // When the decision was cached
}

export interface SyncSessionsRequest {
  device_id: string;
  sessions: OfflineScanSession[];
}

export interface SyncMediaRequest {
  device_id: string;
  media_items: OfflineMediaItem[];
}

export interface OfflineMediaItem {
  media_id: string;
  inspection_id: string;
  site_id: string;
  tenant_id: string;
  file_name: string;
  content_type: string;
  file_size: number;
  captured_at: string;
}

export interface SyncResult {
  session_id: string;
  status: 'synced' | 're_evaluated' | 'stale' | 'error';
  backend_decision?: string;
  cached_decision?: string;
  decision_changed: boolean;
  stale: boolean;
  error_message?: string;
}

export interface SyncMediaResult {
  media_id: string;
  status: 'uploaded' | 'error';
  upload_url?: string;
  error_message?: string;
}

export interface SyncStatusResponse {
  device_id: string;
  last_sync_at?: string;
  pending_sessions: number;
  pending_media: number;
  sync_health: 'healthy' | 'stale' | 'error';
}

export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
