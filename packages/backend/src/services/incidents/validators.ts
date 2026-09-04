/**
 * Zod validation schemas for the Incident Reporting Service.
 * Validates all request payloads for incident CRUD, comments, attachments,
 * closure/reopening, persons involved, and regulatory data.
 *
 * Requirements: 1.3, 2.2, 2.3, 3.1, 12.1, 12.2, 12.3, 14.4, 19.1, 20.1
 */

import { z } from 'zod';
import {
  IncidentType,
  OperationalSeverity,
  InvolvementType,
  OshaRecordability,
  OshaCaseOutcome,
} from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Allowed MIME types for evidence attachments.
 * Requirement 12.1: Accepted file types.
 */
export const ALLOWED_EVIDENCE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
] as const;

/**
 * Maximum file size in bytes (50 MB).
 * Requirement 12.2: Size limit.
 */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Maximum video duration in seconds (60 seconds).
 * Requirement 12.3: Duration limit.
 */
export const MAX_VIDEO_DURATION_SECONDS = 60;

// ─── Helper: Video MIME types ────────────────────────────────────────────────

const VIDEO_MIME_TYPES: string[] = ['video/mp4', 'video/quicktime'];

// ─── Regulatory Indicators Schema ───────────────────────────────────────────

/**
 * Boolean regulatory indicators with defaults of false.
 * Requirement 3.3: Regulatory indicators default to false when omitted.
 */
export const regulatoryIndicatorsSchema = z.object({
  medical_treatment_beyond_first_aid: z.boolean().default(false),
  lost_time: z.boolean().default(false),
  hospitalization: z.boolean().default(false),
  fatality: z.boolean().default(false),
  amputation: z.boolean().default(false),
  loss_of_eye: z.boolean().default(false),
  structural_collapse: z.boolean().default(false),
  hazardous_substance_release: z.boolean().default(false),
  fire_or_explosion: z.boolean().default(false),
});

export type RegulatoryIndicatorsInput = z.input<typeof regulatoryIndicatorsSchema>;

// ─── Incident Create Schema ─────────────────────────────────────────────────

/**
 * Validates the payload for creating a new incident.
 * Requirements 1.3, 2.2, 2.3, 3.1: Mandatory fields, type selection, "Other" refinement.
 */
export const incidentCreateSchema = z
  .object({
    title: z
      .string()
      .min(1, 'Title is required')
      .max(200, 'Title must not exceed 200 characters'),
    description: z
      .string()
      .min(1, 'Description is required')
      .max(5000, 'Description must not exceed 5000 characters'),
    incident_type: z.nativeEnum(IncidentType, {
      errorMap: () => ({ message: 'Invalid incident type' }),
    }),
    other_type_description: z.string().max(500).optional(),
    incident_datetime: z
      .string()
      .min(1, 'Incident date/time is required'),
    site_id: z
      .string()
      .min(1, 'Site is required'),
    location: z
      .string()
      .min(1, 'Location is required'),
    persons_involved_count: z
      .number()
      .int('Must be an integer')
      .min(0, 'Must be zero or greater'),
    severity: z.nativeEnum(OperationalSeverity, {
      errorMap: () => ({ message: 'Invalid severity level' }),
    }),
    jurisdiction: z.string().optional(),
    regulatory_indicators: regulatoryIndicatorsSchema,
  })
  .refine(
    (data) =>
      data.incident_type !== IncidentType.OTHER ||
      (data.other_type_description !== undefined &&
        data.other_type_description.length >= 10),
    {
      message: 'Custom type description must be at least 10 characters',
      path: ['other_type_description'],
    }
  );

export type IncidentCreateInput = z.infer<typeof incidentCreateSchema>;

// ─── Incident Update Schema ─────────────────────────────────────────────────

/**
 * Validates the payload for updating an existing incident.
 * All fields are optional — only provided fields are updated.
 */
export const incidentUpdateSchema = z
  .object({
    title: z
      .string()
      .min(1, 'Title is required')
      .max(200, 'Title must not exceed 200 characters')
      .optional(),
    description: z
      .string()
      .min(1, 'Description is required')
      .max(5000, 'Description must not exceed 5000 characters')
      .optional(),
    incident_type: z
      .nativeEnum(IncidentType, {
        errorMap: () => ({ message: 'Invalid incident type' }),
      })
      .optional(),
    other_type_description: z.string().max(500).optional(),
    incident_datetime: z.string().min(1).optional(),
    location: z.string().min(1, 'Location is required').optional(),
    persons_involved_count: z
      .number()
      .int('Must be an integer')
      .min(0, 'Must be zero or greater')
      .optional(),
    severity: z
      .nativeEnum(OperationalSeverity, {
        errorMap: () => ({ message: 'Invalid severity level' }),
      })
      .optional(),
    regulatory_indicators: regulatoryIndicatorsSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.incident_type === IncidentType.OTHER) {
        return (
          data.other_type_description !== undefined &&
          data.other_type_description.length >= 10
        );
      }
      return true;
    },
    {
      message: 'Custom type description must be at least 10 characters',
      path: ['other_type_description'],
    }
  );

export type IncidentUpdateInput = z.infer<typeof incidentUpdateSchema>;

// ─── Comment Schema ─────────────────────────────────────────────────────────

/**
 * Validates comment creation payload.
 * Requirement 14.4: Reject empty or whitespace-only comments, max 5000 chars.
 */
export const commentSchema = z.object({
  content: z
    .string()
    .transform((val) => val.trim())
    .pipe(
      z
        .string()
        .min(1, 'Comment cannot be empty')
        .max(5000, 'Comment must not exceed 5000 characters')
    ),
});

export type CommentInput = z.infer<typeof commentSchema>;

// ─── Closure Schema ─────────────────────────────────────────────────────────

/**
 * Validates incident closure payload.
 * Requirement 19.1: Resolution notes minimum 20 characters after trimming.
 */
export const closureSchema = z.object({
  resolution_notes: z
    .string()
    .transform((val) => val.trim())
    .pipe(
      z
        .string()
        .min(20, 'Resolution notes must be at least 20 characters')
    ),
});

export type ClosureInput = z.infer<typeof closureSchema>;

// ─── Reopen Schema ──────────────────────────────────────────────────────────

/**
 * Validates incident reopening payload.
 * Requirement 20.1: Justification minimum 20 characters after trimming.
 */
export const reopenSchema = z.object({
  justification: z
    .string()
    .transform((val) => val.trim())
    .pipe(
      z
        .string()
        .min(20, 'Reopening justification must be at least 20 characters')
    ),
});

export type ReopenInput = z.infer<typeof reopenSchema>;

// ─── Attachment Schema ──────────────────────────────────────────────────────

/**
 * Validates attachment creation metadata.
 * Requirements 12.1, 12.2, 12.3: MIME type, size, and video duration validation.
 */
export const createAttachmentSchema = z
  .object({
    file_name: z.string().min(1, 'File name is required'),
    mime_type: z.string().refine(
      (val) => (ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(val),
      {
        message: `File type must be one of: ${ALLOWED_EVIDENCE_TYPES.join(', ')}`,
      }
    ),
    size_bytes: z
      .number()
      .int()
      .min(1, 'File size must be greater than 0')
      .max(MAX_FILE_SIZE, `File must not exceed ${MAX_FILE_SIZE / (1024 * 1024)} MB`),
    duration_seconds: z.number().min(0).optional(),
  })
  .refine(
    (data) => {
      if (VIDEO_MIME_TYPES.includes(data.mime_type)) {
        return (
          data.duration_seconds !== undefined &&
          data.duration_seconds <= MAX_VIDEO_DURATION_SECONDS
        );
      }
      return true;
    },
    {
      message: `Video duration must not exceed ${MAX_VIDEO_DURATION_SECONDS} seconds`,
      path: ['duration_seconds'],
    }
  );

export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>;

// ─── Person Schema ──────────────────────────────────────────────────────────

/**
 * Validates involved person creation payload.
 * Requirement 13.1: full_name, involvement_type, organization mandatory; worker_id optional.
 */
export const personSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  involvement_type: z.nativeEnum(InvolvementType, {
    errorMap: () => ({ message: 'Invalid involvement type' }),
  }),
  organization: z.string().min(1, 'Organization is required'),
  worker_id: z.string().optional(),
});

export type PersonInput = z.infer<typeof personSchema>;

// ─── Regulatory Data Schema ─────────────────────────────────────────────────

/**
 * Validates regulatory data submission (OSHA/WorkSafeBC form data).
 * Supports draft saves (partial data) and complete submissions.
 */
export const regulatoryDataSchema = z.object({
  type: z.enum(['worksafebc_employer', 'osha_300', 'worksafebc_emergency']),
  data: z.union([
    // WorkSafeBC Employer Report
    z.object({
      employer_name: z.string().optional(),
      employer_address: z.string().optional(),
      employer_phone: z.string().optional(),
      worksafebc_account_number: z.string().optional(),
      worker_name: z.string().optional(),
      worker_address: z.string().optional(),
      worker_date_of_birth: z.string().optional(),
      worker_occupation: z.string().optional(),
      worker_hire_date: z.string().optional(),
      incident_description: z.string().max(5000).optional(),
      body_part_affected: z.string().optional(),
      nature_of_injury: z.string().optional(),
      days_shifts_lost: z.number().int().min(0).optional(),
      modified_work_proposal: z.string().optional(),
      worker_earnings_data: z.string().optional(),
      is_complete: z.boolean().default(false),
    }),
    // OSHA Recording Data
    z.object({
      case_identifier: z.string().optional(),
      worker_name: z.string().optional(),
      job_title: z.string().optional(),
      incident_date: z.string().optional(),
      location_within_site: z.string().optional(),
      injury_illness_description: z.string().max(5000).optional(),
      case_outcome: z.nativeEnum(OshaCaseOutcome).optional(),
      days_away_from_work: z.number().int().min(0).optional(),
      days_restricted_work: z.number().int().min(0).optional(),
      osha_recordability: z.nativeEnum(OshaRecordability).optional(),
      is_complete: z.boolean().default(false),
    }),
  ]),
});

export type RegulatoryDataInput = z.infer<typeof regulatoryDataSchema>;
