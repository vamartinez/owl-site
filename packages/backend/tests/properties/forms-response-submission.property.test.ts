// Feature: contractor-forms-qr, Property 19: Folio de respuesta alfanumérico de 8 caracteres

/**
 * Property-based tests for response submission folio generation.
 *
 * Property 19: For any generated folio, it must be exactly 8 characters long
 * and contain only uppercase alphanumeric characters (A-Z, 0-9).
 *
 * Validates: Requirements 11.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateFolio } from '../../src/services/forms/form-response.js';
import { FOLIO_LENGTH } from '../../src/services/forms/types.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Forms Response Submission Property Tests', () => {
  // **Validates: Requirements 11.3**
  describe('Property 19: Folio de respuesta alfanumérico de 8 caracteres', () => {
    it('generated folios are exactly 8 characters long', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 999 }), () => {
          const folio = generateFolio();
          expect(folio).toHaveLength(FOLIO_LENGTH);
          expect(folio).toHaveLength(8);
        }),
        { numRuns: 100 },
      );
    });

    it('generated folios contain only uppercase alphanumeric characters (A-Z, 0-9)', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 999 }), () => {
          const folio = generateFolio();
          expect(folio).toMatch(/^[A-Z0-9]{8}$/);
        }),
        { numRuns: 100 },
      );
    });
  });
});
