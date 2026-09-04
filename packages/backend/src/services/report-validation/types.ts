/**
 * Report Validation Service domain types and schemas.
 * Defines report lifecycle types, validation result structures, KB document types,
 * status transition rules, and Zod validation schemas for API payloads.
 *
 * Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3
 */

import { z } from 'zod';
import { boundedString, paginationQuerySchema } from '../../shared/validators.js';

// ---------------------------------------------------------------------------
// Type Unions
// ---------------------------------------------------------------------------

/**
 * Report lifecycle states.
 * Requirement 2.1: draft → validating → validated → submitted
 */
export type ReportStatus = 'draft' | 'validating' | 'validated' | 'submitted';

/**
 * Severity levels for compliance findings.
 * Requirement 4.2: critical, major, minor, informational
 */
export type FindingSeverity = 'critical' | 'major' | 'minor' | 'informational';

/**
 * Categories for Knowledge Base context documents.
 * Requirement 13.4: organized by regulatory domain.
 */
export type KBDocumentCategory = 'worksafebc' | 'bc-building-code' | 'safety-standards' | 'canada-general';

/**
 * Sync status for Knowledge Base documents after upload.
 * Requirement 13.5, 13.9: pending → indexed | error
 */
export type KBSyncStatus = 'pending' | 'indexed' | 'error';

// ---------------------------------------------------------------------------
// Domain Interfaces
// ---------------------------------------------------------------------------

/**
 * Status transition log entry.
 * Requirement 2.5: records who triggered the change and when.
 */
export interface StatusTransition {
  from_status: ReportStatus;
  to_status: ReportStatus;
  triggered_by: string; // user_id
  timestamp: string; // ISO 8601 UTC
}

/**
 * Report record stored in DynamoDB.
 * Requirements: 1.3, 1.4, 2.1, 2.5
 */
export interface ReportRecord {
  tenant_id: string;
  report_id: string; // ULID
  owner_id: string; // Cognito sub
  title: string; // Derived from filename (max 255 chars)
  status: ReportStatus;
  current_version: number; // Starts at 1
  submitted_at?: string; // ISO 8601 UTC
  submitted_by?: string;
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
  status_history: StatusTransition[];
}

/**
 * Report version record stored in DynamoDB.
 * Requirements: 1.4, 6.2, 6.3
 */
export interface ReportVersionRecord {
  report_id: string;
  version: number;
  file_name: string; // Original filename (max 255 chars)
  file_size: number; // Bytes
  mime_type: string;
  page_count?: number; // For PDFs
  s3_key: string; // S3 object key
  extracted_text_key?: string; // S3 key for stored extracted text
  extraction_status: 'pending' | 'completed' | 'failed';
  character_count?: number;
  uploaded_by: string;
  uploaded_at: string; // ISO 8601 UTC
}

/**
 * Individual compliance finding from AI validation.
 * Requirements: 4.2, 4.3
 */
export interface ComplianceFinding {
  finding_id: string; // ULID
  severity: FindingSeverity;
  description: string; // Max 500 chars
  report_section: string; // Section heading or page number
  suggested_correction: string; // Max 500 chars
  regulation_references: RegulationReference[];
}

/**
 * Reference to a specific regulation clause.
 * Requirement 4.3: citation to applicable law or standard.
 */
export interface RegulationReference {
  title: string; // e.g., "WorkSafeBC OHS Regulation Part 11.2"
  section: string; // e.g., "11.2(1)(a)"
  url?: string; // Link to regulation text
}

/**
 * Validation result record stored in DynamoDB.
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
export interface ValidationResultRecord {
  report_id: string;
  version: number;
  validation_id: string; // ULID
  status: 'processing' | 'completed' | 'failed' | 'timed_out';
  score?: number; // 0-100
  summary?: string; // Max 2000 chars
  findings: ComplianceFinding[]; // Max 50
  requested_at: string; // ISO 8601 UTC
  completed_at?: string; // ISO 8601 UTC
  requested_by: string;
  error_message?: string;
}

/**
 * Knowledge Base context document record.
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */
export interface KBContextDocumentRecord {
  tenant_id: string;
  document_id: string; // ULID
  file_name: string; // Max 255 chars
  file_size: number; // Bytes
  mime_type: string;
  category: KBDocumentCategory;
  s3_key: string;
  sync_status: KBSyncStatus;
  sync_error?: string;
  uploaded_by: string;
  uploaded_at: string; // ISO 8601 UTC
}

// ---------------------------------------------------------------------------
// Status Transition Rules
// ---------------------------------------------------------------------------

/**
 * Valid status transitions map.
 * Requirement 2.2: defines the allowed state machine transitions.
 */
export const VALID_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  draft: ['validating', 'submitted'],
  validating: ['validated', 'draft'], // draft on failure/timeout
  validated: ['draft', 'submitted'], // draft on new version upload
  submitted: [], // terminal state
};

/**
 * Checks whether a status transition is allowed.
 * Requirement 2.3: rejects invalid transitions with error.
 */
export function isValidTransition(from: ReportStatus, to: ReportStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Allowed MIME types for report uploads. Requirement 1.1 */
export const ALLOWED_REPORT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
] as const;

/** Allowed MIME types for KB context documents. Requirement 13.2 */
export const ALLOWED_KB_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/** Minimum report file size in bytes (1 KB). Requirement 1.2 */
export const MIN_REPORT_FILE_SIZE = 1024;

/** Maximum report file size in bytes (25 MB). Requirement 1.2 */
export const MAX_REPORT_FILE_SIZE = 25 * 1024 * 1024;

/** Maximum KB document file size in bytes (50 MB). Requirement 13.2 */
export const MAX_KB_FILE_SIZE = 50 * 1024 * 1024;

/** Maximum number of findings per validation. Requirement 4.1 */
export const MAX_FINDINGS = 50;

/** Maximum report title length. Requirement 1.4 */
export const MAX_TITLE_LENGTH = 255;

/** Maximum finding description length. Requirement 4.3 */
export const MAX_FINDING_DESCRIPTION_LENGTH = 500;

/** Maximum suggested correction length. Requirement 4.3 */
export const MAX_SUGGESTED_CORRECTION_LENGTH = 500;

/** Maximum validation summary length. Requirement 4.1 */
export const MAX_SUMMARY_LENGTH = 2000;

/** Validation timeout in milliseconds (5 minutes). Requirement 3.8 */
export const VALIDATION_TIMEOUT_MS = 5 * 60 * 1000;

/** Minimum text extraction threshold in characters. Requirement 3.7 */
export const MIN_TEXT_EXTRACTION_CHARS = 50;

// ---------------------------------------------------------------------------
// Zod Validation Schemas — API Request/Response Payloads
// ---------------------------------------------------------------------------

/**
 * Schema for POST /report-validation/reports request body.
 * Requirements: 1.1, 1.2, 1.4
 */
export const createReportRequestSchema = z.object({
  file_name: boundedString(MAX_TITLE_LENGTH, 'File name'),
  file_size: z
    .number()
    .int()
    .min(MIN_REPORT_FILE_SIZE, 'File must be at least 1 KB')
    .max(MAX_REPORT_FILE_SIZE, 'File must not exceed 25 MB'),
  mime_type: z.enum(ALLOWED_REPORT_MIME_TYPES, {
    errorMap: () => ({ message: 'File must be PDF, .docx, or .doc format' }),
  }),
});

export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;

/**
 * Schema for POST /report-validation/reports/{id}/validate request.
 * Requirement 3.1: validation request on a draft report.
 */
export const validateReportRequestSchema = z.object({
  report_id: z.string().min(1, 'Report ID is required'),
});

export type ValidateReportRequest = z.infer<typeof validateReportRequestSchema>;

/**
 * Schema for POST /report-validation/reports/{id}/submit request.
 * Requirement 7.1: submit a draft or validated report.
 */
export const submitReportRequestSchema = z.object({
  report_id: z.string().min(1, 'Report ID is required'),
});

export type SubmitReportRequest = z.infer<typeof submitReportRequestSchema>;

/**
 * Schema for POST /report-validation/reports/{id}/versions request body.
 * Requirement 6.1: upload a new version of a validated report.
 */
export const uploadVersionRequestSchema = z.object({
  file_name: boundedString(MAX_TITLE_LENGTH, 'File name'),
  file_size: z
    .number()
    .int()
    .min(MIN_REPORT_FILE_SIZE, 'File must be at least 1 KB')
    .max(MAX_REPORT_FILE_SIZE, 'File must not exceed 25 MB'),
  mime_type: z.enum(ALLOWED_REPORT_MIME_TYPES, {
    errorMap: () => ({ message: 'File must be PDF, .docx, or .doc format' }),
  }),
});

export type UploadVersionRequest = z.infer<typeof uploadVersionRequestSchema>;

/**
 * Schema for POST /report-validation/kb/documents request body.
 * Requirements: 13.2, 13.3
 */
export const uploadKBDocumentRequestSchema = z.object({
  file_name: boundedString(MAX_TITLE_LENGTH, 'File name'),
  file_size: z
    .number()
    .int()
    .min(1, 'File size must be greater than 0')
    .max(MAX_KB_FILE_SIZE, 'File must not exceed 50 MB'),
  mime_type: z.enum(ALLOWED_KB_MIME_TYPES, {
    errorMap: () => ({ message: 'File must be PDF or .docx format' }),
  }),
  category: z.enum(
    ['worksafebc', 'bc-building-code', 'safety-standards', 'canada-general'] as const,
    {
      errorMap: () => ({
        message: 'Category must be one of: worksafebc, bc-building-code, safety-standards, canada-general',
      }),
    }
  ),
});

export type UploadKBDocumentRequest = z.infer<typeof uploadKBDocumentRequestSchema>;

/**
 * Schema for GET /report-validation/reports query parameters.
 * Requirement 8.1, 8.2: paginated list with status filter and sort.
 */
export const listReportsQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(['draft', 'validating', 'validated', 'submitted'] as const)
    .optional(),
  sort_by: z
    .enum(['upload_date', 'validation_date'] as const)
    .optional()
    .default('upload_date'),
  sort_order: z
    .enum(['asc', 'desc'] as const)
    .optional()
    .default('desc'),
});

export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

/**
 * Schema for the create report API response.
 * Requirement 1.7: returns report_id, status, and upload URL.
 */
export const createReportResponseSchema = z.object({
  report_id: z.string(),
  status: z.literal('draft'),
  upload_url: z.string().url(),
  created_at: z.string(),
});

export type CreateReportResponse = z.infer<typeof createReportResponseSchema>;
