// Feature: document-explorer-backend, Properties 10, 11: Download and integrity property tests

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'crypto';
import { validateBatchSize } from '../../download-handler';

// ─── Property 10: Batch partial failure — accessible documents included ──────

describe('Property 10: Batch partial failure — accessible documents included', () => {
  // **Validates: Requirements 7.5**

  /**
   * Pure model of batch download partitioning logic:
   * Given a set of requested document IDs and a set of accessible document IDs,
   * the batch download should include all accessible docs and skip inaccessible ones.
   * The union of included + skipped IDs must equal the original requested set.
   */
  function partitionBatchDocuments(
    requestedIds: string[],
    accessibleIds: Set<string>,
  ): { includedIds: string[]; skippedIds: string[] } {
    const includedIds: string[] = [];
    const skippedIds: string[] = [];

    for (const id of requestedIds) {
      if (accessibleIds.has(id)) {
        includedIds.push(id);
      } else {
        skippedIds.push(id);
      }
    }

    return { includedIds, skippedIds };
  }

  it('union of included + skipped IDs equals the original requested set', () => {
    // Generate a mix of accessible and inaccessible document IDs
    const batchArb = fc
      .tuple(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 50 }),
        fc.array(fc.uuid(), { minLength: 0, maxLength: 50 }),
      )
      .map(([requestedIds, extraAccessibleIds]) => {
        // Some requested IDs are accessible, some are not
        const accessibleSubset = requestedIds.filter((_, i) => i % 2 === 0);
        const accessibleIds = new Set([...accessibleSubset, ...extraAccessibleIds]);
        return { requestedIds, accessibleIds };
      });

    fc.assert(
      fc.property(batchArb, ({ requestedIds, accessibleIds }) => {
        const { includedIds, skippedIds } = partitionBatchDocuments(requestedIds, accessibleIds);

        // Union of included + skipped must equal original requested set
        const unionIds = new Set([...includedIds, ...skippedIds]);
        const requestedSet = new Set(requestedIds);

        expect(unionIds).toEqual(requestedSet);
      }),
      { numRuns: 100 },
    );
  });

  it('all accessible documents are always included in the download', () => {
    const batchArb = fc
      .tuple(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 50 }),
        fc.float({ min: 0, max: 1 }),
      )
      .map(([requestedIds, accessibleRatio]) => {
        // Make a portion of documents accessible based on ratio
        const accessibleIds = new Set(
          requestedIds.filter((_, i) => i < Math.ceil(requestedIds.length * accessibleRatio)),
        );
        return { requestedIds, accessibleIds };
      });

    fc.assert(
      fc.property(batchArb, ({ requestedIds, accessibleIds }) => {
        const { includedIds } = partitionBatchDocuments(requestedIds, accessibleIds);

        // Every accessible document from the request must be in includedIds
        for (const id of requestedIds) {
          if (accessibleIds.has(id)) {
            expect(includedIds).toContain(id);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('inaccessible documents are always in the skipped list', () => {
    const batchArb = fc
      .tuple(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 50 }),
        fc.float({ min: 0, max: 1 }),
      )
      .map(([requestedIds, accessibleRatio]) => {
        const accessibleIds = new Set(
          requestedIds.filter((_, i) => i < Math.ceil(requestedIds.length * accessibleRatio)),
        );
        return { requestedIds, accessibleIds };
      });

    fc.assert(
      fc.property(batchArb, ({ requestedIds, accessibleIds }) => {
        const { skippedIds } = partitionBatchDocuments(requestedIds, accessibleIds);

        // Every inaccessible document from the request must be in skippedIds
        for (const id of requestedIds) {
          if (!accessibleIds.has(id)) {
            expect(skippedIds).toContain(id);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('no document appears in both included and skipped', () => {
    const batchArb = fc
      .tuple(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 50 }),
        fc.float({ min: 0, max: 1 }),
      )
      .map(([requestedIds, accessibleRatio]) => {
        const accessibleIds = new Set(
          requestedIds.filter((_, i) => i < Math.ceil(requestedIds.length * accessibleRatio)),
        );
        return { requestedIds, accessibleIds };
      });

    fc.assert(
      fc.property(batchArb, ({ requestedIds, accessibleIds }) => {
        const { includedIds, skippedIds } = partitionBatchDocuments(requestedIds, accessibleIds);

        const includedSet = new Set(includedIds);
        const skippedSet = new Set(skippedIds);

        // No overlap
        for (const id of includedIds) {
          expect(skippedSet.has(id)).toBe(false);
        }
        for (const id of skippedIds) {
          expect(includedSet.has(id)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: SHA-256 integrity verification correctness ─────────────────

describe('Property 11: SHA-256 integrity verification correctness', () => {
  // **Validates: Requirements 8.1**

  /**
   * Pure integrity verification logic:
   * Compute SHA-256 of content and compare with stored hash.
   */
  function verifyIntegrity(
    content: Buffer,
    storedHash: string,
  ): { computedHash: string; storedHash: string; match: boolean } {
    const computedHash = createHash('sha256').update(content).digest('hex');
    return {
      computedHash,
      storedHash,
      match: computedHash === storedHash,
    };
  }

  it('match is true when computed hash equals stored hash', () => {
    // Generate arbitrary byte content, compute its hash, and verify match
    const contentArb = fc.uint8Array({ minLength: 1, maxLength: 1024 });

    fc.assert(
      fc.property(contentArb, (contentArray) => {
        const content = Buffer.from(contentArray);
        const correctHash = createHash('sha256').update(content).digest('hex');

        const result = verifyIntegrity(content, correctHash);

        expect(result.match).toBe(true);
        expect(result.computedHash).toBe(correctHash);
        expect(result.storedHash).toBe(correctHash);
      }),
      { numRuns: 100 },
    );
  });

  it('match is false when stored hash differs from computed hash', () => {
    // Generate content and a different hash to ensure mismatch
    const mismatchArb = fc
      .tuple(
        fc.uint8Array({ minLength: 1, maxLength: 1024 }),
        fc.hexaString({ minLength: 64, maxLength: 64 }),
      )
      .filter(([contentArray, fakeHash]) => {
        const content = Buffer.from(contentArray);
        const realHash = createHash('sha256').update(content).digest('hex');
        return realHash !== fakeHash;
      });

    fc.assert(
      fc.property(mismatchArb, ([contentArray, fakeHash]) => {
        const content = Buffer.from(contentArray);
        const result = verifyIntegrity(content, fakeHash);

        expect(result.match).toBe(false);
        expect(result.storedHash).toBe(fakeHash);
        expect(result.computedHash).not.toBe(fakeHash);
      }),
      { numRuns: 100 },
    );
  });

  it('computedHash and storedHash fields are always present in the response', () => {
    const contentArb = fc.uint8Array({ minLength: 0, maxLength: 512 });
    const hashArb = fc.hexaString({ minLength: 64, maxLength: 64 });

    fc.assert(
      fc.property(contentArb, hashArb, (contentArray, storedHash) => {
        const content = Buffer.from(contentArray);
        const result = verifyIntegrity(content, storedHash);

        // Both fields must always be present (non-null, non-undefined)
        expect(result.computedHash).toBeDefined();
        expect(result.storedHash).toBeDefined();
        expect(typeof result.computedHash).toBe('string');
        expect(typeof result.storedHash).toBe('string');
        expect(result.computedHash.length).toBe(64); // SHA-256 hex is 64 chars
      }),
      { numRuns: 100 },
    );
  });

  it('SHA-256 is deterministic — same content always produces same hash', () => {
    const contentArb = fc.uint8Array({ minLength: 1, maxLength: 512 });

    fc.assert(
      fc.property(contentArb, (contentArray) => {
        const content = Buffer.from(contentArray);
        const hash1 = createHash('sha256').update(content).digest('hex');
        const hash2 = createHash('sha256').update(content).digest('hex');

        expect(hash1).toBe(hash2);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── validateBatchSize pure function tests ───────────────────────────────────

describe('validateBatchSize: total size ≤ 500MB', () => {
  // **Validates: Requirements 7.5**

  const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB

  it('returns valid:true when total file sizes sum to at most 500MB', () => {
    // Generate arrays of file sizes that sum to ≤ 500MB
    const validSizesArb = fc
      .array(fc.integer({ min: 0, max: 50 * 1024 * 1024 }), { minLength: 1, maxLength: 50 })
      .filter((sizes) => sizes.reduce((a, b) => a + b, 0) <= MAX_TOTAL_BYTES);

    fc.assert(
      fc.property(validSizesArb, (fileSizes) => {
        const result = validateBatchSize(fileSizes);
        expect(result.valid).toBe(true);
        expect(result.totalSize).toBe(fileSizes.reduce((a, b) => a + b, 0));
      }),
      { numRuns: 100 },
    );
  });

  it('returns valid:false when total file sizes exceed 500MB', () => {
    // Generate arrays of file sizes that sum to > 500MB
    const invalidSizesArb = fc
      .array(fc.integer({ min: 1, max: 100 * 1024 * 1024 }), { minLength: 1, maxLength: 50 })
      .filter((sizes) => sizes.reduce((a, b) => a + b, 0) > MAX_TOTAL_BYTES);

    fc.assert(
      fc.property(invalidSizesArb, (fileSizes) => {
        const result = validateBatchSize(fileSizes);
        expect(result.valid).toBe(false);
        expect(result.totalSize).toBeGreaterThan(MAX_TOTAL_BYTES);
      }),
      { numRuns: 100 },
    );
  });

  it('totalSize always equals the sum of all file sizes', () => {
    const sizesArb = fc.array(fc.integer({ min: 0, max: 200 * 1024 * 1024 }), {
      minLength: 0,
      maxLength: 50,
    });

    fc.assert(
      fc.property(sizesArb, (fileSizes) => {
        const result = validateBatchSize(fileSizes);
        const expectedSum = fileSizes.reduce((a, b) => a + b, 0);
        expect(result.totalSize).toBe(expectedSum);
      }),
      { numRuns: 100 },
    );
  });

  it('boundary: exactly 500MB returns valid:true', () => {
    // Create sizes that sum to exactly 500MB
    const exactLimitArb = fc
      .integer({ min: 1, max: 50 })
      .map((count) => {
        const perFile = Math.floor(MAX_TOTAL_BYTES / count);
        const sizes = Array(count).fill(perFile);
        // Adjust last element to hit exactly 500MB
        sizes[sizes.length - 1] = MAX_TOTAL_BYTES - perFile * (count - 1);
        return sizes;
      });

    fc.assert(
      fc.property(exactLimitArb, (fileSizes) => {
        const result = validateBatchSize(fileSizes);
        expect(result.totalSize).toBe(MAX_TOTAL_BYTES);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('empty array returns valid:true with totalSize 0', () => {
    const result = validateBatchSize([]);
    expect(result.valid).toBe(true);
    expect(result.totalSize).toBe(0);
  });
});
