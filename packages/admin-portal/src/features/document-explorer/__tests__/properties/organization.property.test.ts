// Feature: document-explorer, Property 12: Organization mode path computation

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeOrganizationPath } from '../../utils';
import type { DocumentCategory } from '../../types';

const CATEGORIES: DocumentCategory[] = [
  'reports',
  'forms',
  'certifications',
  'incidents',
  'safety_evidence',
];

function documentForOrgArb() {
  return fc.record({
    category: fc.constantFrom(...CATEGORIES),
    siteName: fc.string({ minLength: 1, maxLength: 30 }),
    createdAt: fc
      .date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') })
      .map((d) => d.toISOString()),
  });
}

describe('Property 12: Organization mode path computation', () => {
  // **Validates: Requirements 6.6, 6.7**

  it('produces [category, siteName, year, month] for category_site_year_month mode', () => {
    fc.assert(
      fc.property(documentForOrgArb(), (doc) => {
        const result = computeOrganizationPath(doc, 'category_site_year_month');

        const date = new Date(doc.createdAt);
        const expectedYear = date.getUTCFullYear().toString();
        const expectedMonth = String(date.getUTCMonth() + 1).padStart(2, '0');

        expect(result).toHaveLength(4);
        expect(result[0]).toBe(doc.category);
        expect(result[1]).toBe(doc.siteName);
        expect(result[2]).toBe(expectedYear);
        expect(result[3]).toBe(expectedMonth);
      }),
      { numRuns: 100 },
    );
  });

  it('produces [category, year, month, siteName] for category_year_month_site mode', () => {
    fc.assert(
      fc.property(documentForOrgArb(), (doc) => {
        const result = computeOrganizationPath(doc, 'category_year_month_site');

        const date = new Date(doc.createdAt);
        const expectedYear = date.getUTCFullYear().toString();
        const expectedMonth = String(date.getUTCMonth() + 1).padStart(2, '0');

        expect(result).toHaveLength(4);
        expect(result[0]).toBe(doc.category);
        expect(result[1]).toBe(expectedYear);
        expect(result[2]).toBe(expectedMonth);
        expect(result[3]).toBe(doc.siteName);
      }),
      { numRuns: 100 },
    );
  });

  it('always produces a path of exactly 4 segments for either mode', () => {
    fc.assert(
      fc.property(
        documentForOrgArb(),
        fc.constantFrom('category_site_year_month' as const, 'category_year_month_site' as const),
        (doc, mode) => {
          const result = computeOrganizationPath(doc, mode);
          expect(result).toHaveLength(4);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('produces month as zero-padded two-digit string (01-12)', () => {
    fc.assert(
      fc.property(
        documentForOrgArb(),
        fc.constantFrom('category_site_year_month' as const, 'category_year_month_site' as const),
        (doc, mode) => {
          const result = computeOrganizationPath(doc, mode);

          // Month is at index 3 for category_site_year_month, index 2 for category_year_month_site
          const monthIndex = mode === 'category_site_year_month' ? 3 : 2;
          const month = result[monthIndex];

          expect(month).toMatch(/^(0[1-9]|1[0-2])$/);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the first segment is always the document category for both modes', () => {
    fc.assert(
      fc.property(
        documentForOrgArb(),
        fc.constantFrom('category_site_year_month' as const, 'category_year_month_site' as const),
        (doc, mode) => {
          const result = computeOrganizationPath(doc, mode);
          expect(result[0]).toBe(doc.category);
        },
      ),
      { numRuns: 100 },
    );
  });
});
