/**
 * Zod validation schemas for the Incident Linked Documents feature.
 * Validates payloads for linking/unlinking documents, searching responses,
 * and filtering linked documents in the timeline.
 *
 * Requirements: 1.5, 2.2, 2.3, 5.1, 6.1, 6.2, 6.4
 */

import { z } from 'zod';

// ─── Document Category Schema ───────────────────────────────────────────────

/**
 * Valid document categories for linked documents.
 * Requirement 2.1: Six supported categories.
 */
export const documentCategorySchema = z.enum([
  'investigacion',
  'accion_correctiva',
  'inspeccion',
  'declaracion_testigo',
  'reporte_seguimiento',
  'otro',
]);

export type DocumentCategory = z.infer<typeof documentCategorySchema>;

// ─── Create Link Schema ─────────────────────────────────────────────────────

/**
 * Validates the payload for creating a link between an incident and a form response.
 * Requirements 1.5, 2.2, 2.3:
 * - Category is mandatory
 * - custom_category_description required when category is "otro" (min 5, max 100 chars)
 * - Optional context_note (max 500 chars)
 */
export const createLinkSchema = z.object({
  response_id: z.string().uuid(),
  form_id: z.string().uuid(),
  document_category: documentCategorySchema,
  custom_category_description: z.string().min(5).max(100).optional(),
  context_note: z.string().max(500).optional(),
}).refine(
  (data) => {
    if (data.document_category === 'otro') {
      return !!data.custom_category_description;
    }
    return true;
  },
  { message: 'custom_category_description is required when category is "otro"', path: ['custom_category_description'] }
);

export type CreateLinkInput = z.infer<typeof createLinkSchema>;

// ─── Unlink Schema ──────────────────────────────────────────────────────────

/**
 * Validates the payload for unlinking a document from an incident.
 * Requirement 5.1: Justification minimum 10 characters.
 */
export const unlinkSchema = z.object({
  justification: z.string().min(10, 'Justification must be at least 10 characters'),
});

export type UnlinkInput = z.infer<typeof unlinkSchema>;

// ─── Search Responses Schema ────────────────────────────────────────────────

/**
 * Validates query parameters for searching linkable form responses.
 * Requirements 6.1, 6.2, 6.4: Search term, date range, pagination (max 20 per page).
 */
export const searchResponsesSchema = z.object({
  search: z.string().max(200).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(20).default(20),
});

export type SearchResponsesInput = z.infer<typeof searchResponsesSchema>;

// ─── Filter Linked Documents Schema ─────────────────────────────────────────

/**
 * Validates query parameters for filtering linked documents by category.
 * Requirement 4.1, 4.2: Comma-separated list of categories.
 */
export const filterLinkedDocsSchema = z.object({
  categories: z.string().optional(), // comma-separated categories
});

export type FilterLinkedDocsInput = z.infer<typeof filterLinkedDocsSchema>;
