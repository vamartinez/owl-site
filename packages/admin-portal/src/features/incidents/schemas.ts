/**
 * Zod validation schemas for client-side form validation.
 * Mirrors backend validation for immediate user feedback.
 *
 * Requirements: 2.1, 3.1, 5.1, 12.1
 */

import { z } from 'zod';
import { IncidentType, OperationalSeverity, InvolvementType } from './types';
import { ALLOWED_EVIDENCE_TYPES, MAX_FILE_SIZE, MAX_VIDEO_DURATION_SECONDS } from './constants';

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

// ─── Incident Create Schema ─────────────────────────────────────────────────

/**
 * Validates the incident creation form.
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
    incident_datetime: z.string().min(1, 'Incident date/time is required'),
    site_id: z.string().min(1, 'Site is required'),
    worker_id: z.string().optional(),
    location: z.string().min(1, 'Location is required'),
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

// ─── Comment Schema ─────────────────────────────────────────────────────────

/**
 * Validates comment creation.
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

// ─── Closure Schema ─────────────────────────────────────────────────────────

/**
 * Validates incident closure form.
 * Requirement 19.1: Resolution notes minimum 20 characters after trimming.
 */
export const closureSchema = z.object({
  resolution_notes: z
    .string()
    .transform((val) => val.trim())
    .pipe(
      z.string().min(20, 'Resolution notes must be at least 20 characters')
    ),
});

// ─── Reopen Schema ──────────────────────────────────────────────────────────

/**
 * Validates incident reopening form.
 * Requirement 20.1: Justification minimum 20 characters after trimming.
 */
export const reopenSchema = z.object({
  justification: z
    .string()
    .transform((val) => val.trim())
    .pipe(
      z.string().min(20, 'Reopening justification must be at least 20 characters')
    ),
});

// ─── Attachment Schema ──────────────────────────────────────────────────────

/**
 * Validates attachment file metadata before upload.
 * Requirements 12.1, 12.2, 12.3: MIME type, size, and video duration validation.
 */
export const attachmentSchema = z
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
      const videoTypes: string[] = ['video/mp4', 'video/quicktime'];
      if (videoTypes.includes(data.mime_type)) {
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

// ─── Person Schema ──────────────────────────────────────────────────────────

/**
 * Validates involved person form.
 * Requirement 13.1: full_name, involvement_type, organization mandatory.
 */
export const personSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  involvement_type: z.nativeEnum(InvolvementType, {
    errorMap: () => ({ message: 'Invalid involvement type' }),
  }),
  organization: z.string().min(1, 'Organization is required'),
  worker_id: z.string().optional(),
});

// ─── Inferred Types ─────────────────────────────────────────────────────────

export type IncidentCreateFormData = z.infer<typeof incidentCreateSchema>;
export type CommentFormData = z.infer<typeof commentSchema>;
export type ClosureFormData = z.infer<typeof closureSchema>;
export type ReopenFormData = z.infer<typeof reopenSchema>;
export type AttachmentFormData = z.infer<typeof attachmentSchema>;
export type PersonFormData = z.infer<typeof personSchema>;
