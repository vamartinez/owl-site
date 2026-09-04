// Feature: document-explorer-backend, Properties 5, 7, 8: Search and preview property tests

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { UnifiedDocument, DocumentCategory } from '../../types';

// ─── Pure logic extracted from search-handler.ts ─────────────────────────────

/**
 * Case-insensitive partial name matching — same logic as in search-handler.ts.
 */
function matchesSearchQuery(documentName: string, query: string): boolean {
  return documentName.toLowerCase().includes(query.toLowerCase());
}

/**
 * Conjunctive filter application — same logic as in search-handler.ts.
 * All active filters must be satisfied simultaneously.
 */
function applyFilters(
  documents: UnifiedDocument[],
  filters: {
    category?: DocumentCategory;
    date_from?: string;
    date_to?: string;
    site_id?: string;
  },
): UnifiedDocument[] {
  let filtered = documents;

  if (filters.category) {
    filtered = filtered.filter((doc) => doc.category === filters.category);
  }

  if (filters.date_from) {
    const fromDate = new Date(filters.date_from);
    filtered = filtered.filter((doc) => new Date(doc.createdAt) >= fromDate);
  }

  if (filters.date_to) {
    const toDate = new Date(filters.date_to + 'T23:59:59.999Z');
    filtered = filtered.filter((doc) => new Date(doc.createdAt) <= toDate);
  }

  if (filters.site_id) {
    filtered = filtered.filter((doc) => doc.siteId === filters.site_id);
  }

  return filtered;
}

// ─── Pure logic extracted from preview-handler.ts ────────────────────────────

const PREVIEWABLE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

function isPreviewEligible(mimeType: string): boolean {
  return PREVIEWABLE_MIME_TYPES.has(mimeType);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const CATEGORIES: DocumentCategory[] = [
  'reports',
  'forms',
  'certifications',
  'incidents',
  'safety_evidence',
];

const documentArb: fc.Arbitrary<UnifiedDocument> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  category: fc.constantFrom(...CATEGORIES),
  mimeType: fc.constantFrom(
    'application/pdf',
    'image/jpeg',
    'image/png',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'video/mp4',
    'application/octet-stream',
  ),
  fileSize: fc.integer({ min: 1, max: 100_000_000 }),
  createdAt: fc
    .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
    .map((d) => d.toISOString()),
  siteName: fc.string({ minLength: 1, maxLength: 50 }),
  siteId: fc.uuid(),
  tenantId: fc.uuid(),
  s3Key: fc.string({ minLength: 5, maxLength: 100 }),
  sha256Hash: fc.option(fc.hexaString({ minLength: 64, maxLength: 64 }), { nil: null }),
  folderPath: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 4 }),
});

// ─── Property 5: Case-insensitive partial name matching ──────────────────────

describe('Property 5: Case-insensitive partial name matching', () => {
  // **Validates: Requirements 4.1**

  it('any contiguous substring of a document name matches regardless of case', () => {
    // Generate a document name and extract a random contiguous substring with random casing
    const nameAndSubstringArb = fc
      .string({ minLength: 2, maxLength: 100 })
      .chain((name) =>
        fc
          .tuple(
            fc.integer({ min: 0, max: Math.max(0, name.length - 1) }),
            fc.integer({ min: 1, max: name.length }),
          )
          .map(([start, len]) => {
            const end = Math.min(start + len, name.length);
            const substring = name.slice(start, end);
            return { name, substring };
          }),
      );

    fc.assert(
      fc.property(nameAndSubstringArb, ({ name, substring }) => {
        // The substring (in any case) should match the document name
        expect(matchesSearchQuery(name, substring)).toBe(true);
        expect(matchesSearchQuery(name, substring.toUpperCase())).toBe(true);
        expect(matchesSearchQuery(name, substring.toLowerCase())).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('strings that are not substrings of the document name do not match', () => {
    const nameAndNonSubstringArb = fc
      .tuple(
        fc.string({ minLength: 2, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
      )
      .filter(([name, query]) => !name.toLowerCase().includes(query.toLowerCase()));

    fc.assert(
      fc.property(nameAndNonSubstringArb, ([name, query]) => {
        expect(matchesSearchQuery(name, query)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('matching is case-insensitive: upper/lower/mixed case of same content yields same result', () => {
    const nameAndQueryArb = fc.tuple(
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 20 }),
    );

    fc.assert(
      fc.property(nameAndQueryArb, ([name, query]) => {
        const resultLower = matchesSearchQuery(name, query.toLowerCase());
        const resultUpper = matchesSearchQuery(name, query.toUpperCase());
        const resultOriginal = matchesSearchQuery(name, query);

        // All casing variants produce the same match result
        expect(resultLower).toBe(resultUpper);
        expect(resultLower).toBe(resultOriginal);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 7: Conjunctive filter application ──────────────────────────────

describe('Property 7: Conjunctive filter application', () => {
  // **Validates: Requirements 4.4**

  it('filtered results satisfy ALL active filter criteria simultaneously', () => {
    const documentsArb = fc.array(documentArb, { minLength: 1, maxLength: 20 });

    const filtersArb = fc.record({
      category: fc.option(fc.constantFrom(...CATEGORIES), { nil: undefined }),
      date_from: fc.option(
        fc
          .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
          .map((d) => d.toISOString().slice(0, 10)),
        { nil: undefined },
      ),
      date_to: fc.option(
        fc
          .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
          .map((d) => d.toISOString().slice(0, 10)),
        { nil: undefined },
      ),
      site_id: fc.option(fc.uuid(), { nil: undefined }),
    });

    fc.assert(
      fc.property(documentsArb, filtersArb, (documents, filters) => {
        const results = applyFilters(documents, filters);

        // Every document in results must satisfy ALL active filters
        for (const doc of results) {
          if (filters.category !== undefined) {
            expect(doc.category).toBe(filters.category);
          }
          if (filters.date_from !== undefined) {
            expect(new Date(doc.createdAt).getTime()).toBeGreaterThanOrEqual(
              new Date(filters.date_from).getTime(),
            );
          }
          if (filters.date_to !== undefined) {
            expect(new Date(doc.createdAt).getTime()).toBeLessThanOrEqual(
              new Date(filters.date_to + 'T23:59:59.999Z').getTime(),
            );
          }
          if (filters.site_id !== undefined) {
            expect(doc.siteId).toBe(filters.site_id);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('documents excluded from results fail at least one active filter', () => {
    const documentsArb = fc.array(documentArb, { minLength: 1, maxLength: 20 });

    const filtersArb = fc.record({
      category: fc.option(fc.constantFrom(...CATEGORIES), { nil: undefined }),
      date_from: fc.option(
        fc
          .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
          .map((d) => d.toISOString().slice(0, 10)),
        { nil: undefined },
      ),
      date_to: fc.option(
        fc
          .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
          .map((d) => d.toISOString().slice(0, 10)),
        { nil: undefined },
      ),
      site_id: fc.option(fc.uuid(), { nil: undefined }),
    });

    fc.assert(
      fc.property(documentsArb, filtersArb, (documents, filters) => {
        const results = applyFilters(documents, filters);
        const resultIds = new Set(results.map((d) => d.id));

        // Every excluded document must fail at least one filter
        const excluded = documents.filter((d) => !resultIds.has(d.id));
        for (const doc of excluded) {
          const failsCategory =
            filters.category !== undefined && doc.category !== filters.category;
          const failsDateFrom =
            filters.date_from !== undefined &&
            new Date(doc.createdAt) < new Date(filters.date_from);
          const failsDateTo =
            filters.date_to !== undefined &&
            new Date(doc.createdAt) > new Date(filters.date_to + 'T23:59:59.999Z');
          const failsSiteId =
            filters.site_id !== undefined && doc.siteId !== filters.site_id;

          expect(failsCategory || failsDateFrom || failsDateTo || failsSiteId).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('with no active filters, all documents are returned', () => {
    const documentsArb = fc.array(documentArb, { minLength: 0, maxLength: 20 });

    fc.assert(
      fc.property(documentsArb, (documents) => {
        const results = applyFilters(documents, {});
        expect(results.length).toBe(documents.length);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8: Preview eligibility by MIME type ────────────────────────────

describe('Property 8: Preview eligibility by MIME type', () => {
  // **Validates: Requirements 6.3**

  it('PDF, JPEG, and PNG MIME types are eligible for preview', () => {
    const previewableMimeArb = fc.constantFrom(
      'application/pdf',
      'image/jpeg',
      'image/png',
    );

    fc.assert(
      fc.property(previewableMimeArb, (mimeType) => {
        expect(isPreviewEligible(mimeType)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('non-PDF/JPEG/PNG MIME types are NOT eligible for preview', () => {
    const nonPreviewableMimeArb = fc
      .string({ minLength: 1, maxLength: 100 })
      .filter(
        (s) =>
          s !== 'application/pdf' &&
          s !== 'image/jpeg' &&
          s !== 'image/png',
      );

    fc.assert(
      fc.property(nonPreviewableMimeArb, (mimeType) => {
        expect(isPreviewEligible(mimeType)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('preview eligibility is determined solely by MIME type — other document fields do not affect it', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const eligible = isPreviewEligible(doc.mimeType);
        const expectedEligible =
          doc.mimeType === 'application/pdf' ||
          doc.mimeType === 'image/jpeg' ||
          doc.mimeType === 'image/png';

        expect(eligible).toBe(expectedEligible);
      }),
      { numRuns: 100 },
    );
  });
});
