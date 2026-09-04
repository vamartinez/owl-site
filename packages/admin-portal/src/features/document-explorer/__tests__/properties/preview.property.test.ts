// Feature: document-explorer, Property 5: Preview eligibility classification

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { isPreviewable } from '../../utils';

const PREVIEWABLE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

describe('Property 5: Preview eligibility classification', () => {
  // **Validates: Requirements 2.3, 2.4**

  it('isPreviewable returns true ONLY for application/pdf, image/jpeg, image/png', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (mimeType) => {
        const result = isPreviewable(mimeType);

        if (PREVIEWABLE_TYPES.includes(mimeType as (typeof PREVIEWABLE_TYPES)[number])) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('isPreviewable returns true for all known previewable types', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PREVIEWABLE_TYPES), (mimeType) => {
        expect(isPreviewable(mimeType)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('isPreviewable returns false for arbitrary non-previewable mime types', () => {
    const nonPreviewableMime = fc.string({ minLength: 1, maxLength: 80 }).filter(
      (s) => !PREVIEWABLE_TYPES.includes(s as (typeof PREVIEWABLE_TYPES)[number]),
    );

    fc.assert(
      fc.property(nonPreviewableMime, (mimeType) => {
        expect(isPreviewable(mimeType)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
