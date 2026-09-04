/**
 * AI Orchestration Service domain types.
 * Defines Inspection, MediaAsset, and related interfaces.
 *
 * Requirements: 6.5, 6.6, 6.7, 11.3
 */

import { FindingStatus, Severity } from '../../shared/types/common.js';

/**
 * Supported image content types for inspection media.
 */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/**
 * Maximum image file size: 25 MB.
 */
export const MAX_IMAGE_SIZE = 25 * 1024 * 1024;

/**
 * Minimum image resolution: 640×480 pixels.
 */
export const MIN_IMAGE_WIDTH = 640;
export const MIN_IMAGE_HEIGHT = 480;

/**
 * Inspection status lifecycle.
 */
export enum InspectionStatus {
  CREATED = 'created',
  MEDIA_UPLOADED = 'media_uploaded',
  ANALYZING = 'analyzing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Media asset status.
 */
export enum MediaAssetStatus {
  PENDING_UPLOAD = 'pending_upload',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

/**
 * Inspection — represents a safety inspection session.
 */
export interface Inspection {
  inspection_id: string;
  tenant_id: string;
  site_id: string;
  created_by: string;
  trade: string;
  project_phase: string;
  status: InspectionStatus;
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
  media_count: number;
  notes?: string;
}

/**
 * MediaAsset — represents an uploaded image for inspection.
 */
export interface MediaAsset {
  asset_id: string;
  inspection_id: string;
  tenant_id: string;
  site_id: string;
  file_name: string;
  content_type: AllowedImageType;
  file_size: number; // bytes
  width: number; // pixels
  height: number; // pixels
  s3_key: string;
  upload_url?: string; // Pre-signed URL for upload
  status: MediaAssetStatus;
  uploaded_by: string;
  uploaded_at: string; // ISO 8601 UTC
  metadata: MediaMetadata;
}

/**
 * Metadata captured with each media upload.
 * Requirement 6.5: site_id, trade, project_phase, timestamp.
 */
export interface MediaMetadata {
  site_id: string;
  trade: string;
  project_phase: string;
  timestamp: string; // ISO 8601 UTC
}

/**
 * Image validation error reasons.
 * Requirement 6.7: specific error messages for each rejection reason.
 */
export enum ImageValidationError {
  UNSUPPORTED_FORMAT = 'Image format not supported. Accepted formats: JPEG, PNG.',
  EXCEEDS_MAX_SIZE = 'Image file size exceeds the maximum allowed size of 25 MB.',
  BELOW_MIN_RESOLUTION = 'Image resolution is below the minimum required resolution of 640×480 pixels.',
  CANNOT_PROCESS = 'Image cannot be processed. Please upload a valid JPEG or PNG file.',
}

/**
 * Input for creating an inspection.
 */
export interface CreateInspectionInput {
  site_id: string;
  trade: string;
  project_phase: string;
  notes?: string;
}

/**
 * Input for uploading media to an inspection.
 */
export interface UploadMediaInput {
  file_name: string;
  content_type: string;
  file_size: number;
  width: number;
  height: number;
}

/**
 * Response for media upload containing the signed URL.
 */
export interface UploadMediaResponse {
  asset_id: string;
  upload_url: string;
  s3_key: string;
  expires_in: number; // seconds
}
