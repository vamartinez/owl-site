/**
 * Unit tests for the handleRecentCheckIns handler.
 * Tests the GET /site-access/recent-checkins endpoint logic including:
 * - Permission enforcement (access:read_decisions)
 * - DynamoDB query with ScanIndexForward: false and Limit: 10
 * - Response shape (checkIns array with id, workerName, decision, timestamp, site)
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
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
  recordScanSession: vi.fn(),
  detectReplay: vi.fn(),
}));

import { docClient } from '../../src/shared/dynamo-client.js';

function createEvent(overrides: Partial<Record<string, unknown>> = {}): ApiGatewayEvent {
  return {
    httpMethod: 'GET',
    resource: '/site-access/recent-checkins',
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
    body: null,
    ...overrides,
  } as unknown as ApiGatewayEvent;
}

describe('handleRecentCheckIns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when user lacks access:read_decisions permission', async () => {
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

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('FORBIDDEN');

    enforcePermissionSpy.mockRestore();
  });

  it('returns recent check-ins with HTTP 200 and correct response shape', async () => {
    const mockSessionItems = [
      {
        session_id: 'session-010',
        worker_id: 'worker-001',
        site_id: 'site-001',
        result: 'allowed',
        timestamp: '2024-06-15T10:30:00.000Z',
        decision_ref: '',
      },
      {
        session_id: 'session-009',
        worker_id: 'worker-002',
        site_id: 'site-002',
        result: 'denied',
        timestamp: '2024-06-15T10:15:00.000Z',
        decision_ref: 'decision-abc',
      },
    ];

    // Mock: 1st call = ScanSessions query
    // 2nd-3rd calls = Worker lookups (worker-001, worker-002)
    // 4th-5th calls = Site lookups (site-001, site-002)
    // 6th call = Decision record lookup (decision-abc)
    vi.mocked(docClient.send)
      .mockResolvedValueOnce({ Items: mockSessionItems, $metadata: {} } as never)
      // Worker lookups
      .mockResolvedValueOnce({ Item: { legal_name: 'Alice Johnson' }, $metadata: {} } as never)
      .mockResolvedValueOnce({ Item: { legal_name: 'Bob Williams' }, $metadata: {} } as never)
      // Site lookups
      .mockResolvedValueOnce({ Item: { name: 'Site Beta' }, $metadata: {} } as never)
      .mockResolvedValueOnce({ Item: { name: 'Site Alpha' }, $metadata: {} } as never)
      // Decision record lookup for denied entry
      .mockResolvedValueOnce({ Items: [{ reasons: ['Missing OSHA-30 certification'] }], $metadata: {} } as never);

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('checkIns');
    expect(body.checkIns).toBeInstanceOf(Array);
    expect(body.checkIns.length).toBe(2);

    // Verify response shape for allowed check-in
    const checkIn = body.checkIns[0];
    expect(checkIn).toHaveProperty('id');
    expect(checkIn).toHaveProperty('workerName');
    expect(checkIn).toHaveProperty('decision');
    expect(checkIn).toHaveProperty('timestamp');
    expect(checkIn).toHaveProperty('site');

    expect(checkIn.id).toBe('session-010');
    expect(checkIn.workerName).toBe('Alice Johnson');
    expect(checkIn.decision).toBe('allowed');
    expect(checkIn.timestamp).toBe('2024-06-15T10:30:00.000Z');
    expect(checkIn.site).toBe('Site Beta');

    // Verify denied entry has denialReason
    const deniedCheckIn = body.checkIns[1];
    expect(deniedCheckIn.workerName).toBe('Bob Williams');
    expect(deniedCheckIn.site).toBe('Site Alpha');
    expect(deniedCheckIn.denialReason).toBe('Missing OSHA-30 certification');
  });

  it('returns empty checkIns array when no sessions exist', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.checkIns).toEqual([]);
  });

  it('queries DynamoDB with ScanIndexForward: false and Limit: 10', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent();
    await handler(event);

    // With empty items, only the initial ScanSessions query is made (no worker/site lookups needed)
    expect(docClient.send).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(docClient.send).mock.calls[0]![0] as unknown as {
      input: Record<string, unknown>;
    };
    expect(callArg.input).toMatchObject({
      TableName: 'dev-ScanSessions',
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': 'TENANT#tenant-001',
      },
      ScanIndexForward: false,
      Limit: 10,
    });
  });

  it('returns 401 when no authorization is provided', async () => {
    const event = createEvent({
      headers: {},
      requestContext: {
        requestId: 'test-request-id',
      },
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(401);
  });
});
