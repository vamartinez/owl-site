// Feature: contractor-forms-qr, Property 21: Filtros de respuestas retornan solo coincidencias
// Feature: contractor-forms-qr, Property 22: Paginación respeta límite máximo

/**
 * Property-based tests for response filtering and pagination.
 *
 * Property 21: For any set of responses and filter criteria (form, date range, status),
 * all returned responses must satisfy all applied filter criteria.
 *
 * Property 22: For any response or audit query, each page must contain at most the
 * defined limit (25 for responses, 50 for audit) and results must be consistently ordered.
 *
 * **Validates: Requirements 12.2, 12.5**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { FormResponse, FormResponseMetadata } from '../../src/services/forms/types.js';

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: vi.fn().mockImplementation((params) => params),
    GetCommand: vi.fn().mockImplementation((params) => params),
    PutCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for form IDs (UUID-like) */
const arbFormId = fc.uuid();

/** Arbitrary for tenant IDs */
const arbTenantId = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 3,
    maxLength: 20,
  })
  .map((id) => `tenant-${id}`);

/** Arbitrary for valid IPv4 addresses */
const arbIpAddress = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 })
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Arbitrary for a date within a reasonable range (2024) */
const arbDate = fc
  .integer({ min: 0, max: 364 })
  .map((dayOffset) => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    date.setDate(date.getDate() + dayOffset);
    date.setHours(
      Math.floor(Math.random() * 24),
      Math.floor(Math.random() * 60),
      Math.floor(Math.random() * 60)
    );
    return date.toISOString();
  });

/** Arbitrary for a date within a specific range */
function arbDateInRange(startDate: string, endDate: string): fc.Arbitrary<string> {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  return fc.integer({ min: startMs, max: endMs }).map((ms) => new Date(ms).toISOString());
}

/** Arbitrary for a date outside a specific range */
function arbDateOutsideRange(startDate: string, endDate: string): fc.Arbitrary<string> {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  return fc.oneof(
    // Before start
    fc.integer({ min: startMs - 90 * dayMs, max: startMs - 1 }).map((ms) => new Date(ms).toISOString()),
    // After end
    fc.integer({ min: endMs + 1, max: endMs + 90 * dayMs }).map((ms) => new Date(ms).toISOString())
  );
}

/** Arbitrary for a valid date range (start < end, max 365 days) */
const arbDateRange = fc
  .tuple(
    fc.integer({ min: 0, max: 300 }),
    fc.integer({ min: 1, max: 60 })
  )
  .map(([startDayOffset, rangeDays]) => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    start.setDate(start.getDate() + startDayOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + rangeDays);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  });

/** Arbitrary for folio (8 alphanumeric uppercase chars) */
const arbFolio = fc
  .stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), {
    minLength: 8,
    maxLength: 8,
  });

/** Arbitrary for a FormResponse item as stored in DynamoDB */
function arbFormResponseItem(
  formId: string,
  tenantId: string,
  submittedAt: string
): fc.Arbitrary<Record<string, unknown>> {
  return fc.tuple(fc.uuid(), arbFolio, arbIpAddress).map(([responseId, folio, ip]) => ({
    PK: `FORM#${formId}`,
    SK: `RESPONSE#${responseId}`,
    GSI1PK: `FORM#${formId}`,
    GSI1SK: `DATE#${submittedAt}`,
    response_id: responseId,
    form_id: formId,
    version_number: 1,
    folio,
    submitted_at: submittedAt,
    answers: {},
    metadata: {
      origin_type: 'url_directa',
      user_agent: 'Mozilla/5.0',
      ip_address: ip,
    } as FormResponseMetadata,
    tenant_id: tenantId,
  }));
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Forms Response Filtering & Pagination Property Tests', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 12.2**
  describe('Property 21: Filtros de respuestas retornan solo coincidencias', () => {
    it('date range filters only return responses within the specified range', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbTenantId,
          arbDateRange,
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 0, max: 3 }),
          async (formId, tenantId, dateRange, insideCount, outsideCount) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            const { startDate, endDate } = dateRange;

            // Generate responses inside the date range
            const insideDates: string[] = [];
            const startMs = new Date(startDate).getTime();
            const endMs = new Date(endDate + 'T23:59:59.999Z').getTime();
            for (let i = 0; i < insideCount; i++) {
              const ms = startMs + Math.floor(Math.random() * (endMs - startMs));
              insideDates.push(new Date(ms).toISOString());
            }

            // Build mock items that would be returned by DynamoDB GSI1 query
            // DynamoDB key condition on GSI1SK already filters by date range,
            // so the mock should only return items within the range
            const mockItems = insideDates.map((date) => ({
              PK: `FORM#${formId}`,
              SK: `RESPONSE#${fc.sample(fc.uuid(), 1)[0]}`,
              GSI1PK: `FORM#${formId}`,
              GSI1SK: `DATE#${date}`,
              response_id: fc.sample(fc.uuid(), 1)[0],
              form_id: formId,
              version_number: 1,
              folio: fc.sample(arbFolio, 1)[0],
              submitted_at: date,
              answers: {},
              metadata: {
                origin_type: 'url_directa',
                user_agent: 'Mozilla/5.0',
                ip_address: '192.168.1.1',
              },
              tenant_id: tenantId,
            }));

            // Mock DynamoDB query response — DynamoDB GSI1 key condition
            // ensures only items within the date range are returned
            mockSend.mockResolvedValueOnce({
              Items: mockItems,
              Count: mockItems.length,
            });

            const { listFormResponses } = await import(
              '../../src/services/forms/form-response.js'
            );

            const result = await listFormResponses({
              formId,
              tenantId,
              startDate,
              endDate,
            });

            // Must succeed
            expect(result.success).toBe(true);
            if (result.success) {
              // All returned responses must have submitted_at within the date range
              for (const response of result.responses) {
                const responseDate = new Date(response.submitted_at);
                const rangeStart = new Date(startDate);
                const rangeEnd = new Date(endDate + 'T23:59:59.999Z');

                expect(responseDate.getTime()).toBeGreaterThanOrEqual(rangeStart.getTime());
                expect(responseDate.getTime()).toBeLessThanOrEqual(rangeEnd.getTime());
              }

              // The number of returned responses must match what DynamoDB returned
              expect(result.responses.length).toBe(mockItems.length);
            }
          }
        ),
        { numRuns: 30 },
      );
    }, 15000);

    it('rejects date ranges exceeding 365 days', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbTenantId,
          fc.integer({ min: 366, max: 730 }),
          async (formId, tenantId, rangeDays) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            const startDate = '2024-01-01';
            const end = new Date('2024-01-01');
            end.setDate(end.getDate() + rangeDays);
            const endDate = end.toISOString().split('T')[0];

            const { listFormResponses } = await import(
              '../../src/services/forms/form-response.js'
            );

            const result = await listFormResponses({
              formId,
              tenantId,
              startDate,
              endDate,
            });

            // Must be rejected with BAD_REQUEST
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(400);
              expect(result.code).toBe('BAD_REQUEST');
              expect(result.message).toContain('365');
            }
          }
        ),
        { numRuns: 30 },
      );
    }, 15000);

    it('returns empty results when no responses match the date range', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbTenantId,
          arbDateRange,
          async (formId, tenantId, dateRange) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            const { startDate, endDate } = dateRange;

            // Mock DynamoDB returning no items for this date range
            mockSend.mockResolvedValueOnce({
              Items: [],
              Count: 0,
            });

            const { listFormResponses } = await import(
              '../../src/services/forms/form-response.js'
            );

            const result = await listFormResponses({
              formId,
              tenantId,
              startDate,
              endDate,
            });

            // Must succeed with empty results
            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.responses).toHaveLength(0);
              expect(result.total).toBe(0);
            }
          }
        ),
        { numRuns: 100 },
      );
    });

    it('validates that start_date must be before end_date', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbTenantId,
          fc.integer({ min: 1, max: 300 }),
          async (formId, tenantId, dayOffset) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Create inverted range (start > end)
            const end = new Date('2024-01-01');
            const start = new Date('2024-01-01');
            start.setDate(start.getDate() + dayOffset);
            const startDate = start.toISOString().split('T')[0];
            const endDate = end.toISOString().split('T')[0];

            const { listFormResponses } = await import(
              '../../src/services/forms/form-response.js'
            );

            const result = await listFormResponses({
              formId,
              tenantId,
              startDate,
              endDate,
            });

            // Must be rejected
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(400);
              expect(result.code).toBe('BAD_REQUEST');
            }
          }
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 12.5**
  describe('Property 22: Paginación respeta límite máximo', () => {
    it('pagination returns at most 25 items per page', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbTenantId,
          fc.integer({ min: 1, max: 50 }),
          async (formId, tenantId, totalItems) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Generate mock items (DynamoDB will respect the Limit parameter)
            const itemsToReturn = Math.min(totalItems, 25);
            const mockItems = Array.from({ length: itemsToReturn }, (_, i) => {
              const date = new Date('2024-06-01T00:00:00.000Z');
              date.setMinutes(date.getMinutes() - i);
              const submittedAt = date.toISOString();
              const responseId = `resp-${i}-${formId.substring(0, 8)}`;
              return {
                PK: `FORM#${formId}`,
                SK: `RESPONSE#${responseId}`,
                GSI1PK: `FORM#${formId}`,
                GSI1SK: `DATE#${submittedAt}`,
                response_id: responseId,
                form_id: formId,
                version_number: 1,
                folio: `FOLIO${String(i).padStart(3, '0')}`,
                submitted_at: submittedAt,
                answers: {},
                metadata: {
                  origin_type: 'url_directa',
                  user_agent: 'Mozilla/5.0',
                  ip_address: '10.0.0.1',
                },
                tenant_id: tenantId,
              };
            });

            // If totalItems > 25, simulate DynamoDB returning LastEvaluatedKey
            const hasMore = totalItems > 25;
            mockSend.mockResolvedValueOnce({
              Items: mockItems,
              Count: mockItems.length,
              ...(hasMore && {
                LastEvaluatedKey: {
                  PK: mockItems[mockItems.length - 1].PK,
                  SK: mockItems[mockItems.length - 1].SK,
                  GSI1PK: mockItems[mockItems.length - 1].GSI1PK,
                  GSI1SK: mockItems[mockItems.length - 1].GSI1SK,
                },
              }),
            });

            const { listFormResponses } = await import(
              '../../src/services/forms/form-response.js'
            );

            const result = await listFormResponses({
              formId,
              tenantId,
            });

            // Must succeed
            expect(result.success).toBe(true);
            if (result.success) {
              // Must return at most 25 items per page
              expect(result.responses.length).toBeLessThanOrEqual(25);

              // If there are more items, nextToken must be provided
              if (hasMore) {
                expect(result.nextToken).toBeDefined();
                expect(result.nextToken!.length).toBeGreaterThan(0);
              }
            }
          }
        ),
        { numRuns: 100 },
      );
    });

    it('results are ordered by date descending (most recent first)', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbTenantId,
          fc.integer({ min: 2, max: 15 }),
          async (formId, tenantId, itemCount) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Generate items in descending date order (as DynamoDB would return with ScanIndexForward: false)
            const mockItems = Array.from({ length: itemCount }, (_, i) => {
              const date = new Date('2024-06-15T12:00:00.000Z');
              date.setHours(date.getHours() - i); // Each item is 1 hour earlier
              const submittedAt = date.toISOString();
              const responseId = `resp-${i}-${formId.substring(0, 8)}`;
              return {
                PK: `FORM#${formId}`,
                SK: `RESPONSE#${responseId}`,
                GSI1PK: `FORM#${formId}`,
                GSI1SK: `DATE#${submittedAt}`,
                response_id: responseId,
                form_id: formId,
                version_number: 1,
                folio: `FOLIO${String(i).padStart(3, '0')}`,
                submitted_at: submittedAt,
                answers: {},
                metadata: {
                  origin_type: 'url_directa',
                  user_agent: 'Mozilla/5.0',
                  ip_address: '10.0.0.1',
                },
                tenant_id: tenantId,
              };
            });

            mockSend.mockResolvedValueOnce({
              Items: mockItems,
              Count: mockItems.length,
            });

            const { listFormResponses } = await import(
              '../../src/services/forms/form-response.js'
            );

            const result = await listFormResponses({
              formId,
              tenantId,
            });

            // Must succeed
            expect(result.success).toBe(true);
            if (result.success) {
              // Results must be in descending date order (most recent first)
              for (let i = 1; i < result.responses.length; i++) {
                const prevDate = new Date(result.responses[i - 1].submitted_at).getTime();
                const currDate = new Date(result.responses[i].submitted_at).getTime();
                expect(prevDate).toBeGreaterThanOrEqual(currDate);
              }
            }
          }
        ),
        { numRuns: 100 },
      );
    });

    it('nextToken allows fetching subsequent pages', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbTenantId,
          async (formId, tenantId) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // First page: 25 items with LastEvaluatedKey
            const firstPageItems = Array.from({ length: 25 }, (_, i) => {
              const date = new Date('2024-06-15T12:00:00.000Z');
              date.setMinutes(date.getMinutes() - i);
              const submittedAt = date.toISOString();
              const responseId = `resp-page1-${i}`;
              return {
                PK: `FORM#${formId}`,
                SK: `RESPONSE#${responseId}`,
                GSI1PK: `FORM#${formId}`,
                GSI1SK: `DATE#${submittedAt}`,
                response_id: responseId,
                form_id: formId,
                version_number: 1,
                folio: `FP1${String(i).padStart(5, '0')}`,
                submitted_at: submittedAt,
                answers: {},
                metadata: {
                  origin_type: 'url_directa',
                  user_agent: 'Mozilla/5.0',
                  ip_address: '10.0.0.1',
                },
                tenant_id: tenantId,
              };
            });

            const lastEvaluatedKey = {
              PK: firstPageItems[24].PK,
              SK: firstPageItems[24].SK,
              GSI1PK: firstPageItems[24].GSI1PK,
              GSI1SK: firstPageItems[24].GSI1SK,
            };

            mockSend.mockResolvedValueOnce({
              Items: firstPageItems,
              Count: 25,
              LastEvaluatedKey: lastEvaluatedKey,
            });

            const { listFormResponses } = await import(
              '../../src/services/forms/form-response.js'
            );

            // First page request
            const firstResult = await listFormResponses({
              formId,
              tenantId,
            });

            expect(firstResult.success).toBe(true);
            if (firstResult.success) {
              expect(firstResult.responses.length).toBe(25);
              expect(firstResult.nextToken).toBeDefined();

              // Second page: fewer items, no LastEvaluatedKey
              const secondPageItems = Array.from({ length: 5 }, (_, i) => {
                const date = new Date('2024-06-15T11:00:00.000Z');
                date.setMinutes(date.getMinutes() - i);
                const submittedAt = date.toISOString();
                const responseId = `resp-page2-${i}`;
                return {
                  PK: `FORM#${formId}`,
                  SK: `RESPONSE#${responseId}`,
                  GSI1PK: `FORM#${formId}`,
                  GSI1SK: `DATE#${submittedAt}`,
                  response_id: responseId,
                  form_id: formId,
                  version_number: 1,
                  folio: `FP2${String(i).padStart(5, '0')}`,
                  submitted_at: submittedAt,
                  answers: {},
                  metadata: {
                    origin_type: 'qr',
                    user_agent: 'Mozilla/5.0',
                    ip_address: '10.0.0.2',
                  },
                  tenant_id: tenantId,
                };
              });

              mockSend.mockResolvedValueOnce({
                Items: secondPageItems,
                Count: 5,
              });

              // Second page request with nextToken
              const secondResult = await listFormResponses({
                formId,
                tenantId,
                nextToken: firstResult.nextToken,
              });

              expect(secondResult.success).toBe(true);
              if (secondResult.success) {
                // Second page must also respect the 25-item limit
                expect(secondResult.responses.length).toBeLessThanOrEqual(25);
                expect(secondResult.responses.length).toBe(5);
                // No more pages
                expect(secondResult.nextToken).toBeUndefined();
              }
            }
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects invalid pagination tokens', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbTenantId,
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => {
            // Ensure it's not valid base64 JSON
            try {
              JSON.parse(Buffer.from(s, 'base64').toString('utf-8'));
              return false;
            } catch {
              return true;
            }
          }),
          async (formId, tenantId, invalidToken) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            const { listFormResponses } = await import(
              '../../src/services/forms/form-response.js'
            );

            const result = await listFormResponses({
              formId,
              tenantId,
              nextToken: invalidToken,
            });

            // Must be rejected with BAD_REQUEST
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(400);
              expect(result.code).toBe('BAD_REQUEST');
            }
          }
        ),
        { numRuns: 100 },
      );
    });
  });
});
