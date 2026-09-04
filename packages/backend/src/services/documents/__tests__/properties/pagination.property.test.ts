// Property 4: Pagination slice correctness
// **Validates: Requirements 3.6, 4.5**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { paginate } from '../../pagination';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Arbitrary for a non-empty array of items (numbers for simplicity).
 */
const itemsArb = fc.array(fc.integer(), { minLength: 0, maxLength: 500 });

/**
 * Arbitrary for valid pageSize (1–100 as per schema constraints).
 */
const pageSizeArb = fc.integer({ min: 1, max: 100 });

/**
 * Arbitrary for page number — we test with a wide range including out-of-bounds values.
 */
const pageArb = fc.integer({ min: -10, max: 200 });

// ─── Property 4: Pagination slice correctness ────────────────────────────────

describe('Property 4: Pagination slice correctness', () => {
  // **Validates: Requirements 3.6, 4.5**

  it('totalPages is ceil(N / pageSize) for any items and pageSize', () => {
    fc.assert(
      fc.property(itemsArb, pageSizeArb, (items, pageSize) => {
        const result = paginate(items, 1, pageSize);
        const expectedTotalPages = Math.ceil(items.length / pageSize);
        expect(result.totalPages).toBe(expectedTotalPages);
      }),
      { numRuns: 200 },
    );
  });

  it('page is clamped to valid range [1, totalPages]', () => {
    fc.assert(
      fc.property(itemsArb, pageArb, pageSizeArb, (items, page, pageSize) => {
        const result = paginate(items, page, pageSize);
        const totalPages = Math.ceil(items.length / pageSize);

        if (totalPages === 0) {
          // Empty items: page should be 1
          expect(result.page).toBe(1);
        } else {
          expect(result.page).toBeGreaterThanOrEqual(1);
          expect(result.page).toBeLessThanOrEqual(totalPages);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('returned data length is min(pageSize, remaining items) for valid pages', () => {
    fc.assert(
      fc.property(itemsArb, pageSizeArb, (items, pageSize) => {
        const totalPages = Math.ceil(items.length / pageSize) || 1;

        // Test each valid page
        for (let p = 1; p <= totalPages; p++) {
          const result = paginate(items, p, pageSize);
          const start = (p - 1) * pageSize;
          const remaining = items.length - start;
          const expectedLength = Math.min(pageSize, Math.max(0, remaining));
          expect(result.data.length).toBe(expectedLength);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('paginate returns the correct slice of items for any valid inputs', () => {
    fc.assert(
      fc.property(itemsArb, pageSizeArb, (items, pageSize) => {
        const totalPages = Math.ceil(items.length / pageSize) || 1;

        for (let p = 1; p <= totalPages; p++) {
          const result = paginate(items, p, pageSize);
          const start = (p - 1) * pageSize;
          const expectedSlice = items.slice(start, start + pageSize);
          expect(result.data).toEqual(expectedSlice);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('total always equals items.length regardless of page or pageSize', () => {
    fc.assert(
      fc.property(itemsArb, pageArb, pageSizeArb, (items, page, pageSize) => {
        const result = paginate(items, page, pageSize);
        expect(result.total).toBe(items.length);
      }),
      { numRuns: 200 },
    );
  });

  it('pageSize in result always equals the input pageSize', () => {
    fc.assert(
      fc.property(itemsArb, pageArb, pageSizeArb, (items, page, pageSize) => {
        const result = paginate(items, page, pageSize);
        expect(result.pageSize).toBe(pageSize);
      }),
      { numRuns: 200 },
    );
  });
});
