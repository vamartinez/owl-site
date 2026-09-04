// Property 3: Folder path computation
// Property 17: Dynamic folder count computation
// **Validates: Requirements 3.4, 3.5, 11.5**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeFolderPath, getItemsAtPath } from '../../folder-path';
import type { UnifiedDocument, OrganizationMode, DocumentCategory } from '../../types';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const categoryArb: fc.Arbitrary<DocumentCategory> = fc.constantFrom(
  'reports',
  'forms',
  'certifications',
  'incidents',
  'safety_evidence',
);

const orgModeArb: fc.Arbitrary<OrganizationMode> = fc.constantFrom(
  'category_site_year_month',
  'category_year_month_site',
);

/**
 * Generates a site name that is a non-empty alphanumeric string (no slashes/special chars
 * that could confuse path logic).
 */
const siteNameArb = fc.stringOf(fc.char().filter((c) => /[a-zA-Z0-9 _-]/.test(c)), {
  minLength: 1,
  maxLength: 30,
});

/**
 * Generates a valid ISO 8601 date string within a reasonable range.
 * We constrain to 2000-2099 to keep year as 4 digits.
 */
const dateArb = fc.date({
  min: new Date('2000-01-01T00:00:00Z'),
  max: new Date('2099-12-31T23:59:59Z'),
}).map((d) => d.toISOString());

/**
 * Generates a document input suitable for computeFolderPath.
 */
const docInputArb = fc.record({
  category: categoryArb,
  siteName: siteNameArb,
  createdAt: dateArb,
});

/**
 * Generates a full UnifiedDocument for getItemsAtPath testing.
 */
function unifiedDocArb(mode: OrganizationMode): fc.Arbitrary<UnifiedDocument> {
  return fc
    .record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      category: categoryArb,
      mimeType: fc.constantFrom('application/pdf', 'image/png', 'text/plain'),
      fileSize: fc.integer({ min: 1, max: 10_000_000 }),
      createdAt: dateArb,
      siteName: siteNameArb,
      siteId: fc.uuid(),
      tenantId: fc.uuid(),
      s3Key: fc.string({ minLength: 5, maxLength: 100 }),
      sha256Hash: fc.option(fc.hexaString({ minLength: 64, maxLength: 64 }), { nil: null }),
    })
    .map((doc) => ({
      ...doc,
      folderPath: computeFolderPath(doc, mode),
    }));
}

// ─── Property 3: Folder path computation ─────────────────────────────────────

describe('Property 3: Folder path computation', () => {
  // **Validates: Requirements 3.4, 3.5**

  it('category_site_year_month mode produces [category, siteName, year, month]', () => {
    fc.assert(
      fc.property(docInputArb, (doc) => {
        const result = computeFolderPath(doc, 'category_site_year_month');
        const date = new Date(doc.createdAt);
        const expectedYear = date.getUTCFullYear().toString();
        const expectedMonth = String(date.getUTCMonth() + 1).padStart(2, '0');

        expect(result).toHaveLength(4);
        expect(result[0]).toBe(doc.category);
        expect(result[1]).toBe(doc.siteName);
        expect(result[2]).toBe(expectedYear);
        expect(result[3]).toBe(expectedMonth);
      }),
      { numRuns: 200 },
    );
  });

  it('category_year_month_site mode produces [category, year, month, siteName]', () => {
    fc.assert(
      fc.property(docInputArb, (doc) => {
        const result = computeFolderPath(doc, 'category_year_month_site');
        const date = new Date(doc.createdAt);
        const expectedYear = date.getUTCFullYear().toString();
        const expectedMonth = String(date.getUTCMonth() + 1).padStart(2, '0');

        expect(result).toHaveLength(4);
        expect(result[0]).toBe(doc.category);
        expect(result[1]).toBe(expectedYear);
        expect(result[2]).toBe(expectedMonth);
        expect(result[3]).toBe(doc.siteName);
      }),
      { numRuns: 200 },
    );
  });

  it('path always has length 4 regardless of organization mode', () => {
    fc.assert(
      fc.property(docInputArb, orgModeArb, (doc, mode) => {
        const result = computeFolderPath(doc, mode);
        expect(result).toHaveLength(4);
      }),
      { numRuns: 200 },
    );
  });

  it('year is always a 4-digit string and month is always zero-padded 2-digit (01-12)', () => {
    fc.assert(
      fc.property(docInputArb, orgModeArb, (doc, mode) => {
        const result = computeFolderPath(doc, mode);

        // Depending on mode, year/month are at different indices
        let year: string;
        let month: string;
        if (mode === 'category_site_year_month') {
          year = result[2]!;
          month = result[3]!;
        } else {
          year = result[1]!;
          month = result[2]!;
        }

        expect(year).toMatch(/^\d{4}$/);
        expect(month).toMatch(/^(0[1-9]|1[0-2])$/);
      }),
      { numRuns: 200 },
    );
  });

  it('first segment is always the document category for both modes', () => {
    fc.assert(
      fc.property(docInputArb, orgModeArb, (doc, mode) => {
        const result = computeFolderPath(doc, mode);
        expect(result[0]).toBe(doc.category);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 17: Dynamic folder count computation ───────────────────────────

describe('Property 17: Dynamic folder count computation', () => {
  // **Validates: Requirements 11.5**

  it('documentCount for each folder equals number of documents whose folderPath starts with that folder path', () => {
    fc.assert(
      fc.property(
        orgModeArb,
        fc.array(docInputArb, { minLength: 1, maxLength: 50 }),
        (mode, docInputs) => {
          // Build UnifiedDocuments with computed folder paths
          const documents: UnifiedDocument[] = docInputs.map((doc, i) => ({
            id: `doc-${i}`,
            name: `Document ${i}`,
            category: doc.category,
            mimeType: 'application/pdf',
            fileSize: 1000,
            createdAt: doc.createdAt,
            siteName: doc.siteName,
            siteId: `site-${i}`,
            tenantId: 'tenant-1',
            s3Key: `key-${i}`,
            sha256Hash: null,
            folderPath: computeFolderPath(doc, mode),
          }));

          // Query at root level (empty path) — should return category folders
          const { folders } = getItemsAtPath(documents, []);

          for (const folder of folders) {
            // Count documents whose folderPath starts with this folder's path
            const expectedCount = documents.filter((d) =>
              folder.path.every((seg, i) => d.folderPath[i] === seg),
            ).length;

            expect(folder.documentCount).toBe(expectedCount);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('lastUpdated for each folder equals the maximum createdAt among documents in that subtree', () => {
    fc.assert(
      fc.property(
        orgModeArb,
        fc.array(docInputArb, { minLength: 1, maxLength: 50 }),
        (mode, docInputs) => {
          const documents: UnifiedDocument[] = docInputs.map((doc, i) => ({
            id: `doc-${i}`,
            name: `Document ${i}`,
            category: doc.category,
            mimeType: 'application/pdf',
            fileSize: 1000,
            createdAt: doc.createdAt,
            siteName: doc.siteName,
            siteId: `site-${i}`,
            tenantId: 'tenant-1',
            s3Key: `key-${i}`,
            sha256Hash: null,
            folderPath: computeFolderPath(doc, mode),
          }));

          const { folders } = getItemsAtPath(documents, []);

          for (const folder of folders) {
            // Find all documents in this folder's subtree
            const docsInSubtree = documents.filter((d) =>
              folder.path.every((seg, i) => d.folderPath[i] === seg),
            );

            if (docsInSubtree.length > 0) {
              const maxCreatedAt = docsInSubtree.reduce(
                (max, d) => (d.createdAt > max ? d.createdAt : max),
                docsInSubtree[0]!.createdAt,
              );
              expect(folder.lastUpdated).toBe(maxCreatedAt);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('childFolderCount equals the number of distinct next-level segments below the folder', () => {
    fc.assert(
      fc.property(
        orgModeArb,
        fc.array(docInputArb, { minLength: 1, maxLength: 50 }),
        (mode, docInputs) => {
          const documents: UnifiedDocument[] = docInputs.map((doc, i) => ({
            id: `doc-${i}`,
            name: `Document ${i}`,
            category: doc.category,
            mimeType: 'application/pdf',
            fileSize: 1000,
            createdAt: doc.createdAt,
            siteName: doc.siteName,
            siteId: `site-${i}`,
            tenantId: 'tenant-1',
            s3Key: `key-${i}`,
            sha256Hash: null,
            folderPath: computeFolderPath(doc, mode),
          }));

          const { folders } = getItemsAtPath(documents, []);

          for (const folder of folders) {
            const folderDepth = folder.path.length;
            // Find all documents that are deeper than this folder
            const docsBelow = documents.filter(
              (d) =>
                d.folderPath.length > folderDepth &&
                folder.path.every((seg, i) => d.folderPath[i] === seg),
            );

            // Count distinct segments at the next level (folderDepth index)
            const distinctChildSegments = new Set(
              docsBelow
                .filter((d) => d.folderPath.length > folderDepth)
                .map((d) => d.folderPath[folderDepth]!),
            );

            expect(folder.childFolderCount).toBe(distinctChildSegments.size);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getItemsAtPath at a nested path correctly counts documents in sub-folders', () => {
    fc.assert(
      fc.property(
        orgModeArb,
        fc.array(docInputArb, { minLength: 2, maxLength: 30 }),
        (mode, docInputs) => {
          const documents: UnifiedDocument[] = docInputs.map((doc, i) => ({
            id: `doc-${i}`,
            name: `Document ${i}`,
            category: doc.category,
            mimeType: 'application/pdf',
            fileSize: 1000,
            createdAt: doc.createdAt,
            siteName: doc.siteName,
            siteId: `site-${i}`,
            tenantId: 'tenant-1',
            s3Key: `key-${i}`,
            sha256Hash: null,
            folderPath: computeFolderPath(doc, mode),
          }));

          // Pick a category that exists in the docs
          const firstDoc = documents[0]!;
          const targetPath = [firstDoc.folderPath[0]!];

          const { folders, documentsAtPath } = getItemsAtPath(documents, targetPath);

          // All documentsAtPath should have folderPath length equal to targetPath length
          for (const doc of documentsAtPath) {
            expect(doc.folderPath.length).toBe(targetPath.length);
          }

          // Sum of all folder documentCounts + documentsAtPath length should equal
          // total docs that match the targetPath prefix
          const totalDocsUnderPath = documents.filter((d) =>
            targetPath.every((seg, i) => d.folderPath[i] === seg),
          ).length;

          const sumFolderCounts = folders.reduce((sum, f) => sum + f.documentCount, 0);
          expect(sumFolderCounts + documentsAtPath.length).toBe(totalDocsUnderPath);
        },
      ),
      { numRuns: 100 },
    );
  });
});
