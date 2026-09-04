// Feature: incident-timeline, Property 2: Validación de creación de vínculo

/**
 * Property-based tests for the createLinkSchema validation.
 *
 * Property 2: For any create link payload:
 * - If document_category is "otro" and custom_category_description has <5 or >100 chars, validation SHALL reject.
 * - If document_category is "otro" and custom_category_description is absent, validation SHALL reject.
 * - If context_note has more than 500 characters, validation SHALL reject.
 * - If document_category is not present, validation SHALL reject.
 * - For any valid combination (category present, valid description when "otro", note ≤ 500), validation SHALL accept.
 *
 * Validates: Requirements 1.5, 2.2, 2.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createLinkSchema } from '../../../src/services/incidents/linked-documents-validators.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = [
  'investigacion',
  'accion_correctiva',
  'inspeccion',
  'declaracion_testigo',
  'reporte_seguimiento',
  'otro',
] as const;

const NON_OTRO_CATEGORIES = VALID_CATEGORIES.filter((c) => c !== 'otro');

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for a valid UUID v4 */
const arbUuid = fc.uuid();

/** Arbitrary for a valid custom_category_description (5-100 chars) */
const arbValidDescription = fc.string({ minLength: 5, maxLength: 100 }).filter((s) => s.trim().length >= 5);

/** Arbitrary for a description that is too short (<5 chars) */
const arbTooShortDescription = fc.string({ minLength: 1, maxLength: 4 });

/** Arbitrary for a description that is too long (>100 chars) */
const arbTooLongDescription = fc.string({ minLength: 101, maxLength: 200 });

/** Arbitrary for a valid context_note (0-500 chars) */
const arbValidContextNote = fc.string({ minLength: 0, maxLength: 500 });

/** Arbitrary for a context_note that is too long (>500 chars) */
const arbTooLongContextNote = fc.string({ minLength: 501, maxLength: 700 });

/** Arbitrary for a valid non-"otro" category */
const arbNonOtroCategory = fc.constantFrom(...NON_OTRO_CATEGORIES);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Property 2: Create link validation', () => {
  // **Validates: Requirements 2.2**
  it('should reject when category is "otro" and custom_category_description is absent', () => {
    fc.assert(
      fc.property(arbUuid, arbUuid, (responseId, formId) => {
        const payload = {
          response_id: responseId,
          form_id: formId,
          document_category: 'otro',
          // custom_category_description intentionally absent
        };

        const result = createLinkSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.2**
  it('should reject when category is "otro" and custom_category_description is too short (<5 chars)', () => {
    fc.assert(
      fc.property(arbUuid, arbUuid, arbTooShortDescription, (responseId, formId, desc) => {
        const payload = {
          response_id: responseId,
          form_id: formId,
          document_category: 'otro',
          custom_category_description: desc,
        };

        const result = createLinkSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.2**
  it('should reject when category is "otro" and custom_category_description is too long (>100 chars)', () => {
    fc.assert(
      fc.property(arbUuid, arbUuid, arbTooLongDescription, (responseId, formId, desc) => {
        const payload = {
          response_id: responseId,
          form_id: formId,
          document_category: 'otro',
          custom_category_description: desc,
        };

        const result = createLinkSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 2.3**
  it('should reject when context_note exceeds 500 characters', () => {
    fc.assert(
      fc.property(
        arbUuid,
        arbUuid,
        arbNonOtroCategory,
        arbTooLongContextNote,
        (responseId, formId, category, note) => {
          const payload = {
            response_id: responseId,
            form_id: formId,
            document_category: category,
            context_note: note,
          };

          const result = createLinkSchema.safeParse(payload);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 1.5**
  it('should reject when document_category is not present', () => {
    fc.assert(
      fc.property(arbUuid, arbUuid, (responseId, formId) => {
        const payload = {
          response_id: responseId,
          form_id: formId,
          // document_category intentionally absent
        };

        const result = createLinkSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 1.5, 2.2, 2.3**
  it('should accept valid payloads with non-"otro" category and optional context_note', () => {
    fc.assert(
      fc.property(
        arbUuid,
        arbUuid,
        arbNonOtroCategory,
        arbValidContextNote,
        (responseId, formId, category, note) => {
          const payload = {
            response_id: responseId,
            form_id: formId,
            document_category: category,
            context_note: note || undefined,
          };

          const result = createLinkSchema.safeParse(payload);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 1.5, 2.2, 2.3**
  it('should accept valid payloads with "otro" category and valid custom description', () => {
    fc.assert(
      fc.property(
        arbUuid,
        arbUuid,
        arbValidDescription,
        arbValidContextNote,
        (responseId, formId, desc, note) => {
          const payload = {
            response_id: responseId,
            form_id: formId,
            document_category: 'otro',
            custom_category_description: desc,
            context_note: note || undefined,
          };

          const result = createLinkSchema.safeParse(payload);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
