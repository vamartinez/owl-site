// Feature: contractor-forms-qr, Property 27: Rate limiting por IP y formulario

/**
 * Property-based tests for the Forms Rate Limiter Module.
 *
 * Property 27: For any IP address and form combination, the system must allow
 * exactly 10 requests within a 5-minute window and reject subsequent requests
 * with a retry_after_seconds value.
 *
 * **Validates: Requirements 15.1**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    UpdateCommand: vi.fn().mockImplementation((params) => params),
    GetCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid IPv4 addresses */
const arbIpAddress = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 })
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Arbitrary for form IDs (UUID-like) */
const arbFormId = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 8,
    maxLength: 36,
  })
  .map((id) => `form-${id}`);

/** Arbitrary for request count within the allowed limit (1-10) */
const arbAllowedCount = fc.integer({ min: 0, max: 9 });

/** Arbitrary for request count at or above the limit (10+) */
const arbExceededCount = fc.integer({ min: 10, max: 100 });

/** Arbitrary for a window start time within the last 5 minutes */
const arbRecentWindowStart = fc.integer({ min: 1, max: 299 }).map((secondsAgo) => {
  const now = Date.now();
  return new Date(now - secondsAgo * 1000).toISOString();
});

/** Arbitrary for an expired window start time (more than 5 minutes ago) */
const arbExpiredWindowStart = fc.integer({ min: 301, max: 600 }).map((secondsAgo) => {
  const now = Date.now();
  return new Date(now - secondsAgo * 1000).toISOString();
});

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Forms Rate Limiter Property Tests', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 15.1**
  describe('Property 27: Rate limiting por IP y formulario', () => {
    it('allows requests when count is below the limit of 10 within the window', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbIpAddress,
          arbAllowedCount,
          arbRecentWindowStart,
          async (formId, ipAddress, currentCount, windowStart) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Mock GetCommand: return existing record with count below limit
            mockSend.mockResolvedValueOnce({
              Item: {
                PK: `RATELIMIT#FORM#${formId}`,
                SK: `IP#${ipAddress}`,
                count: currentCount,
                window_start: windowStart,
                expiresAt: Math.floor(new Date(windowStart).getTime() / 1000) + 300,
              },
            });

            // Mock UpdateCommand: return incremented count
            mockSend.mockResolvedValueOnce({
              Attributes: { count: currentCount + 1 },
            });

            const { checkRateLimit } = await import(
              '../../src/services/forms/rate-limiter.js'
            );

            const result = await checkRateLimit(formId, ipAddress);

            // Must be allowed since count < 10
            expect(result.allowed).toBe(true);
            expect(result.retryAfterSeconds).toBeUndefined();
          }
        ),
        { numRuns: 100 },
      );
    });

    it('rejects requests when count has reached the limit of 10 within the window', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbIpAddress,
          arbExceededCount,
          arbRecentWindowStart,
          async (formId, ipAddress, currentCount, windowStart) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Mock GetCommand: return existing record with count at or above limit
            mockSend.mockResolvedValueOnce({
              Item: {
                PK: `RATELIMIT#FORM#${formId}`,
                SK: `IP#${ipAddress}`,
                count: currentCount,
                window_start: windowStart,
                expiresAt: Math.floor(new Date(windowStart).getTime() / 1000) + 300,
              },
            });

            const { checkRateLimit } = await import(
              '../../src/services/forms/rate-limiter.js'
            );

            const result = await checkRateLimit(formId, ipAddress);

            // Must be rejected since count >= 10
            expect(result.allowed).toBe(false);

            // Must include retry_after_seconds as a positive number
            expect(result.retryAfterSeconds).toBeDefined();
            expect(result.retryAfterSeconds).toBeGreaterThan(0);

            // retry_after_seconds must not exceed the window duration (300 seconds)
            expect(result.retryAfterSeconds).toBeLessThanOrEqual(300);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('allows the first request for any new IP/form combination (no existing record)', async () => {
      await fc.assert(
        fc.asyncProperty(arbFormId, arbIpAddress, async (formId, ipAddress) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          // Mock GetCommand: no existing record
          mockSend.mockResolvedValueOnce({ Item: undefined });

          // Mock UpdateCommand: set initial count
          mockSend.mockResolvedValueOnce({});

          const { checkRateLimit } = await import(
            '../../src/services/forms/rate-limiter.js'
          );

          const result = await checkRateLimit(formId, ipAddress);

          // First request must always be allowed
          expect(result.allowed).toBe(true);
          expect(result.retryAfterSeconds).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });

    it('resets the window and allows requests when the previous window has expired', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbIpAddress,
          arbExceededCount,
          arbExpiredWindowStart,
          async (formId, ipAddress, previousCount, expiredWindowStart) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Mock GetCommand: return record with expired window
            mockSend.mockResolvedValueOnce({
              Item: {
                PK: `RATELIMIT#FORM#${formId}`,
                SK: `IP#${ipAddress}`,
                count: previousCount,
                window_start: expiredWindowStart,
                expiresAt:
                  Math.floor(new Date(expiredWindowStart).getTime() / 1000) + 300,
              },
            });

            // Mock UpdateCommand: reset window
            mockSend.mockResolvedValueOnce({});

            const { checkRateLimit } = await import(
              '../../src/services/forms/rate-limiter.js'
            );

            const result = await checkRateLimit(formId, ipAddress);

            // Must be allowed since the window has expired (new window starts)
            expect(result.allowed).toBe(true);
            expect(result.retryAfterSeconds).toBeUndefined();
          }
        ),
        { numRuns: 100 },
      );
    });

    it('different form IDs are rate-limited independently for the same IP', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbFormId,
          arbIpAddress,
          arbRecentWindowStart,
          async (formId1, formId2, ipAddress, windowStart) => {
            // Skip if both form IDs are the same
            fc.pre(formId1 !== formId2);

            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // First form: at limit (should reject)
            mockSend.mockResolvedValueOnce({
              Item: {
                PK: `RATELIMIT#FORM#${formId1}`,
                SK: `IP#${ipAddress}`,
                count: 10,
                window_start: windowStart,
                expiresAt: Math.floor(new Date(windowStart).getTime() / 1000) + 300,
              },
            });

            const { checkRateLimit } = await import(
              '../../src/services/forms/rate-limiter.js'
            );

            const result1 = await checkRateLimit(formId1, ipAddress);
            expect(result1.allowed).toBe(false);

            // Reset mocks for second call
            mockSend.mockReset();

            // Second form: no record (should allow)
            mockSend.mockResolvedValueOnce({ Item: undefined });
            mockSend.mockResolvedValueOnce({});

            const result2 = await checkRateLimit(formId2, ipAddress);
            expect(result2.allowed).toBe(true);
          }
        ),
        { numRuns: 100 },
      );
    });

    it('different IPs are rate-limited independently for the same form', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbIpAddress,
          arbIpAddress,
          arbRecentWindowStart,
          async (formId, ip1, ip2, windowStart) => {
            // Skip if both IPs are the same
            fc.pre(ip1 !== ip2);

            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // First IP: at limit (should reject)
            mockSend.mockResolvedValueOnce({
              Item: {
                PK: `RATELIMIT#FORM#${formId}`,
                SK: `IP#${ip1}`,
                count: 10,
                window_start: windowStart,
                expiresAt: Math.floor(new Date(windowStart).getTime() / 1000) + 300,
              },
            });

            const { checkRateLimit } = await import(
              '../../src/services/forms/rate-limiter.js'
            );

            const result1 = await checkRateLimit(formId, ip1);
            expect(result1.allowed).toBe(false);

            // Reset mocks for second call
            mockSend.mockReset();

            // Second IP: no record (should allow)
            mockSend.mockResolvedValueOnce({ Item: undefined });
            mockSend.mockResolvedValueOnce({});

            const result2 = await checkRateLimit(formId, ip2);
            expect(result2.allowed).toBe(true);
          }
        ),
        { numRuns: 100 },
      );
    });
  });
});
