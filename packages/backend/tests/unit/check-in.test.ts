/**
 * Unit tests for the handleCheckIn handler.
 * Tests the POST /site-access/check-in endpoint logic including:
 * - Permission enforcement (access:scan)
 * - Request body validation (workerId required via Zod)
 * - Worker lookup, compliance evaluation, and decision recording
 * - Response shape (CheckInResponse with decision, workerName, reasons, missingCerts)
 * - HTTP 400 for invalid input, HTTP 200 for valid requests
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/services/access/handler.js';
import type { ApiGatewayEvent } from '../../src/shared/auth-middleware.js';

// Mock DynamoDB
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: (name: string) => `dev-${name}`,
}));

// Mock event-publisher
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn(),
}));

// Mock decision engine
vi.mock('../../src/services/decision-engine/evaluator.js', () => ({
  evaluateDecision: vi.fn(),
}));

// Mock token-manager
vi.mock('../../src/services/access/token-manager.js', () => ({
  generateToken: vi.fn(),
  getToken: vi.fn(),
  validateToken: vi.fn(),
  markTokenUsed: vi.fn(),
  revokeToken: vi.fn(),
  isTokenExpired: vi.fn(),
}));

// Mock scan-session
vi.mock('../../src/services/access/scan-session.js', () => ({
  recordScanSession: vi.fn().mockResolvedValue({ session_id: 'session-mock' }),
  detectReplay: vi.fn(),
}));

import { docClient } from '../../src/shared/dynamo-client.js';
import { evaluateDecision } from '../../src/services/decision-engine/evaluator.js';
import { recordScanSession } from '../../src/services/access/scan-session.js';

function createCheckInEvent(body: unknown = { workerId: 'worker-001' }): ApiGatewayEvent {
  return {
    httpMethod: 'POST',
    resource: '/site-access/check-in',
    headers: {
      Authorization: 'Bearer test-token',
    },
    pathParameters: null,
    queryStringParameters: null,
    requestContext: {
      requestId: 'test-request-id',
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:tenant_id': 'tenant-001',
          'custom:role': 'gate_operator',
        },
      },
    },
    body: body ? JSON.stringify(body) : null,
  } as unknown as ApiGatewayEvent;
}

describe('handleCheckIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when user lacks access:scan permission', async () => {
    const rbac = await import('../../src/shared/rbac.js');
    const enforcePermissionSpy = vi.spyOn(rbac, 'enforcePermission');
    enforcePermissionSpy.mockReturnValueOnce({
      statusCode: 403,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Correlation-Id,X-Tenant-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      },
      body: JSON.stringify({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
        request_id: 'test',
        timestamp: new Date().toISOString(),
      }),
    });

    const event = createCheckInEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('FORBIDDEN');

    enforcePermissionSpy.mockRestore();
  });

  it('returns 400 when request body is missing', async () => {
    const event = createCheckInEvent(null);
    // body is null
    (event as Record<string, unknown>)['body'] = null;

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when workerId is empty string', async () => {
    const event = createCheckInEvent({ workerId: '' });
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.message).toContain('workerId is required');
  });

  it('returns 400 when workerId is missing from body', async () => {
    const event = createCheckInEvent({ someOtherField: 'value' });
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 200 with CheckInResponse shape on successful check-in', async () => {
    // Mock worker lookup
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Item: {
        worker_id: 'worker-001',
        tenant_id: 'tenant-001',
        legal_name: 'John Smith',
        site_id: 'site-001',
      },
      $metadata: {},
    } as never);

    // Mock decision engine evaluation
    vi.mocked(evaluateDecision).mockResolvedValueOnce({
      response: {
        decision_id: 'decision-001',
        decision: 'allowed',
        decision_type: 'site_access',
        reasons: ['All certifications valid'],
        rules_applied: ['rule-1'],
        policy_version_used: 'pv-001',
        jurisdiction: 'BC',
        timestamp: new Date().toISOString(),
        explainability: {} as never,
      },
    });

    const event = createCheckInEvent({ workerId: 'worker-001' });
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // Verify CheckInResponse shape
    expect(body).toHaveProperty('decision');
    expect(body).toHaveProperty('workerName');
    expect(body).toHaveProperty('reasons');
    expect(body).toHaveProperty('missingCerts');

    expect(body.decision).toBe('allowed');
    expect(body.workerName).toBe('John Smith');
    expect(body.reasons).toBeInstanceOf(Array);
    expect(body.missingCerts).toBeInstanceOf(Array);
  });

  it('returns denied decision when worker fails compliance', async () => {
    // Mock worker lookup
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Item: {
        worker_id: 'worker-002',
        tenant_id: 'tenant-001',
        legal_name: 'Jane Doe',
        site_id: 'site-001',
      },
      $metadata: {},
    } as never);

    // Mock decision engine returning denied
    vi.mocked(evaluateDecision).mockResolvedValueOnce({
      response: {
        decision_id: 'decision-002',
        decision: 'denied',
        decision_type: 'site_access',
        reasons: [
          'Worker does not hold required certification: First Aid',
          'Worker does not hold required certification: Safety Training',
        ],
        rules_applied: ['rule-1', 'rule-2'],
        policy_version_used: 'pv-001',
        jurisdiction: 'BC',
        timestamp: new Date().toISOString(),
        explainability: {} as never,
      },
    });

    const event = createCheckInEvent({ workerId: 'worker-002' });
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.decision).toBe('denied');
    expect(body.workerName).toBe('Jane Doe');
    expect(body.reasons.length).toBeGreaterThan(0);
    expect(body.missingCerts).toBeInstanceOf(Array);
  });

  it('records a scan session after evaluating compliance', async () => {
    // Mock worker lookup
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Item: {
        worker_id: 'worker-001',
        tenant_id: 'tenant-001',
        legal_name: 'John Smith',
        site_id: 'site-001',
      },
      $metadata: {},
    } as never);

    // Mock decision engine
    vi.mocked(evaluateDecision).mockResolvedValueOnce({
      response: {
        decision_id: 'decision-001',
        decision: 'allowed',
        decision_type: 'site_access',
        reasons: ['All certifications valid'],
        rules_applied: ['rule-1'],
        policy_version_used: 'pv-001',
        jurisdiction: 'BC',
        timestamp: new Date().toISOString(),
        explainability: {} as never,
      },
    });

    const event = createCheckInEvent({ workerId: 'worker-001' });
    await handler(event);

    expect(recordScanSession).toHaveBeenCalledTimes(1);
    expect(recordScanSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-001',
        worker_id: 'worker-001',
        site_id: 'site-001',
        result: 'allowed',
        scanner_type: 'manual',
      })
    );
  });

  it('returns denied with error message when decision engine fails', async () => {
    // Mock worker lookup
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Item: {
        worker_id: 'worker-001',
        tenant_id: 'tenant-001',
        legal_name: 'John Smith',
        site_id: 'site-001',
      },
      $metadata: {},
    } as never);

    // Mock decision engine throwing an error
    vi.mocked(evaluateDecision).mockRejectedValueOnce(new Error('Service unavailable'));

    const event = createCheckInEvent({ workerId: 'worker-001' });
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.decision).toBe('denied');
    expect(body.reasons).toContain('system temporarily unable to evaluate');
  });

  it('returns 401 when no authorization is provided', async () => {
    const event = createCheckInEvent();
    (event as Record<string, unknown>)['headers'] = {};
    (event as Record<string, unknown>)['requestContext'] = {
      requestId: 'test-request-id',
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(401);
  });
});
