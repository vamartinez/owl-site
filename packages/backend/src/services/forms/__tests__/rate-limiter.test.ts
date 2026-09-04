/**
 * Unit tests for the Forms Service rate-limiter module.
 * Validates: Requirements 7.6
 *
 * Verifies:
 * - Requests exceeding the threshold are rejected with retry_after_seconds
 * - Requests within the threshold are allowed
 * - New windows are started when no record exists or window expired
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo';

// Mock the dynamo-client module to use our test mock
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

import { checkRateLimit } from '../rate-limiter.js';
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from '../types.js';

describe('Rate Limiter Module', () => {
  const updateCapture: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    resetDynamoMock();
    updateCapture.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('threshold exceeded → rejection with retry_after_seconds', () => {
    it('rejects when count equals RATE_LIMIT_MAX_REQUESTS within the window', async () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      const windowStart = new Date('2024-06-15T09:57:00.000Z').toISOString(); // 3 minutes ago

      const getResponses = new Map<string, Record<string, unknown>>();
      const key = JSON.stringify({
        PK: 'RATELIMIT#FORM#form-123',
        SK: 'IP#192.168.1.1',
      });
      getResponses.set(key, {
        PK: 'RATELIMIT#FORM#form-123',
        SK: 'IP#192.168.1.1',
        count: RATE_LIMIT_MAX_REQUESTS, // Already at max (10)
        window_start: windowStart,
      });

      setupDynamoMock({ getResponses, updateCapture });

      const result = await checkRateLimit('form-123', '192.168.1.1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeDefined();
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('rejects when count exceeds RATE_LIMIT_MAX_REQUESTS within the window', async () => {
      const windowStart = new Date('2024-06-15T09:58:00.000Z').toISOString(); // 2 minutes ago

      const getResponses = new Map<string, Record<string, unknown>>();
      const key = JSON.stringify({
        PK: 'RATELIMIT#FORM#form-456',
        SK: 'IP#10.0.0.1',
      });
      getResponses.set(key, {
        PK: 'RATELIMIT#FORM#form-456',
        SK: 'IP#10.0.0.1',
        count: RATE_LIMIT_MAX_REQUESTS + 5, // Exceeds max
        window_start: windowStart,
      });

      setupDynamoMock({ getResponses, updateCapture });

      const result = await checkRateLimit('form-456', '10.0.0.1');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeDefined();
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('returns correct retry_after_seconds based on remaining window time', async () => {
      // Window started 3 minutes ago, so 2 minutes remain (5 min window - 3 min elapsed = 2 min)
      const windowStart = new Date('2024-06-15T09:57:00.000Z').toISOString();

      const getResponses = new Map<string, Record<string, unknown>>();
      const key = JSON.stringify({
        PK: 'RATELIMIT#FORM#form-789',
        SK: 'IP#172.16.0.1',
      });
      getResponses.set(key, {
        PK: 'RATELIMIT#FORM#form-789',
        SK: 'IP#172.16.0.1',
        count: RATE_LIMIT_MAX_REQUESTS,
        window_start: windowStart,
      });

      setupDynamoMock({ getResponses, updateCapture });

      const result = await checkRateLimit('form-789', '172.16.0.1');

      expect(result.allowed).toBe(false);
      // Window started at 09:57, ends at 10:02 (5 min window), now is 10:00
      // Remaining: 2 minutes = 120 seconds
      expect(result.retryAfterSeconds).toBe(120);
    });

    it('does not issue an UpdateCommand when already at limit', async () => {
      const windowStart = new Date('2024-06-15T09:58:00.000Z').toISOString();

      const getResponses = new Map<string, Record<string, unknown>>();
      const key = JSON.stringify({
        PK: 'RATELIMIT#FORM#form-no-update',
        SK: 'IP#192.168.0.50',
      });
      getResponses.set(key, {
        PK: 'RATELIMIT#FORM#form-no-update',
        SK: 'IP#192.168.0.50',
        count: RATE_LIMIT_MAX_REQUESTS,
        window_start: windowStart,
      });

      setupDynamoMock({ getResponses, updateCapture });

      await checkRateLimit('form-no-update', '192.168.0.50');

      const calls = getDynamoCalls();
      // Should only have the GetCommand, no UpdateCommand since already at limit
      const updateCalls = calls.filter((c) => c.command === 'UpdateCommand');
      expect(updateCalls).toHaveLength(0);
    });

    it('rejects with retry_after_seconds when race condition causes count > max after increment', async () => {
      const windowStart = new Date('2024-06-15T09:58:00.000Z').toISOString();

      const getResponses = new Map<string, Record<string, unknown>>();
      const key = JSON.stringify({
        PK: 'RATELIMIT#FORM#form-race',
        SK: 'IP#10.10.10.10',
      });
      // count is 9 (below max of 10), so it will attempt an increment
      getResponses.set(key, {
        PK: 'RATELIMIT#FORM#form-race',
        SK: 'IP#10.10.10.10',
        count: RATE_LIMIT_MAX_REQUESTS - 1,
        window_start: windowStart,
      });

      // Override the mock send to simulate the race condition:
      // The UpdateCommand returns a count > RATE_LIMIT_MAX_REQUESTS
      const mockSend = getMockSend();
      mockSend.mockImplementation((command: unknown) => {
        const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
        const commandName = cmd.constructor?.name ?? 'UnknownCommand';

        if (commandName === 'GetCommand') {
          return Promise.resolve({
            Item: getResponses.get(key),
          });
        }

        if (commandName === 'UpdateCommand') {
          // Simulate race: count jumped past max
          return Promise.resolve({
            Attributes: { count: RATE_LIMIT_MAX_REQUESTS + 1 },
          });
        }

        return Promise.resolve({});
      });

      const result = await checkRateLimit('form-race', '10.10.10.10');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeDefined();
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe('requests within threshold are allowed', () => {
    it('allows when count is below RATE_LIMIT_MAX_REQUESTS', async () => {
      const windowStart = new Date('2024-06-15T09:58:00.000Z').toISOString();

      const getResponses = new Map<string, Record<string, unknown>>();
      const key = JSON.stringify({
        PK: 'RATELIMIT#FORM#form-ok',
        SK: 'IP#192.168.1.100',
      });
      getResponses.set(key, {
        PK: 'RATELIMIT#FORM#form-ok',
        SK: 'IP#192.168.1.100',
        count: 5, // Below max of 10
        window_start: windowStart,
      });

      // Mock the UpdateCommand to return count below max
      const mockSend = getMockSend();
      mockSend.mockReset();
      mockSend.mockImplementation((command: unknown) => {
        const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
        const commandName = cmd.constructor?.name ?? 'UnknownCommand';

        if (commandName === 'GetCommand') {
          return Promise.resolve({ Item: getResponses.get(key) });
        }

        if (commandName === 'UpdateCommand') {
          return Promise.resolve({ Attributes: { count: 6 } });
        }

        return Promise.resolve({});
      });

      const result = await checkRateLimit('form-ok', '192.168.1.100');

      expect(result.allowed).toBe(true);
      expect(result.retryAfterSeconds).toBeUndefined();
    });

    it('allows the first request when no existing record', async () => {
      // Reset mock to default behavior after custom implementations
      resetDynamoMock();
      updateCapture.length = 0;
      const getResponses = new Map<string, Record<string, unknown>>();
      // No entry in getResponses → GetCommand returns undefined Item

      setupDynamoMock({ getResponses, updateCapture });

      const result = await checkRateLimit('new-form', '192.168.1.200');

      expect(result.allowed).toBe(true);
      expect(result.retryAfterSeconds).toBeUndefined();
    });

    it('starts a new window when existing window has expired', async () => {
      // Reset mock to default behavior
      resetDynamoMock();
      updateCapture.length = 0;

      // Window started 6 minutes ago (expired, since window is 5 minutes)
      const expiredWindowStart = new Date('2024-06-15T09:54:00.000Z').toISOString();

      const getResponses = new Map<string, Record<string, unknown>>();
      const key = JSON.stringify({
        PK: 'RATELIMIT#FORM#form-expired',
        SK: 'IP#192.168.1.50',
      });
      getResponses.set(key, {
        PK: 'RATELIMIT#FORM#form-expired',
        SK: 'IP#192.168.1.50',
        count: RATE_LIMIT_MAX_REQUESTS, // Was at max, but window expired
        window_start: expiredWindowStart,
      });

      setupDynamoMock({ getResponses, updateCapture });

      const result = await checkRateLimit('form-expired', '192.168.1.50');

      expect(result.allowed).toBe(true);
      expect(result.retryAfterSeconds).toBeUndefined();

      // Should have issued an UpdateCommand to reset the window
      const calls = getDynamoCalls();
      const updateCalls = calls.filter((c) => c.command === 'UpdateCommand');
      expect(updateCalls).toHaveLength(1);

      const updateInput = updateCalls[0].input as Record<string, unknown>;
      const exprValues = updateInput.ExpressionAttributeValues as Record<string, unknown>;
      expect(exprValues[':one']).toBe(1); // Reset count to 1
    });
  });

  describe('DynamoDB key construction', () => {
    it('constructs PK as RATELIMIT#FORM#<formId>', async () => {
      resetDynamoMock();
      updateCapture.length = 0;
      setupDynamoMock({ updateCapture });

      await checkRateLimit('my-form-id', '10.0.0.1');

      const calls = getDynamoCalls();
      const getCall = calls.find((c) => c.command === 'GetCommand');
      expect(getCall).toBeDefined();

      const input = getCall!.input as Record<string, unknown>;
      const key = input.Key as Record<string, string>;
      expect(key.PK).toBe('RATELIMIT#FORM#my-form-id');
    });

    it('constructs SK as IP#<ipAddress>', async () => {
      resetDynamoMock();
      updateCapture.length = 0;
      setupDynamoMock({ updateCapture });

      await checkRateLimit('form-abc', '203.0.113.42');

      const calls = getDynamoCalls();
      const getCall = calls.find((c) => c.command === 'GetCommand');
      expect(getCall).toBeDefined();

      const input = getCall!.input as Record<string, unknown>;
      const key = input.Key as Record<string, string>;
      expect(key.SK).toBe('IP#203.0.113.42');
    });

    it('uses the RateLimits table name', async () => {
      resetDynamoMock();
      updateCapture.length = 0;
      setupDynamoMock({ updateCapture });

      await checkRateLimit('form-tbl', '10.0.0.2');

      const calls = getDynamoCalls();
      const getCall = calls.find((c) => c.command === 'GetCommand');
      expect(getCall).toBeDefined();
      const input = getCall!.input as Record<string, unknown>;
      expect(input.TableName).toBe('test-RateLimits');
    });
  });
});
