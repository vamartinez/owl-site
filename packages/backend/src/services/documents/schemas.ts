/**
 * Zod validation schemas for the Document Explorer service.
 * Validates request parameters for folder navigation, search, download, preferences, and audit.
 */

import { z } from 'zod';

// ─── Shared Enums ─────────────────────────────────────────────────────────────

export const documentCategorySchema = z.enum([
  'reports',
  'forms',
  'certifications',
  'incidents',
  'safety_evidence',
]);

export const organizationModeSchema = z.enum([
  'category_site_year_month',
  'category_year_month_site',
]);

export const auditEventTypeSchema = z.enum(['download_single', 'download_batch']);

// ─── Folder Request ───────────────────────────────────────────────────────────

export const folderRequestSchema = z.object({
  path: z.string().optional().default(''),
  org_mode: organizationModeSchema.optional().default('category_site_year_month'),
  page: z.coerce.number().int().min(1).optional().default(1),
  page_size: z.coerce.number().int().min(1).max(100).optional().default(50),
});

// ─── Search Request ───────────────────────────────────────────────────────────

export const searchRequestSchema = z.object({
  q: z.string().trim().min(2, 'Search query must be at least 2 characters'),
  category: documentCategorySchema.optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date_from must be ISO date')
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date_to must be ISO date')
    .optional(),
  site_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  page_size: z.coerce.number().int().min(1).max(100).optional().default(50),
});

// ─── Download Request ─────────────────────────────────────────────────────────

export const downloadRequestSchema = z.object({
  documentIds: z
    .array(z.string().uuid())
    .min(1, 'At least one document ID is required')
    .max(50, 'Maximum 50 documents per download'),
});

// ─── Preferences Request ──────────────────────────────────────────────────────

export const setPreferencesSchema = z.object({
  mode: organizationModeSchema,
});

// ─── Audit Log Request ────────────────────────────────────────────────────────

export const auditLogRequestSchema = z.object({
  eventType: auditEventTypeSchema,
  documentIds: z
    .array(z.string().uuid())
    .min(1, 'At least one document ID is required'),
  userId: z.string().min(1),
});
