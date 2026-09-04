// Feature: incident-timeline, Property 11: Filtro por rango de fechas

/**
 * Property-based test for date range filtering in linkable responses.
 *
 * Property 11: For any date range [date_from, date_to] and set of Form_Response,
 * results SHALL contain exactly those responses where `submitted_at >= date_from`
 * AND `submitted_at <= date_to`.
 *
 * **Validates: Requirements 6.2**
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

/** Arbitrary for a timestamp in 2024 */
const arbTimestamp = fc.integer({ min: 1704067200000, max: 1735689600000 });

/** Arbitrary for an ISO date string */
const arbIsoDate = arbTimestamp.map((ms) => new Date(ms).toISOString());

/**
 * Arbitrary for a date range where dateFrom <= dateTo.
 * Generates two timestamps and returns them in sorted order.
 */
const arbDateRange = fc
  .tuple(arbTimestamp, arbTimestamp)
  .map(([a, b]) => {
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    return {
      dateFrom: new Date(min).toISOString(),
      dateTo: new Date(max).toISOString(),
    };
  });

/** Arbitrary for a form response item with a specific submitted_at */
const arbFormResponseItemWithDate = (submittedAt: string) =>
  fc.record({
    response_id: fc.uuid(),
    form_id: fc.uuid(),
    form_name: fc.string({ minLength: 1, maxLength: 30 }),
    folio: fc.stringMatching(/^[A-Z0-9-]{3,10}$/),
    submitted_at: fc.constant(submittedAt),
    submitted_by_name: fc.string({ minLength: 1, maxLength: 30 }),
    tenant_id: fc.uuid(),
  });

/** Arbitrary for a form response item with a random date */
const arbFormResponseItem = fc.record({
  response_id: fc.uuid(),
  form_id: fc.uuid(),
  form_name: fc.string({ minLength: 1, maxLength: 30 }),
  folio: fc.stringMatching(/^[A-Z0-9-]{3,10}$/),
  submitted_at: arbIsoDate,
  submitted_by_name: fc.string({ minLength: 1, maxLength: 30 }),
  tenant_id: fc.uuid(),
});

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 11: Date range filter', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 6.2**
  it('results contain exactly those responses where submitted_at is within [dateFrom, dateTo]', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDateRange,
        fc.array(arbFormResponseItem, { minLength: 1, maxLength: 30 }),
        async ({ dateFrom, dateTo }, items) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          // The date range filter is applied as a DynamoDB FilterExpression.
          // So DynamoDB returns only items matching the date range.
          // Simulate DynamoDB applying the BETWEEN filter:
          const filteredByDb = items.filter(
            (item) => item.submitted_at >= dateFrom && item.submitted_at <= dateTo
          );

          mockSend.mockResolvedValueOnce({
            Items: filteredByDb,
            Count: filteredByDb.length,
          });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const tenantId = items[0]?.tenant_id ?? 'test-tenant';
          const result = await getLinkableResponses(tenantId, {
            dateFrom,
            dateTo,
            pageSize: 20,
          });

          // Verify total_count matches the filtered set (up to page boundaries)
          expect(result.total_count).toBe(filteredByDb.length);

          // All returned responses should have submitted_at within range
          for (const response of result.responses) {
            expect(response.submitted_at >= dateFrom).toBe(true);
            expect(response.submitted_at <= dateTo).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.2**
  it('responses outside the date range are never included in results', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDateRange,
        fc.array(arbFormResponseItem, { minLength: 1, maxLength: 20 }),
        async ({ dateFrom, dateTo }, items) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          // DynamoDB FilterExpression BETWEEN excludes out-of-range items
          const filteredByDb = items.filter(
            (item) => item.submitted_at >= dateFrom && item.submitted_at <= dateTo
          );

          mockSend.mockResolvedValueOnce({
            Items: filteredByDb,
            Count: filteredByDb.length,
          });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const tenantId = items[0]?.tenant_id ?? 'test-tenant';
          const result = await getLinkableResponses(tenantId, { dateFrom, dateTo });

          // Identify items outside the range
          const outsideRange = items.filter(
            (item) => item.submitted_at < dateFrom || item.submitted_at > dateTo
          );
          const outsideIds = new Set(outsideRange.map((i) => i.response_id));

          // None of the returned responses should be from outside the range
          for (const response of result.responses) {
            expect(outsideIds.has(response.response_id)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 6.2**
  it('the query passes dateFrom and dateTo as filter expression values to DynamoDB', async () => {
    await fc.assert(
      fc.asyncProperty(arbDateRange, async ({ dateFrom, dateTo }) => {
        vi.resetModules();
        mockSend.mockReset();
        mockAwsSdk();

        mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

        const { getLinkableResponses } = await import(
          '../../../src/services/incidents/linked-documents-repository.js'
        );

        await getLinkableResponses('tenant-123', { dateFrom, dateTo });

        // Verify the query includes date range values
        expect(mockSend).toHaveBeenCalledOnce();
        const queryParams = mockSend.mock.calls[0][0];

        expect(queryParams.ExpressionAttributeValues[':dateFrom']).toBe(dateFrom);
        expect(queryParams.ExpressionAttributeValues[':dateTo']).toBe(dateTo);
        expect(queryParams.FilterExpression).toContain('BETWEEN');
      }),
      { numRuns: 100 }
    );
  });
});
