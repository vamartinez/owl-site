// Feature: document-explorer, Property 10: Conjunctive filter intersection

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { applyFilters } from '../../utils';
import type { DocumentCategory, DocumentFilters, DocumentSummary } from '../../types';

const CATEGORIES: DocumentCategory[] = [
  'reports',
  'forms',
  'certifications',
  'incidents',
  'safety_evidence',
];

function documentSummaryArb(): fc.Arbitrary<DocumentSummary> {
  return fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    category: fc.constantFrom(...CATEGORIES),
    mimeType: fc.constantFrom('application/pdf', 'image/jpeg', 'image/png', 'text/plain'),
    fileSize: fc.nat({ max: 100_000_000 }),
    createdAt: fc
      .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
      .map((d) => d.toISOString()),
    siteName: fc.string({ minLength: 1, maxLength: 30 }),
    siteId: fc.uuid(),
    folderPath: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 4 }),
  });
}

function filtersArb(): fc.Arbitrary<DocumentFilters> {
  return fc.record({
    category: fc.option(fc.constantFrom(...CATEGORIES), { nil: null }),
    dateFrom: fc.option(
      fc
        .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
        .map((d) => d.toISOString()),
      { nil: null },
    ),
    dateTo: fc.option(
      fc
        .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
        .map((d) => d.toISOString()),
      { nil: null },
    ),
    siteId: fc.option(fc.uuid(), { nil: null }),
  });
}

describe('Property 10: Conjunctive filter intersection', () => {
  // **Validates: Requirements 4.4**

  it('returns only documents satisfying ALL active filter criteria', () => {
    fc.assert(
      fc.property(
        fc.array(documentSummaryArb(), { minLength: 0, maxLength: 20 }),
        filtersArb(),
        (documents, filters) => {
          const result = applyFilters(documents, filters);

          // Every document in the result must satisfy all active filters
          for (const doc of result) {
            if (filters.category !== null) {
              expect(doc.category).toBe(filters.category);
            }
            if (filters.dateFrom !== null) {
              expect(doc.createdAt >= filters.dateFrom).toBe(true);
            }
            if (filters.dateTo !== null) {
              expect(doc.createdAt <= filters.dateTo).toBe(true);
            }
            if (filters.siteId !== null) {
              expect(doc.siteId).toBe(filters.siteId);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('does not exclude documents that satisfy all active criteria', () => {
    fc.assert(
      fc.property(
        fc.array(documentSummaryArb(), { minLength: 0, maxLength: 20 }),
        filtersArb(),
        (documents, filters) => {
          const result = applyFilters(documents, filters);

          // Every document NOT in the result must fail at least one active criterion
          const resultIds = new Set(result.map((d) => d.id));
          for (const doc of documents) {
            if (!resultIds.has(doc.id)) {
              const failsCategory = filters.category !== null && doc.category !== filters.category;
              const failsDateFrom = filters.dateFrom !== null && doc.createdAt < filters.dateFrom;
              const failsDateTo = filters.dateTo !== null && doc.createdAt > filters.dateTo;
              const failsSiteId = filters.siteId !== null && doc.siteId !== filters.siteId;

              expect(failsCategory || failsDateFrom || failsDateTo || failsSiteId).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns all documents when all filters are null', () => {
    fc.assert(
      fc.property(
        fc.array(documentSummaryArb(), { minLength: 0, maxLength: 20 }),
        (documents) => {
          const noFilters: DocumentFilters = {
            category: null,
            dateFrom: null,
            dateTo: null,
            siteId: null,
          };

          const result = applyFilters(documents, noFilters);
          expect(result.length).toBe(documents.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
