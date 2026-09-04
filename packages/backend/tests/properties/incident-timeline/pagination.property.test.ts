// Feature: incident-timeline, Property 12: Paginación con máximo 20 elementos por página

/**
 * Property-based test for pagination in linkable responses.
 *
 * Property 12: For any result set with N elements and `page_size` of 20, each page
 * SHALL contain at most 20 elements. The final page SHALL contain `N mod 20` elements
 * (or 20 if N is divisible by 20).
 *
 * **Validates: Requirements 6.4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: vi.fn().mockImplementation((params) => params),
    PutCommand: vi.fn().mockImplementation((params) => params),
    UpdateCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for a form response item */
const arbFormResponseItem = fc.record({
  response_id: fc.uuid(),
  form_id: fc.uuid(),
  form_name: fc.string({ minLength: 1, maxLength: 30 }),
  folio: fc.stringMatching(/^[A-Z0-9-]{3,10}$/),
  submitted_at: fc
    .integer({ min: 1704067200000, max: 1735689600000 })
    .map((ms) => new Date(ms).toISOString()),
  submitted_by_name: fc.string({ minLength: 1, maxLength: 30 }),
  tenant_id: fc.constant('tenant-fixed'),
});

/** Arbitrary for a page number (1-indexed) */
const arbPage = fc.integer({ min: 1, max: 10 });

/** Arbitrary for a page size that will be capped at 20 */
const arbPageSize = fc.integer({ min: 1, max: 50 });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 12: Pagination with max 20 elements per page', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 6.4**
  it('each page contains at most 20 elements regardless of total result set size', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbFormResponseItem, { minLength: 0, maxLength: 60 }),
        arbPage,
        async (items, page) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await getLinkableResponses('tenant-fixed', {
            page,
            pageSize: 20,
          });

          // Each page must contain at most 20 elements
          expect(result.responses.length).toBeLessThanOrEqual(20);
          expect(result.page_size).toBeLessThanOrEqual(20);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.4**
  it('page_size is capped at 20 even if a larger value is requested', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbFormResponseItem, { minLength: 21, maxLength: 50 }),
        fc.integer({ min: 21, max: 100 }),
        async (items, requestedPageSize) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await getLinkableResponses('tenant-fixed', {
            page: 1,
            pageSize: requestedPageSize,
          });

          // Even if a larger page size is requested, results are capped at 20
          expect(result.responses.length).toBeLessThanOrEqual(20);
          expect(result.page_size).toBe(20);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.4**
  it('the final page contains N mod 20 elements (or 20 if N is divisible by 20)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbFormResponseItem, { minLength: 1, maxLength: 60 }),
        async (items) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          const N = items.length;
          const totalPages = Math.ceil(N / 20);
          const lastPage = totalPages;

          mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await getLinkableResponses('tenant-fixed', {
            page: lastPage,
            pageSize: 20,
          });

          // Calculate expected final page size
          const expectedFinalPageSize = N % 20 === 0 ? 20 : N % 20;
          expect(result.responses.length).toBe(expectedFinalPageSize);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.4**
  it('total_count reflects the full result set size regardless of pagination', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbFormResponseItem, { minLength: 0, maxLength: 60 }),
        arbPage,
        async (items, page) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await getLinkableResponses('tenant-fixed', {
            page,
            pageSize: 20,
          });

          // total_count should always be the full result set size
          expect(result.total_count).toBe(items.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.4**
  it('pages beyond the total pages return empty results', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbFormResponseItem, { minLength: 1, maxLength: 40 }),
        async (items) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          const N = items.length;
          const totalPages = Math.ceil(N / 20);
          const beyondLastPage = totalPages + 1;

          mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await getLinkableResponses('tenant-fixed', {
            page: beyondLastPage,
            pageSize: 20,
          });

          // Pages beyond the last page should return no results
          expect(result.responses.length).toBe(0);
          // But total_count still reflects the full set
          expect(result.total_count).toBe(N);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.4**
  it('page 1 returns the first min(N, 20) elements from the result set', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbFormResponseItem, { minLength: 1, maxLength: 50 }),
        async (items) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await getLinkableResponses('tenant-fixed', {
            page: 1,
            pageSize: 20,
          });

          const expectedSize = Math.min(items.length, 20);
          expect(result.responses.length).toBe(expectedSize);
          expect(result.page).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
