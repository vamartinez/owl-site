// Feature: ai-report-validation, Property 14: Estimated validation time by page count

/**
 * Property-based tests for estimated validation time calculation.
 *
 * Property 14: For any positive integer page count, `getEstimatedTimeSeconds(pageCount)`
 * SHALL return 30 for pages 1-5, 60 for pages 6-20, and 90 for pages 21 or more.
 *
 * **Validates: Requirements 10.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getEstimatedTimeSeconds } from '../../../src/services/report-validation/utils.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Validation Progress Property Tests', () => {
  // **Validates: Requirements 10.3**
  describe('Property 14: Estimated validation time by page count', () => {
    it('returns 30 seconds for any page count in [1, 5]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          (pageCount) => {
            expect(getEstimatedTimeSeconds(pageCount)).toBe(30);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns 60 seconds for any page count in [6, 20]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 6, max: 20 }),
          (pageCount) => {
            expect(getEstimatedTimeSeconds(pageCount)).toBe(60);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns 90 seconds for any page count >= 21', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 21, max: 10000 }),
          (pageCount) => {
            expect(getEstimatedTimeSeconds(pageCount)).toBe(90);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('maps any positive integer page count to exactly one of 30, 60, or 90 seconds', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10000 }),
          (pageCount) => {
            const time = getEstimatedTimeSeconds(pageCount);
            expect([30, 60, 90]).toContain(time);

            // Verify the classification matches the specification
            if (pageCount <= 5) {
              expect(time).toBe(30);
            } else if (pageCount <= 20) {
              expect(time).toBe(60);
            } else {
              expect(time).toBe(90);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
