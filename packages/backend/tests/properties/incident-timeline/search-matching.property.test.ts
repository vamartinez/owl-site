// Feature: incident-timeline, Property 10: Búsqueda por coincidencia parcial

/**
 * Property-based test for partial search matching in linkable responses.
 *
 * Property 10: For any search term `t` and set of Form_Response, results SHALL include
 * a response if and only if `t` appears as substring (case-insensitive) in at least one of:
 * form name, folio, or submitted_by_name.
 *
 * **Validates: Requirements 6.1**
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

/** Arbitrary for a non-empty alphanumeric search term */
const arbSearchTerm = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

/** Arbitrary for a form response item */
const arbFormResponseItem = fc.record({
  response_id: fc.uuid(),
  form_id: fc.uuid(),
  form_name: fc.string({ minLength: 1, maxLength: 50 }),
  folio: fc.stringMatching(/^[A-Z0-9-]{3,15}$/),
  submitted_at: fc
    .integer({ min: 1704067200000, max: 1735689600000 })
    .map((ms) => new Date(ms).toISOString()),
  submitted_by_name: fc.string({ minLength: 1, maxLength: 50 }),
  tenant_id: fc.uuid(),
});

/**
 * Helper: checks if a search term matches a form response item (case-insensitive substring).
 * This is the oracle/reference implementation of the search logic.
 */
function shouldMatch(
  item: { form_name: string; folio: string; submitted_by_name: string },
  searchTerm: string
): boolean {
  const searchLower = searchTerm.toLowerCase();
  return (
    item.form_name.toLowerCase().includes(searchLower) ||
    item.folio.toLowerCase().includes(searchLower) ||
    item.submitted_by_name.toLowerCase().includes(searchLower)
  );
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 10: Search by partial match', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 6.1**
  it('search results include a response iff search term is a case-insensitive substring of form_name, folio, or submitted_by_name', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSearchTerm,
        fc.array(arbFormResponseItem, { minLength: 1, maxLength: 30 }),
        async (searchTerm, items) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          // Mock DynamoDB returning all items (search is applied in-memory)
          mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const tenantId = items[0].tenant_id;
          const result = await getLinkableResponses(tenantId, {
            search: searchTerm,
            pageSize: 20,
          });

          // Calculate expected results using the oracle
          const expectedMatches = items.filter((item) => shouldMatch(item, searchTerm));

          // All returned response_ids should be from items that match the search
          const returnedIds = new Set(result.responses.map((r) => r.response_id));
          const expectedIds = new Set(
            expectedMatches.slice(0, 20).map((item) => item.response_id)
          );

          // total_count should match all matching items (before pagination)
          expect(result.total_count).toBe(expectedMatches.length);

          // Each returned response should be in the expected set
          for (const response of result.responses) {
            const sourceItem = items.find((i) => i.response_id === response.response_id);
            expect(sourceItem).toBeDefined();
            expect(shouldMatch(sourceItem!, searchTerm)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.1**
  it('responses that do NOT contain the search term are never included', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSearchTerm,
        fc.array(arbFormResponseItem, { minLength: 1, maxLength: 20 }),
        async (searchTerm, items) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const tenantId = items[0].tenant_id;
          const result = await getLinkableResponses(tenantId, { search: searchTerm });

          // Identify items that should NOT match
          const nonMatchingItems = items.filter((item) => !shouldMatch(item, searchTerm));
          const nonMatchingIds = new Set(nonMatchingItems.map((i) => i.response_id));

          // None of the returned responses should be from non-matching items
          for (const response of result.responses) {
            expect(nonMatchingIds.has(response.response_id)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.1**
  it('search is case-insensitive: uppercase and lowercase versions of the same term yield the same results', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 15 }).filter((s) => /^[a-zA-Z]+$/.test(s)),
        fc.array(arbFormResponseItem, { minLength: 1, maxLength: 15 }),
        async (searchTerm, items) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          // First call: search with lowercase
          mockSend.mockResolvedValueOnce({ Items: [...items], Count: items.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const tenantId = items[0].tenant_id;
          const resultLower = await getLinkableResponses(tenantId, {
            search: searchTerm.toLowerCase(),
          });

          // Reset for second call
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();
          mockSend.mockResolvedValueOnce({ Items: [...items], Count: items.length });

          const { getLinkableResponses: getLinkableResponses2 } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const resultUpper = await getLinkableResponses2(tenantId, {
            search: searchTerm.toUpperCase(),
          });

          // Both searches should yield the same total_count
          expect(resultLower.total_count).toBe(resultUpper.total_count);

          // Both should return the same response_ids
          const lowerIds = new Set(resultLower.responses.map((r) => r.response_id));
          const upperIds = new Set(resultUpper.responses.map((r) => r.response_id));
          expect(lowerIds).toEqual(upperIds);
        }
      ),
      { numRuns: 50 }
    );
  });
});
