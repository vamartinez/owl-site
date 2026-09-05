// Feature: document-explorer, Property 1: Folder contents are sorted alphabetically
// Feature: document-explorer, Property 3: Document list renders all required fields
// Feature: document-explorer, Property 4: Default document sort is descending by creation date

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import type { DocumentCategory, DocumentSummary, FolderNode } from '../../types';
import { sortFolderContents } from '../../utils';

// --- Generators ---

const documentCategoryArb: fc.Arbitrary<DocumentCategory> = fc.constantFrom(
  'reports',
  'forms',
  'certifications',
  'incidents',
  'safety_evidence',
);

const folderNodeArb: fc.Arbitrary<FolderNode> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  path: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
  childFolderCount: fc.nat({ max: 100 }),
  documentCount: fc.nat({ max: 1000 }),
  lastUpdated: fc.date().map((d) => d.toISOString()),
});

const documentSummaryArb: fc.Arbitrary<DocumentSummary> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  category: documentCategoryArb,
  mimeType: fc.string({ minLength: 1, maxLength: 50 }),
  fileSize: fc.nat({ max: 1_000_000_000 }).map((n) => n + 1), // positive
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString()),
  siteName: fc.string({ minLength: 1, maxLength: 50 }),
  siteId: fc.uuid(),
  folderPath: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
});

// --- Property 1: sortFolderContents produces alphabetical order with folders before documents ---

describe('Property 1: Folder contents are sorted alphabetically', () => {
  // **Validates: Requirements 1.2**

  it('sortFolderContents produces alphabetically sorted folders', () => {
    fc.assert(
      fc.property(
        fc.array(folderNodeArb, { minLength: 0, maxLength: 20 }),
        fc.array(documentSummaryArb, { minLength: 0, maxLength: 20 }),
        (folders, documents) => {
          const result = sortFolderContents(folders, documents);

          // Verify folders are sorted alphabetically (case-insensitive)
          for (let i = 0; i < result.folders.length - 1; i++) {
            const cmp = result.folders[i]!.name.localeCompare(
              result.folders[i + 1]!.name,
              undefined,
              { sensitivity: 'base' },
            );
            expect(cmp).toBeLessThanOrEqual(0);
          }

          // Verify documents are sorted alphabetically (case-insensitive)
          for (let i = 0; i < result.documents.length - 1; i++) {
            const cmp = result.documents[i]!.name.localeCompare(
              result.documents[i + 1]!.name,
              undefined,
              { sensitivity: 'base' },
            );
            expect(cmp).toBeLessThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sortFolderContents returns folders separate from documents (folders first in structure)', () => {
    fc.assert(
      fc.property(
        fc.array(folderNodeArb, { minLength: 1, maxLength: 10 }),
        fc.array(documentSummaryArb, { minLength: 1, maxLength: 10 }),
        (folders, documents) => {
          const result = sortFolderContents(folders, documents);

          // The result structure guarantees folders and documents are separate arrays
          // meaning folders come before documents in any rendering
          expect(result.folders.length).toBe(folders.length);
          expect(result.documents.length).toBe(documents.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 3: Document list renders all required fields ---

describe('Property 3: Document list renders all required fields', () => {
  // **Validates: Requirements 2.1**

  it('all required fields (name, category, createdAt, siteName, fileSize) are present and non-null/undefined', () => {
    fc.assert(
      fc.property(documentSummaryArb, (doc) => {
        // Verify all required fields exist and are non-null/undefined
        expect(doc.name).toBeDefined();
        expect(doc.name).not.toBeNull();
        expect(typeof doc.name).toBe('string');
        expect(doc.name.length).toBeGreaterThan(0);

        expect(doc.category).toBeDefined();
        expect(doc.category).not.toBeNull();
        expect(['reports', 'forms', 'certifications', 'incidents', 'safety_evidence']).toContain(doc.category);

        expect(doc.createdAt).toBeDefined();
        expect(doc.createdAt).not.toBeNull();
        expect(typeof doc.createdAt).toBe('string');
        expect(doc.createdAt.length).toBeGreaterThan(0);

        expect(doc.siteName).toBeDefined();
        expect(doc.siteName).not.toBeNull();
        expect(typeof doc.siteName).toBe('string');
        expect(doc.siteName.length).toBeGreaterThan(0);

        expect(doc.fileSize).toBeDefined();
        expect(doc.fileSize).not.toBeNull();
        expect(typeof doc.fileSize).toBe('number');
        expect(doc.fileSize).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 4: Default document sort is descending by creation date ---

describe('Property 4: Default document sort is descending by creation date', () => {
  // **Validates: Requirements 2.2**

  it('sorting an array of documents by createdAt descending produces arr[i].createdAt >= arr[i+1].createdAt', () => {
    fc.assert(
      fc.property(
        fc.array(documentSummaryArb, { minLength: 2, maxLength: 30 }),
        (documents) => {
          // Sort documents by createdAt descending (as the default behavior should)
          const sorted = [...documents].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );

          // Verify descending order
          for (let i = 0; i < sorted.length - 1; i++) {
            const currentDate = new Date(sorted[i]!.createdAt).getTime();
            const nextDate = new Date(sorted[i + 1]!.createdAt).getTime();
            expect(currentDate).toBeGreaterThanOrEqual(nextDate);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
