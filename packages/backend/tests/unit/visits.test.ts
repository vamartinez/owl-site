/**
 * Unit tests for the handleVisits handler.
 * Tests the GET /site-access/visits endpoint logic including:
 * - Permission enforcement (access:read_decisions)
 * - DynamoDB query with correct tenant-scoped key
 * - Optional search/decision/period filters via shared filter utility
 * - Response shape (visits array + total)
 * - Duration calculation from check-in/check-out times
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
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
    resource: '/site-access/visits',
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
          'custom:role': 'site_admin',
        },
      },
    },
    body: null,
    ...overrides,
  } as unknown as ApiGatewayEvent;
}

describe('handleVisits', () => {
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

  it('returns visits with HTTP 200', async () => {
    const mockItems = [
      {
        session_id: 'session-001',
        worker_name: 'John Smith',
        site_name: 'Site Alpha',
        check_in_time: '2024-06-15T08:00:00.000Z',
        check_out_time: '2024-06-15T16:30:00.000Z',
        result: 'allowed',
      },
      {
        session_id: 'session-002',
        worker_name: 'Jane Doe',
        site_name: 'Site Beta',
        check_in_time: '2024-06-15T09:00:00.000Z',
        check_out_time: null,
        result: 'conditional',
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

    expect(body).toHaveProperty('visits');
    expect(body).toHaveProperty('total');
    expect(body.visits).toBeInstanceOf(Array);
    expect(body.visits.length).toBe(2);
    expect(body.total).toBe(2);

    // Verify response shape for each visit
    const visit = body.visits[0];
    expect(visit).toHaveProperty('id');
    expect(visit).toHaveProperty('workerName');
    expect(visit).toHaveProperty('site');
    expect(visit).toHaveProperty('checkInTime');
    expect(visit).toHaveProperty('checkOutTime');
    expect(visit).toHaveProperty('duration');
    expect(visit).toHaveProperty('decision');

    expect(visit.workerName).toBe('John Smith');
    expect(visit.site).toBe('Site Alpha');
    expect(visit.checkInTime).toBe('2024-06-15T08:00:00.000Z');
    expect(visit.checkOutTime).toBe('2024-06-15T16:30:00.000Z');
    expect(visit.decision).toBe('allowed');
    expect(visit.duration).toBe('8h 30m');
  });

  it('returns null duration when check-out time is not available', async () => {
    const mockItems = [
      {
        session_id: 'session-001',
        worker_name: 'Worker A',
        site_name: 'Site 1',
        check_in_time: '2024-06-15T08:00:00.000Z',
        result: 'allowed',
      },
    ];

    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: mockItems,
      $metadata: {},
    } as never);

    const event = createEvent();
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.visits[0].checkOutTime).toBeNull();
    expect(body.visits[0].duration).toBeNull();
  });

  it('returns empty visits array when no sessions exist', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.visits).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('queries DynamoDB with correct tenant-scoped key', async () => {
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
      ExpressionAttributeValues: {
        ':pk': 'TENANT#tenant-001',
      },
    });
  });

  it('applies decision filter when decision query parameter is provided', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent({
      queryStringParameters: { decision: 'allowed' },
    });
    await handler(event);

    const callArg = vi.mocked(docClient.send).mock.calls[0]![0] as unknown as {
      input: Record<string, unknown>;
    };
    expect(callArg.input['FilterExpression']).toContain('#result = :decision');
    expect((callArg.input['ExpressionAttributeValues'] as Record<string, unknown>)[':decision']).toBe('allowed');
    expect((callArg.input['ExpressionAttributeNames'] as Record<string, string>)['#result']).toBe('result');
  });

  it('applies search filter when search query parameter is provided', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent({
      queryStringParameters: { search: 'john' },
    });
    await handler(event);

    const callArg = vi.mocked(docClient.send).mock.calls[0]![0] as unknown as {
      input: Record<string, unknown>;
    };
    expect(callArg.input['FilterExpression']).toContain('contains(#workerName, :search)');
    expect((callArg.input['ExpressionAttributeValues'] as Record<string, unknown>)[':search']).toBe('john');
    expect((callArg.input['ExpressionAttributeNames'] as Record<string, string>)['#workerName']).toBe('worker_name');
  });

  it('applies period filter when period query parameter is provided', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent({
      queryStringParameters: { period: '30d' },
    });
    await handler(event);

    const callArg = vi.mocked(docClient.send).mock.calls[0]![0] as unknown as {
      input: Record<string, unknown>;
    };
    expect(callArg.input['FilterExpression']).toContain('#timestamp >= :periodStart');
    expect((callArg.input['ExpressionAttributeNames'] as Record<string, string>)['#timestamp']).toBe('timestamp');
  });

  it('total equals the length of the visits array', async () => {
    const mockItems = [
      {
        session_id: 'session-001',
        worker_name: 'Worker A',
        site_name: 'Site 1',
        check_in_time: '2024-06-15T08:00:00.000Z',
        check_out_time: '2024-06-15T12:00:00.000Z',
        result: 'allowed',
      },
      {
        session_id: 'session-002',
        worker_name: 'Worker B',
        site_name: 'Site 2',
        check_in_time: '2024-06-15T09:00:00.000Z',
        check_out_time: '2024-06-15T17:00:00.000Z',
        result: 'denied',
      },
      {
        session_id: 'session-003',
        worker_name: 'Worker C',
        site_name: 'Site 1',
        check_in_time: '2024-06-15T10:00:00.000Z',
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
    expect(body.total).toBe(body.visits.length);
    expect(body.total).toBe(3);
  });
});
