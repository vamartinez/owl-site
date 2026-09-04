/**
 * Unit tests for the handleRejections handler.
 * Tests the GET /site-access/rejections endpoint logic including:
 * - Permission enforcement (access:read_decisions)
 * - DynamoDB query with correct filter for denied results
 * - Optional search/reason/period filters via shared filter utility
 * - Response shape (rejections array + total)
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
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
    resource: '/site-access/rejections',
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

describe('handleRejections', () => {
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

  it('returns rejections with HTTP 200', async () => {
    const mockItems = [
      {
        session_id: 'session-001',
        worker_name: 'John Smith',
        site_name: 'Site Alpha',
        reason: 'expired_certification',
        timestamp: '2024-06-15T08:00:00.000Z',
        missing_requirements: ['Safety Training', 'First Aid'],
        result: 'denied',
      },
      {
        session_id: 'session-002',
        worker_name: 'Jane Doe',
        site_name: 'Site Beta',
        reason: 'no_valid_cert',
        timestamp: '2024-06-15T09:30:00.000Z',
        missing_requirements: ['WHMIS'],
        result: 'denied',
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

    expect(body).toHaveProperty('rejections');
    expect(body).toHaveProperty('total');
    expect(body.rejections).toBeInstanceOf(Array);
    expect(body.rejections.length).toBe(2);
    expect(body.total).toBe(2);

    // Verify response shape for each rejection
    const rejection = body.rejections[0];
    expect(rejection).toHaveProperty('id');
    expect(rejection).toHaveProperty('workerName');
    expect(rejection).toHaveProperty('site');
    expect(rejection).toHaveProperty('reason');
    expect(rejection).toHaveProperty('timestamp');
    expect(rejection).toHaveProperty('missingRequirements');

    expect(rejection.workerName).toBe('John Smith');
    expect(rejection.site).toBe('Site Alpha');
    expect(rejection.reason).toBe('expired_certification');
    expect(rejection.timestamp).toBe('2024-06-15T08:00:00.000Z');
    expect(rejection.missingRequirements).toEqual(['Safety Training', 'First Aid']);
  });

  it('returns empty rejections array when no denied sessions exist', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.rejections).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('queries DynamoDB with correct tenant-scoped key and denied filter', async () => {
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
      FilterExpression: '#result = :denied',
      ExpressionAttributeNames: {
        '#result': 'result',
      },
      ExpressionAttributeValues: {
        ':pk': 'TENANT#tenant-001',
        ':denied': 'denied',
      },
    });
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
    expect(callArg.input['FilterExpression']).toContain('#result = :denied');
    expect(callArg.input['FilterExpression']).toContain('contains(#workerName, :search)');
    expect((callArg.input['ExpressionAttributeValues'] as Record<string, unknown>)[':search']).toBe('john');
    expect((callArg.input['ExpressionAttributeNames'] as Record<string, string>)['#workerName']).toBe('worker_name');
  });

  it('applies reason filter when reason query parameter is provided', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent({
      queryStringParameters: { reason: 'expired_certification' },
    });
    await handler(event);

    const callArg = vi.mocked(docClient.send).mock.calls[0]![0] as unknown as {
      input: Record<string, unknown>;
    };
    expect(callArg.input['FilterExpression']).toContain('#result = :denied');
    expect(callArg.input['FilterExpression']).toContain('#reason = :reason');
    expect((callArg.input['ExpressionAttributeValues'] as Record<string, unknown>)[':reason']).toBe('expired_certification');
  });

  it('applies period filter when period query parameter is provided', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent({
      queryStringParameters: { period: '7d' },
    });
    await handler(event);

    const callArg = vi.mocked(docClient.send).mock.calls[0]![0] as unknown as {
      input: Record<string, unknown>;
    };
    expect(callArg.input['FilterExpression']).toContain('#result = :denied');
    expect(callArg.input['FilterExpression']).toContain('#timestamp >= :periodStart');
    expect((callArg.input['ExpressionAttributeNames'] as Record<string, string>)['#timestamp']).toBe('timestamp');
  });

  it('total equals the length of the rejections array', async () => {
    const mockItems = [
      {
        session_id: 'session-001',
        worker_name: 'Worker A',
        site_name: 'Site 1',
        reason: 'missing_cert',
        timestamp: '2024-06-15T08:00:00.000Z',
        missing_requirements: ['Cert A'],
        result: 'denied',
      },
      {
        session_id: 'session-002',
        worker_name: 'Worker B',
        site_name: 'Site 2',
        reason: 'expired_cert',
        timestamp: '2024-06-15T09:00:00.000Z',
        missing_requirements: ['Cert B'],
        result: 'denied',
      },
      {
        session_id: 'session-003',
        worker_name: 'Worker C',
        site_name: 'Site 1',
        reason: 'no_valid_cert',
        timestamp: '2024-06-15T10:00:00.000Z',
        missing_requirements: [],
        result: 'denied',
      },
    ];

    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: mockItems,
      $metadata: {},
    } as never);

    const event = createEvent();
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.total).toBe(body.rejections.length);
    expect(body.total).toBe(3);
  });
});
