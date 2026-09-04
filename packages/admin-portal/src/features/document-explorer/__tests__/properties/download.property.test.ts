// Feature: document-explorer, Property 6: Batch download size validation
// Feature: document-explorer, Property 7: Download progress calculation

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import type { DownloadProgress } from '../../types';
import { calculateDownloadProgress, validateBatchDownloadSize } from '../../utils';

const MAX_BATCH_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

// --- Property 6: Batch download size validation ---

describe('Property 6: Batch download size validation', () => {
  // **Validates: Requirements 3.2, 3.5**

  it('validateBatchDownloadSize allows iff total <= 500MB', () => {
    const documentWithSizeArb = fc.record({
      fileSize: fc.nat({ max: 100 * 1024 * 1024 }), // up to 100MB per doc
    });

    fc.assert(
      fc.property(
        fc.array(documentWithSizeArb, { minLength: 1, maxLength: 50 }),
        (documents) => {
          const totalSize = documents.reduce((sum, doc) => sum + doc.fileSize, 0);
          const result = validateBatchDownloadSize(documents);

          if (totalSize <= MAX_BATCH_DOWNLOAD_BYTES) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('validateBatchDownloadSize returns true at exactly 500MB boundary', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (numDocs) => {
          // Distribute exactly 500MB across numDocs documents
          const sizePerDoc = Math.floor(MAX_BATCH_DOWNLOAD_BYTES / numDocs);
          const remainder = MAX_BATCH_DOWNLOAD_BYTES - sizePerDoc * numDocs;

          const documents = Array.from({ length: numDocs }, (_, i) => ({
            fileSize: i === 0 ? sizePerDoc + remainder : sizePerDoc,
          }));

          expect(validateBatchDownloadSize(documents)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('validateBatchDownloadSize returns false when total exceeds 500MB', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100 * 1024 * 1024 }), // excess amount
        (excess) => {
          const documents = [{ fileSize: MAX_BATCH_DOWNLOAD_BYTES + excess + 1 }];
          expect(validateBatchDownloadSize(documents)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 7: Download progress calculation ---

describe('Property 7: Download progress calculation', () => {
  // **Validates: Requirements 3.3**

  it('percentage equals (bytesDownloaded / totalBytes) * 100 and ETA is non-negative', () => {
    const downloadProgressArb: fc.Arbitrary<DownloadProgress> = fc
      .record({
        totalBytes: fc.integer({ min: 1, max: 1_000_000_000 }),
        bytesDownloadedRatio: fc.double({ min: 0, max: 1, noNaN: true }),
        startedAtOffset: fc.integer({ min: 100, max: 60_000 }), // ms ago
      })
      .map(({ totalBytes, bytesDownloadedRatio, startedAtOffset }) => ({
        downloadId: 'test-download',
        status: 'downloading' as const,
        bytesDownloaded: Math.floor(bytesDownloadedRatio * totalBytes),
        totalBytes,
        startedAt: Date.now() - startedAtOffset,
        estimatedRemainingMs: null,
      }));

    fc.assert(
      fc.property(downloadProgressArb, (progress) => {
        const result = calculateDownloadProgress(progress);

        // Verify percentage calculation
        const expectedPercentage =
          (progress.bytesDownloaded / progress.totalBytes) * 100;
        expect(result.percentage).toBeCloseTo(expectedPercentage, 10);

        // Verify ETA is non-negative
        expect(result.estimatedRemainingMs).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it('percentage is 100 when bytesDownloaded equals totalBytes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.integer({ min: 100, max: 60_000 }),
        (totalBytes, startedAtOffset) => {
          const progress: DownloadProgress = {
            downloadId: 'test-download',
            status: 'complete',
            bytesDownloaded: totalBytes,
            totalBytes,
            startedAt: Date.now() - startedAtOffset,
            estimatedRemainingMs: null,
          };

          const result = calculateDownloadProgress(progress);
          expect(result.percentage).toBe(100);
          expect(result.estimatedRemainingMs).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
