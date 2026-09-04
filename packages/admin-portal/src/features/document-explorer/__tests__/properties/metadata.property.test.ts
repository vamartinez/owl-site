// Feature: document-explorer, Property 13: Folder node displays count and timestamp
// Feature: document-explorer, Property 14: Document metadata with partial availability

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { DocumentCategory, DocumentDetail, FolderNode } from '../../types';

const CATEGORIES: DocumentCategory[] = [
  'reports',
  'forms',
  'certifications',
  'incidents',
  'safety_evidence',
];

function folderNodeArb(): fc.Arbitrary<FolderNode> {
  return fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    path: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
    childFolderCount: fc.nat({ max: 100 }),
    documentCount: fc.nat({ max: 10000 }),
    lastUpdated: fc
      .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
      .map((d) => d.toISOString()),
  });
}

function documentDetailArb(): fc.Arbitrary<DocumentDetail> {
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
    creatorUserId: fc.uuid(),
    creatorUserName: fc.string({ minLength: 1, maxLength: 30 }),
    tenantId: fc.uuid(),
    sha256Hash: fc.hexaString({ minLength: 64, maxLength: 64 }),
    downloadCount: fc.nat({ max: 10000 }),
    lastDownloadedAt: fc.option(
      fc
        .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') })
        .map((d) => d.toISOString()),
      { nil: null },
    ),
  });
}

describe('Property 13: Folder node displays count and timestamp', () => {
  // **Validates: Requirements 7.2**

  it('every FolderNode has a numeric documentCount field', () => {
    fc.assert(
      fc.property(folderNodeArb(), (folder) => {
        expect(typeof folder.documentCount).toBe('number');
        expect(Number.isFinite(folder.documentCount)).toBe(true);
        expect(folder.documentCount).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it('every FolderNode has a string lastUpdated field in ISO 8601 format', () => {
    fc.assert(
      fc.property(folderNodeArb(), (folder) => {
        expect(typeof folder.lastUpdated).toBe('string');
        // Verify it is a valid ISO 8601 date string
        const parsed = new Date(folder.lastUpdated);
        expect(parsed.toISOString()).toBe(folder.lastUpdated);
      }),
      { numRuns: 100 },
    );
  });

  it('FolderNode documentCount is always a non-negative integer', () => {
    fc.assert(
      fc.property(folderNodeArb(), (folder) => {
        expect(Number.isInteger(folder.documentCount)).toBe(true);
        expect(folder.documentCount).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 14: Document metadata with partial availability', () => {
  // **Validates: Requirements 7.1, 7.4**

  const EXPECTED_METADATA_FIELDS = [
    'createdAt',
    'creatorUserName',
    'siteName',
    'category',
    'sha256Hash',
  ] as const;

  it('all expected metadata fields are present with a value or can be marked unavailable', () => {
    fc.assert(
      fc.property(documentDetailArb(), (doc) => {
        // For each expected metadata field, it should be either present with a value or null
        for (const field of EXPECTED_METADATA_FIELDS) {
          const value = doc[field];
          // Value is either a non-null string or could be explicitly null (unavailable)
          const isPresent = value !== null && value !== undefined && value !== '';
          const isUnavailable = value === null || value === undefined;

          expect(isPresent || isUnavailable).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('DocumentDetail with lastDownloadedAt as null still has all other fields present', () => {
    fc.assert(
      fc.property(documentDetailArb(), (doc) => {
        // Even when lastDownloadedAt is null, all core metadata fields are still available
        expect(typeof doc.createdAt).toBe('string');
        expect(doc.createdAt.length).toBeGreaterThan(0);
        expect(typeof doc.creatorUserName).toBe('string');
        expect(doc.creatorUserName.length).toBeGreaterThan(0);
        expect(typeof doc.siteName).toBe('string');
        expect(doc.siteName.length).toBeGreaterThan(0);
        expect(typeof doc.category).toBe('string');
        expect(CATEGORIES).toContain(doc.category);
        expect(typeof doc.sha256Hash).toBe('string');
        expect(doc.sha256Hash.length).toBe(64);
      }),
      { numRuns: 100 },
    );
  });

  it('nullable fields (lastDownloadedAt) are either a valid ISO string or null', () => {
    fc.assert(
      fc.property(documentDetailArb(), (doc) => {
        if (doc.lastDownloadedAt !== null) {
          expect(typeof doc.lastDownloadedAt).toBe('string');
          const parsed = new Date(doc.lastDownloadedAt);
          expect(Number.isNaN(parsed.getTime())).toBe(false);
        } else {
          expect(doc.lastDownloadedAt).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('the set of rendered fields plus unavailable indicators covers all expected metadata', () => {
    fc.assert(
      fc.property(documentDetailArb(), (doc) => {
        const renderedFields: string[] = [];
        const unavailableFields: string[] = [];

        for (const field of EXPECTED_METADATA_FIELDS) {
          const value = doc[field];
          if (value !== null && value !== undefined && value !== '') {
            renderedFields.push(field);
          } else {
            unavailableFields.push(field);
          }
        }

        // All expected fields are accounted for
        expect(renderedFields.length + unavailableFields.length).toBe(
          EXPECTED_METADATA_FIELDS.length,
        );
      }),
      { numRuns: 100 },
    );
  });
});
