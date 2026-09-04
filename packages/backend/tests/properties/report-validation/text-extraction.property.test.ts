// Feature: ai-report-validation, Property 5: Minimum text extraction threshold
// Feature: ai-report-validation, Property 8: Score color classification

/**
 * Property-based tests for text extraction threshold and score color classification.
 *
 * Property 5: For any string, the text sufficiency check SHALL return true if and only if
 * the string contains 50 or more characters. Strings with fewer than 50 characters SHALL
 * be flagged as insufficient.
 *
 * Property 8: For any integer score in [0, 100], `getScoreColor(score)` SHALL return
 * "green" if score ≥ 80, "yellow" if 50 ≤ score < 80, and "red" if score < 50.
 *
 * **Validates: Requirements 3.7, 5.1, 9.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isTextSufficient, getScoreColor } from '../../../src/services/report-validation/utils.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Text Extraction Property Tests', () => {
  // **Validates: Requirements 3.7, 9.3**
  describe('Property 5: Minimum text extraction threshold', () => {
    it('returns true for any string with 50 or more characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 50, maxLength: 5000 }),
          (text) => {
            expect(isTextSufficient(text)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns false for any string with fewer than 50 characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 49 }),
          (text) => {
            // Only test strings that are actually < 50 chars
            fc.pre(text.length < 50);
            expect(isTextSufficient(text)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('the threshold boundary is exactly 50 characters', () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 200 }),
          (length) => {
            const text = 'a'.repeat(length);
            if (length >= 50) {
              expect(isTextSufficient(text)).toBe(true);
            } else {
              expect(isTextSufficient(text)).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 5.1**
  describe('Property 8: Score color classification', () => {
    it('returns "green" for any score >= 80', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 80, max: 100 }),
          (score) => {
            expect(getScoreColor(score)).toBe('green');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns "yellow" for any score in [50, 79]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 50, max: 79 }),
          (score) => {
            expect(getScoreColor(score)).toBe('yellow');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns "red" for any score < 50', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 49 }),
          (score) => {
            expect(getScoreColor(score)).toBe('red');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('classifies any integer score in [0, 100] into exactly one of green/yellow/red', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          (score) => {
            const color = getScoreColor(score);
            expect(['green', 'yellow', 'red']).toContain(color);

            // Verify the classification matches the specification
            if (score >= 80) {
              expect(color).toBe('green');
            } else if (score >= 50) {
              expect(color).toBe('yellow');
            } else {
              expect(color).toBe('red');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
