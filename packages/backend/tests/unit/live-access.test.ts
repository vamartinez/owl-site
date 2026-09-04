/**
 * Unit tests for the handleLiveAccess handler.
 * Tests the GET /site-access/live endpoint logic including:
 * - Permission enforcement (access:read_decisions)
 * - DynamoDB query with correct filter for checked-in workers
 * - Response shape (workers array + totalOnSite)
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4
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
    resource: '/site-access/live',
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

describe('handleLiveAccess', () => {
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

  it('returns workers currently on site with HTTP 200', async () => {
    const mockItems = [
      {
        session_id: 'session-001',
        worker_id: 'worker-001',
        worker_name: 'John Smith',
        site_name: 'Site Alpha',
        check_in_time: '2024-06-15T08:00:00.000Z',
        contractor: 'ABC Construction',
        compliance_status: 'compliant',
      },
      {
        session_id: 'session-002',
        worker_id: 'worker-002',
        worker_name: 'Jane Doe',
        site_name: 'Site Alpha',
        check_in_time: '2024-06-15T09:30:00.000Z',
        contractor: 'XYZ Builders',
        compliance_status: 'conditional',
      },
    ];

    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: mockItems,
      $metadata: {},
    } as never);

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('workers');
    expect(body).toHaveProperty('totalOnSite');
    expect(body.workers).toBeInstanceOf(Array);
    expect(body.workers.length).toBe(2);
    expect(body.totalOnSite).toBe(2);

    // Verify response shape for each worker
    const worker = body.workers[0];
    expect(worker).toHaveProperty('id');
    expect(worker).toHaveProperty('workerName');
    expect(worker).toHaveProperty('site');
    expect(worker).toHaveProperty('checkInTime');
    expect(worker).toHaveProperty('contractor');
    expect(worker).toHaveProperty('complianceStatus');

    expect(worker.workerName).toBe('John Smith');
    expect(worker.site).toBe('Site Alpha');
    expect(worker.checkInTime).toBe('2024-06-15T08:00:00.000Z');
    expect(worker.contractor).toBe('ABC Construction');
    expect(worker.complianceStatus).toBe('compliant');
  });

  it('returns empty workers array when no one is on site', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.workers).toEqual([]);
    expect(body.totalOnSite).toBe(0);
  });

  it('queries DynamoDB with correct tenant-scoped key and filter', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent();
    await handler(event);

    expect(docClient.send).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(docClient.send).mock.calls[0]![0] as unknown as {
      input: Record<string, unknown>;
    };
    expect(callArg.input).toMatchObject({
      TableName: 'dev-ScanSessions',
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'attribute_exists(#checkIn) AND attribute_not_exists(#checkOut)',
      ExpressionAttributeNames: {
        '#checkIn': 'check_in_time',
        '#checkOut': 'check_out_time',
      },
      ExpressionAttributeValues: {
        ':pk': 'TENANT#tenant-001',
      },
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

  it('totalOnSite equals the length of the workers array', async () => {
    const mockItems = [
      {
        session_id: 'session-001',
        worker_name: 'Worker A',
        site_name: 'Site 1',
        check_in_time: '2024-06-15T08:00:00.000Z',
        contractor: 'Contractor A',
        result: 'allowed',
      },
      {
        session_id: 'session-002',
        worker_name: 'Worker B',
        site_name: 'Site 1',
        check_in_time: '2024-06-15T09:00:00.000Z',
        contractor: 'Contractor B',
        result: 'allowed',
      },
      {
        session_id: 'session-003',
        worker_name: 'Worker C',
        site_name: 'Site 2',
        check_in_time: '2024-06-15T10:00:00.000Z',
        contractor: 'Contractor A',
        result: 'conditional',
      },
    ];

    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: mockItems,
      $metadata: {},
    } as never);

    const event = createEvent();
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.totalOnSite).toBe(body.workers.length);
    expect(body.totalOnSite).toBe(3);
  });
});
