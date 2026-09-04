// Feature: incident-timeline, Property 9: Justificación mínima para desvinculación

/**
 * Property-based tests for the unlinkSchema validation.
 *
 * Property 9: For any justification string with less than 10 characters,
 * the unlink operation SHALL be rejected. For any string with 10+ characters,
 * the validation SHALL pass.
 *
 * Validates: Requirements 5.1
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { unlinkSchema } from '../../../src/services/incidents/linked-documents-validators.js';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for justification strings that are too short (0-9 chars) */
const arbTooShortJustification = fc.string({ minLength: 0, maxLength: 9 });

/** Arbitrary for valid justification strings (10+ chars) */
const arbValidJustification = fc.string({ minLength: 10, maxLength: 500 });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Property 9: Unlink justification minimum length', () => {
  // **Validates: Requirements 5.1**
  it('should reject any justification with less than 10 characters', () => {
    fc.assert(
      fc.property(arbTooShortJustification, (justification) => {
        const payload = { justification };
        const result = unlinkSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 5.1**
  it('should accept any justification with 10 or more characters', () => {
    fc.assert(
      fc.property(arbValidJustification, (justification) => {
        const payload = { justification };
        const result = unlinkSchema.safeParse(payload);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
