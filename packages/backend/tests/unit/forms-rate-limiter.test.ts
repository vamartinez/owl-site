/**
 * Unit tests for the rate limiter module.
 * Tests sliding window behavior, atomic counting, and TTL-based cleanup.
 *
 * Requirements: 15.1, 15.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    UpdateCommand: vi.fn().mockImplementation((params) => ({ input: params })),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

describe('forms: rate limiter (checkRateLimit)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  it('allows the first request and creates a new window', async () => {
    // GetCommand returns no existing record
    mockSend
      .mockResolvedValueOnce({ Item: undefined }) // GetCommand: no record
      .mockResolvedValueOnce({}); // UpdateCommand: create new window

    const { checkRateLimit } = await import('../../src/services/forms/rate-limiter.js');
    const result = await checkRateLimit('form-123', '192.168.1.1');

    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBeUndefined();

    // Verify UpdateCommand was called to create a new window
    const updateCall = mockSend.mock.calls[1]![0];
    expect(updateCall.input.Key.PK).toBe('RATELIMIT#FORM#form-123');
    expect(updateCall.input.Key.SK).toBe('IP#192.168.1.1');
    expect(updateCall.input.ExpressionAttributeValues[':one']).toBe(1);
    expect(updateCall.input.ExpressionAttributeValues[':expiresAt']).toBeDefined();
  });

  it('allows requests within the window when under the limit', async () => {
    const windowStart = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

    // GetCommand returns existing record with count < 10
    mockSend
      .mockResolvedValueOnce({
        Item: { count: 5, window_start: windowStart },
      }) // GetCommand: existing record
      .mockResolvedValueOnce({ Attributes: { count: 6 } }); // UpdateCommand: increment

    const { checkRateLimit } = await import('../../src/services/forms/rate-limiter.js');
    const result = await checkRateLimit('form-123', '192.168.1.1');

    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it('rejects requests when count reaches the limit', async () => {
    const windowStart = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

    // GetCommand returns existing record at the limit
    mockSend.mockResolvedValueOnce({
      Item: { count: 10, window_start: windowStart },
    });

    const { checkRateLimit } = await import('../../src/services/forms/rate-limiter.js');
    const result = await checkRateLimit('form-123', '192.168.1.1');

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(240); // max ~4 minutes remaining
  });

  it('returns correct retryAfterSeconds based on window remaining time', async () => {
    // Window started 3 minutes ago → ~2 minutes remaining
    const windowStart = new Date(Date.now() - 3 * 60 * 1000).toISOString();

    mockSend.mockResolvedValueOnce({
      Item: { count: 10, window_start: windowStart },
    });

    const { checkRateLimit } = await import('../../src/services/forms/rate-limiter.js');
    const result = await checkRateLimit('form-123', '10.0.0.1');

    expect(result.allowed).toBe(false);
    // Should be approximately 120 seconds (2 minutes remaining)
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(118);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(122);
  });

  it('starts a new window when the previous window has expired', async () => {
    // Window started 6 minutes ago (expired)
    const windowStart = new Date(Date.now() - 6 * 60 * 1000).toISOString();

    mockSend
      .mockResolvedValueOnce({
        Item: { count: 10, window_start: windowStart },
      }) // GetCommand: expired record
      .mockResolvedValueOnce({}); // UpdateCommand: create new window

    const { checkRateLimit } = await import('../../src/services/forms/rate-limiter.js');
    const result = await checkRateLimit('form-123', '192.168.1.1');

    expect(result.allowed).toBe(true);

    // Verify a new window was created (SET operation, not ADD)
    const updateCall = mockSend.mock.calls[1]![0];
    expect(updateCall.input.UpdateExpression).toContain('SET');
    expect(updateCall.input.ExpressionAttributeValues[':one']).toBe(1);
  });

  it('handles race condition where count exceeds limit after increment', async () => {
    const windowStart = new Date(Date.now() - 60000).toISOString();

    mockSend
      .mockResolvedValueOnce({
        Item: { count: 9, window_start: windowStart },
      }) // GetCommand: at 9 (under limit)
      .mockResolvedValueOnce({ Attributes: { count: 11 } }); // UpdateCommand: race condition, now at 11

    const { checkRateLimit } = await import('../../src/services/forms/rate-limiter.js');
    const result = await checkRateLimit('form-123', '192.168.1.1');

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('uses correct PK/SK format for DynamoDB keys', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    const { checkRateLimit } = await import('../../src/services/forms/rate-limiter.js');
    await checkRateLimit('my-form-id', '10.20.30.40');

    // Verify GetCommand key format
    const getCall = mockSend.mock.calls[0]![0];
    expect(getCall.input.Key.PK).toBe('RATELIMIT#FORM#my-form-id');
    expect(getCall.input.Key.SK).toBe('IP#10.20.30.40');
  });

  it('sets TTL (expiresAt) to 5 minutes from window start', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    const { checkRateLimit } = await import('../../src/services/forms/rate-limiter.js');
    const beforeTime = Math.floor(Date.now() / 1000);
    await checkRateLimit('form-123', '192.168.1.1');
    const afterTime = Math.floor(Date.now() / 1000);

    const updateCall = mockSend.mock.calls[1]![0];
    const expiresAt = updateCall.input.ExpressionAttributeValues[':expiresAt'];

    // expiresAt should be approximately now + 300 seconds
    expect(expiresAt).toBeGreaterThanOrEqual(beforeTime + 300);
    expect(expiresAt).toBeLessThanOrEqual(afterTime + 300);
  });

  it('isolates rate limits per form (different form IDs)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    const { checkRateLimit } = await import('../../src/services/forms/rate-limiter.js');
    await checkRateLimit('form-A', '192.168.1.1');

    const getCall = mockSend.mock.calls[0]![0];
    expect(getCall.input.Key.PK).toBe('RATELIMIT#FORM#form-A');
  });

  it('isolates rate limits per IP (different IPs)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    const { checkRateLimit } = await import('../../src/services/forms/rate-limiter.js');
    await checkRateLimit('form-123', '10.0.0.99');

    const getCall = mockSend.mock.calls[0]![0];
    expect(getCall.input.Key.SK).toBe('IP#10.0.0.99');
  });
});
