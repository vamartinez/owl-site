/**
 * Unit tests for the Sync Service.
 * Tests reconciler logic, handler routing, and stale session detection.
 *
 * Requirements: 15.1, 15.2, 15.3, 18.17
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('sync: reconciler pure functions', () => {
  let sortSessionsChronologically: typeof import('../../src/services/sync/reconciler.js').sortSessionsChronologically;
  let isSessionStale: typeof import('../../src/services/sync/reconciler.js').isSessionStale;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: vi.fn() }) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      QueryCommand: vi.fn(),
      UpdateCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    const mod = await import('../../src/services/sync/reconciler.js');
    sortSessionsChronologically = mod.sortSessionsChronologically;
    isSessionStale = mod.isSessionStale;
  });

  it('sorts sessions in chronological order by scan_timestamp', () => {
    const sessions = [
      { session_id: 's3', scan_timestamp: '2024-06-15T12:00:00Z', cached_at: '2024-06-15T12:00:00Z', worker_id: 'w1', site_id: 'site1', tenant_id: 't1', scanner_type: 'qr', device_id: 'd1' },
      { session_id: 's1', scan_timestamp: '2024-06-15T08:00:00Z', cached_at: '2024-06-15T08:00:00Z', worker_id: 'w1', site_id: 'site1', tenant_id: 't1', scanner_type: 'qr', device_id: 'd1' },
      { session_id: 's2', scan_timestamp: '2024-06-15T10:00:00Z', cached_at: '2024-06-15T10:00:00Z', worker_id: 'w1', site_id: 'site1', tenant_id: 't1', scanner_type: 'qr', device_id: 'd1' },
    ];

    const sorted = sortSessionsChronologically(sessions);

    expect(sorted[0].session_id).toBe('s1');
    expect(sorted[1].session_id).toBe('s2');
    expect(sorted[2].session_id).toBe('s3');
  });

  it('does not mutate original array', () => {
    const sessions = [
      { session_id: 's2', scan_timestamp: '2024-06-15T10:00:00Z', cached_at: '2024-06-15T10:00:00Z', worker_id: 'w1', site_id: 'site1', tenant_id: 't1', scanner_type: 'qr', device_id: 'd1' },
      { session_id: 's1', scan_timestamp: '2024-06-15T08:00:00Z', cached_at: '2024-06-15T08:00:00Z', worker_id: 'w1', site_id: 'site1', tenant_id: 't1', scanner_type: 'qr', device_id: 'd1' },
    ];

    const sorted = sortSessionsChronologically(sessions);

    expect(sessions[0].session_id).toBe('s2'); // Original unchanged
    expect(sorted[0].session_id).toBe('s1');
  });

  it('detects stale session (>24h cache)', () => {
    const now = new Date('2024-06-16T10:00:00Z');
    const session = {
      session_id: 's1',
      scan_timestamp: '2024-06-15T08:00:00Z',
      cached_at: '2024-06-15T08:00:00Z', // 26 hours ago
      worker_id: 'w1',
      site_id: 'site1',
      tenant_id: 't1',
      scanner_type: 'qr',
      device_id: 'd1',
    };

    expect(isSessionStale(session, now)).toBe(true);
  });

  it('does not flag fresh session as stale (<24h cache)', () => {
    const now = new Date('2024-06-15T12:00:00Z');
    const session = {
      session_id: 's1',
      scan_timestamp: '2024-06-15T08:00:00Z',
      cached_at: '2024-06-15T08:00:00Z', // 4 hours ago
      worker_id: 'w1',
      site_id: 'site1',
      tenant_id: 't1',
      scanner_type: 'qr',
      device_id: 'd1',
    };

    expect(isSessionStale(session, now)).toBe(false);
  });

  it('session exactly at 24h boundary is not stale', () => {
    const now = new Date('2024-06-16T08:00:00Z');
    const session = {
      session_id: 's1',
      scan_timestamp: '2024-06-15T08:00:00Z',
      cached_at: '2024-06-15T08:00:00Z', // Exactly 24 hours ago
      worker_id: 'w1',
      site_id: 'site1',
      tenant_id: 't1',
      scanner_type: 'qr',
      device_id: 'd1',
    };

    // Exactly 24h is NOT stale (> 24h is stale)
    expect(isSessionStale(session, now)).toBe(false);
  });

  it('session at 24h + 1ms is stale', () => {
    const now = new Date('2024-06-16T08:00:00.001Z');
    const session = {
      session_id: 's1',
      scan_timestamp: '2024-06-15T08:00:00Z',
      cached_at: '2024-06-15T08:00:00Z',
      worker_id: 'w1',
      site_id: 'site1',
      tenant_id: 't1',
      scanner_type: 'qr',
      device_id: 'd1',
    };

    expect(isSessionStale(session, now)).toBe(true);
  });
});

describe('sync: handler routing', () => {
  const mockSend = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();

    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      QueryCommand: vi.fn(),
      UpdateCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({})),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));
  });

  const gateOperatorClaims = {
    sub: 'user-1',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'gate_operator',
  };

  const workerClaims = {
    sub: 'user-1',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'worker',
  };

  it('returns 401 for unauthenticated requests', async () => {
    const { handler } = await import('../../src/services/sync/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/sync/sessions',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 when worker role tries to sync sessions', async () => {
    const { handler } = await import('../../src/services/sync/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/sync/sessions',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: JSON.stringify({ device_id: 'd1', sessions: [] }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  it('returns 400 when POST /sync/sessions has no body', async () => {
    const { handler } = await import('../../src/services/sync/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/sync/sessions',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: gateOperatorClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Request body is required');
  });

  it('returns 400 when sessions array is empty', async () => {
    const { handler } = await import('../../src/services/sync/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/sync/sessions',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: gateOperatorClaims } },
      body: JSON.stringify({ device_id: 'd1', sessions: [] }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when device_id is missing for GET /sync/status', async () => {
    const { handler } = await import('../../src/services/sync/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/sync/status',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: gateOperatorClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('device_id');
  });

  it('returns 400 when sessions belong to different tenant', async () => {
    const { handler } = await import('../../src/services/sync/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/sync/sessions',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: gateOperatorClaims } },
      body: JSON.stringify({
        device_id: 'd1',
        sessions: [
          {
            session_id: 's1',
            worker_id: 'w1',
            site_id: 'site1',
            tenant_id: 'different-tenant', // Different from authenticated tenant
            scan_timestamp: '2024-06-15T08:00:00Z',
            scanner_type: 'qr',
            device_id: 'd1',
            cached_at: '2024-06-15T08:00:00Z',
          },
        ],
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('authenticated tenant');
  });

  it('returns 400 for unsupported routes', async () => {
    const { handler } = await import('../../src/services/sync/handler.js');

    const event = {
      httpMethod: 'DELETE',
      resource: '/sync/sessions',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: gateOperatorClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns sync status for device', async () => {
    // GetCommand for DeviceCache
    mockSend.mockResolvedValueOnce({
      Item: { device_id: 'd1', tenant_id: 'tenant-1', last_sync_at: '2024-06-15T08:00:00Z' },
    });
    // QueryCommand for OfflineQueue
    mockSend.mockResolvedValueOnce({ Count: 0 });

    const { handler } = await import('../../src/services/sync/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/sync/status',
      pathParameters: null,
      queryStringParameters: { device_id: 'd1' },
      headers: {},
      requestContext: { authorizer: { claims: gateOperatorClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status.device_id).toBe('d1');
    expect(body.status.sync_health).toBeDefined();
  });
});
