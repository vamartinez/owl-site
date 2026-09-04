/**
 * Unit tests for the revalidation module (POST /access/revalidate).
 * Validates: Requirements 5.5
 *
 * Tests that an existing access decision is re-evaluated against current policies
 * and produces an updated decision result. Verifies:
 * - Decision re-evaluation invokes evaluateDecision with revalidation context
 * - Revalidation attempt is persisted with correct fields
 * - Max 3 attempts per original decision per 24h is enforced
 * - Updated decision result is returned in the response
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo.js';
import { createMockClaims } from '../../../../tests/helpers/mock-user.js';
import { createMockEvent } from '../../../../tests/helpers/mock-event.js';

// Mock the dynamo-client module
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock the auth-middleware to return a valid user from claims
vi.mock('../../../shared/auth-middleware.js', () => ({
  authenticateRequest: vi.fn((event: Record<string, unknown>) => {
    const reqCtx = event['requestContext'] as { authorizer?: { claims?: Record<string, string> } } | undefined;
    const claims = reqCtx?.authorizer?.claims;
    if (!claims || !claims['sub']) {
      return { error: { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' }) } };
    }
    return {
      user: {
        user_id: claims['sub'],
        tenant_id: claims['custom:tenant_id'] || 'tenant-test',
        role: claims['custom:role'] || 'tenant_admin',
      },
    };
  }),
}));

// Mock the rbac module — gate_operator doesn't have access:request
vi.mock('../../../shared/rbac.js', () => ({
  enforcePermission: vi.fn((user: { role: string }, permission: string) => {
    // gate_operator has access:request per the RBAC matrix
    // worker has access:request per the RBAC matrix
    // All roles that DON'T have access:request: none here — only restrict if no match
    const rolesWithAccessRequest = ['platform_admin', 'tenant_admin', 'gate_operator', 'worker'];
    if (permission === 'access:request' && rolesWithAccessRequest.includes(user.role)) {
      return null;
    }
    if (permission === 'access:request' && !rolesWithAccessRequest.includes(user.role)) {
      return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'FORBIDDEN', message: 'You do not have permission to perform this action' }) };
    }
    return null;
  }),
}));

// Mock the event-publisher
vi.mock('../../../shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock the decision engine evaluator
const mockEvaluateDecision = vi.fn();
vi.mock('../../decision-engine/evaluator.js', () => ({
  evaluateDecision: (...args: unknown[]) => mockEvaluateDecision(...args),
}));

// Mock token-manager (needed by handler for other routes)
vi.mock('../token-manager.js', () => ({
  generateToken: vi.fn(),
  getToken: vi.fn(),
  validateToken: vi.fn(),
  markTokenUsed: vi.fn(),
  revokeToken: vi.fn(),
}));

// Mock scan-session
vi.mock('../scan-session.js', () => ({
  recordScanSession: vi.fn(),
  detectReplay: vi.fn(),
}));

// Mock filter-utils
vi.mock('../../../shared/filter-utils.js', () => ({
  buildFilterExpression: vi.fn(),
}));

// Mock uuid to produce predictable IDs
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => {
    uuidCounter++;
    return `mock-uuid-${uuidCounter}`;
  },
}));

import { handler } from '../handler.js';

describe('Revalidation Module — POST /access/revalidate', () => {
  const tenantId = 'tenant-test';
  const userId = 'user-test-1';
  const originalDecisionId = '11111111-1111-1111-1111-111111111111';
  const workerId = '22222222-2222-2222-2222-222222222222';
  const siteId = '33333333-3333-3333-3333-333333333333';

  const validBody = {
    original_decision_id: originalDecisionId,
    worker_id: workerId,
    site_id: siteId,
  };

  const claims = createMockClaims({
    user_id: userId,
    tenant_id: tenantId,
    role: 'tenant_admin',
  });

  function createRevalidateEvent(body?: unknown) {
    return createMockEvent({
      httpMethod: 'POST',
      resource: '/access/revalidate',
      body: body ?? validBody,
      claims,
    });
  }

  beforeEach(() => {
    resetDynamoMock();
    mockEvaluateDecision.mockReset();
    uuidCounter = 0;
  });

  describe('Decision re-evaluation against current policies', () => {
    it('calls evaluateDecision with revalidation context when attempts are under the limit', async () => {
      // No prior attempts
      const queryKey = JSON.stringify({
        TableName: 'test-RevalidationAttempts',
        IndexName: undefined,
        ExpressionAttributeValues: expect.any(Object),
      });

      // Setup: query returns 0 attempts
      setupDynamoMock({
        queryResponses: new Map(),
        putCapture: [],
      });

      mockEvaluateDecision.mockResolvedValue({
        response: {
          decision: 'allowed',
          decision_id: 'new-decision-id-from-engine',
          reasons: ['All certifications valid'],
        },
      });

      const event = createRevalidateEvent();
      const response = await handler(event as never);

      expect(response.statusCode).toBe(200);
      expect(mockEvaluateDecision).toHaveBeenCalledTimes(1);

      const evalCall = mockEvaluateDecision.mock.calls[0];
      const request = evalCall[0];
      expect(request.context.revalidation).toBe(true);
      expect(request.context.original_decision_id).toBe(originalDecisionId);
      expect(request.subject_id).toBe(workerId);
      expect(request.site_id).toBe(siteId);
    });

    it('returns the new decision result from the evaluation', async () => {
      setupDynamoMock({
        queryResponses: new Map(),
        putCapture: [],
      });

      mockEvaluateDecision.mockResolvedValue({
        response: {
          decision: 'allowed',
          decision_id: 'new-dec-allowed',
          reasons: ['Certification renewed'],
        },
      });

      const event = createRevalidateEvent();
      const response = await handler(event as never);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.new_result).toBe('allowed');
      expect(body.new_decision_id).toBe('new-dec-allowed');
      expect(body.reasons).toContain('Certification renewed');
      expect(body.original_decision_id).toBe(originalDecisionId);
    });

    it('returns denied with error reason when evaluateDecision returns an error', async () => {
      setupDynamoMock({
        queryResponses: new Map(),
        putCapture: [],
      });

      mockEvaluateDecision.mockResolvedValue({
        error: {
          code: 'INCOMPLETE_INPUT',
          message: 'Missing required inputs: certifications',
        },
      });

      const event = createRevalidateEvent();
      const response = await handler(event as never);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.new_result).toBe('denied');
      expect(body.reasons).toContain('Missing required inputs: certifications');
    });

    it('returns denied when evaluateDecision throws (service unavailable)', async () => {
      setupDynamoMock({
        queryResponses: new Map(),
        putCapture: [],
      });

      mockEvaluateDecision.mockRejectedValue(new Error('Service timeout'));

      const event = createRevalidateEvent();
      const response = await handler(event as never);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.new_result).toBe('denied');
      expect(body.reasons).toContain('system temporarily unable to evaluate');
    });
  });

  describe('Revalidation attempt persistence', () => {
    it('persists a revalidation attempt record with correct fields', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({
        queryResponses: new Map(),
        putCapture,
      });

      mockEvaluateDecision.mockResolvedValue({
        response: {
          decision: 'allowed',
          decision_id: 'new-dec-id',
          reasons: ['All checks passed'],
        },
      });

      const event = createRevalidateEvent();
      await handler(event as never);

      // Should have one PutCommand for the revalidation attempt
      expect(putCapture.length).toBe(1);
      const putInput = putCapture[0];
      const item = putInput.Item as Record<string, unknown>;

      expect(item.tenant_id).toBe(tenantId);
      expect(item.original_decision_id).toBe(originalDecisionId);
      expect(item.worker_id).toBe(workerId);
      expect(item.site_id).toBe(siteId);
      expect(item.new_decision_id).toBe('new-dec-id');
      expect(item.new_result).toBe('allowed');
      expect(item.attempted_at).toBeDefined();
      expect(item.attempt_id).toBeDefined();

      // Verify partition key structure
      expect(item.PK).toBe(`DECISION#${originalDecisionId}`);
      expect((item.SK as string).startsWith('ATTEMPT#')).toBe(true);
      expect(item.GSI1PK).toBe(`TENANT#${tenantId}`);
    });

    it('stores the attempt in the RevalidationAttempts table', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({
        queryResponses: new Map(),
        putCapture,
      });

      mockEvaluateDecision.mockResolvedValue({
        response: {
          decision: 'denied',
          decision_id: 'dec-still-denied',
          reasons: ['Cert expired'],
        },
      });

      const event = createRevalidateEvent();
      await handler(event as never);

      expect(putCapture.length).toBe(1);
      expect(putCapture[0].TableName).toBe('test-RevalidationAttempts');
    });
  });

  describe('Max attempts enforcement (3 per decision per 24h)', () => {
    it('returns 409 conflict when 3 attempts already exist in the last 24h', async () => {
      // Configure query to return 3 existing attempts
      const queryKey = JSON.stringify({
        TableName: 'test-RevalidationAttempts',
        IndexName: undefined,
        ExpressionAttributeValues: expect.any(Object),
      });

      // We need to configure the query response for the attempts query
      // The mock matches on the serialized query key, so let's set it up to match
      const existingAttempts = [
        { attempt_id: 'a1', attempted_at: new Date().toISOString() },
        { attempt_id: 'a2', attempted_at: new Date().toISOString() },
        { attempt_id: 'a3', attempted_at: new Date().toISOString() },
      ];

      // Build the exact query key the handler will produce
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const expectedQueryKey = JSON.stringify({
        TableName: 'test-RevalidationAttempts',
        IndexName: undefined,
        ExpressionAttributeValues: {
          ':pk': `DECISION#${originalDecisionId}`,
          ':since': `ATTEMPT#${twentyFourHoursAgo}`,
        },
      });

      // Since the timestamp is dynamic, we use a different approach:
      // Mock the send function directly for this test
      const send = getMockSend();
      send.mockImplementation((command: unknown) => {
        const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
        const commandName = cmd.constructor?.name ?? 'UnknownCommand';

        if (commandName === 'QueryCommand') {
          return Promise.resolve({
            Items: existingAttempts,
            Count: 3,
          });
        }
        return Promise.resolve({});
      });

      const event = createRevalidateEvent();
      const response = await handler(event as never);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(409);
      expect(body.message).toContain('Maximum revalidation attempts');
    });

    it('allows revalidation when fewer than 3 attempts exist', async () => {
      const putCapture: Array<Record<string, unknown>> = [];

      // Mock send to return 2 existing attempts (under the limit)
      const send = getMockSend();
      send.mockImplementation((command: unknown) => {
        const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
        const commandName = cmd.constructor?.name ?? 'UnknownCommand';

        if (commandName === 'QueryCommand') {
          return Promise.resolve({
            Items: [
              { attempt_id: 'a1' },
              { attempt_id: 'a2' },
            ],
            Count: 2,
          });
        }
        if (commandName === 'PutCommand') {
          putCapture.push(cmd.input);
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      mockEvaluateDecision.mockResolvedValue({
        response: {
          decision: 'allowed',
          decision_id: 'new-dec-passed',
          reasons: ['Worker now compliant'],
        },
      });

      const event = createRevalidateEvent();
      const response = await handler(event as never);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.attempts_remaining).toBe(0); // 3 - (2 + 1) = 0
      expect(body.new_result).toBe('allowed');
    });

    it('correctly computes attempts_remaining in response', async () => {
      // Mock send to return 0 existing attempts
      const send = getMockSend();
      send.mockImplementation((command: unknown) => {
        const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
        const commandName = cmd.constructor?.name ?? 'UnknownCommand';

        if (commandName === 'QueryCommand') {
          return Promise.resolve({ Items: [], Count: 0 });
        }
        if (commandName === 'PutCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      mockEvaluateDecision.mockResolvedValue({
        response: {
          decision: 'denied',
          decision_id: 'dec-x',
          reasons: ['Still missing cert'],
        },
      });

      const event = createRevalidateEvent();
      const response = await handler(event as never);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.attempts_remaining).toBe(2); // 3 - (0 + 1) = 2
    });
  });

  describe('Input validation', () => {
    it('returns 400 when body is missing', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/access/revalidate',
        claims,
      });

      const response = await handler(event as never);
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when original_decision_id is not a valid UUID', async () => {
      const event = createRevalidateEvent({
        original_decision_id: 'not-a-uuid',
        worker_id: workerId,
        site_id: siteId,
      });

      const response = await handler(event as never);
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when worker_id is missing', async () => {
      const event = createRevalidateEvent({
        original_decision_id: originalDecisionId,
        site_id: siteId,
      });

      const response = await handler(event as never);
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when site_id is missing', async () => {
      const event = createRevalidateEvent({
        original_decision_id: originalDecisionId,
        worker_id: workerId,
      });

      const response = await handler(event as never);
      expect(response.statusCode).toBe(400);
    });
  });

  describe('Authentication and authorization', () => {
    it('returns 401 when no auth claims are provided', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/access/revalidate',
        body: validBody,
        noAuth: true,
      });

      const response = await handler(event as never);
      expect(response.statusCode).toBe(401);
    });
  });
});
