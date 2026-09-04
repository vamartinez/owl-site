/**
 * Unit tests for the Dashboard KPIs endpoint (GET /dashboard/kpis).
 * Tests authentication, authorization, and response shape.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('reporting: GET /dashboard/kpis', () => {
  const mockSend = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();

    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })),
      SendMessageCommand: vi.fn(),
    }));
  });

  const tenantAdminClaims = {
    sub: 'user-1',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'tenant_admin',
  };

  const workerClaims = {
    sub: 'user-2',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'worker',
  };

  function createEvent(claims?: Record<string, string>) {
    return {
      httpMethod: 'GET',
      resource: '/dashboard/kpis',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: claims ? { authorizer: { claims } } : undefined,
      body: null,
    };
  }

  it('returns 401 when no authentication is provided (Req 11.1)', async () => {
    const { handler } = await import('../../src/services/reporting/handler.js');

    const response = await handler(createEvent());
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(401);
  });

  it('returns 403 when user lacks reports:read permission (Req 11.2, 11.4)', async () => {
    const { handler } = await import('../../src/services/reporting/handler.js');

    const response = await handler(createEvent(workerClaims));
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 200 with correct KPI shape (Req 11.3)', async () => {
    // Mock DynamoDB responses for each query
    // 1. Workers count (active)
    mockSend.mockResolvedValueOnce({ Count: 42 });
    // 2. Certifications expiring in 30 days
    mockSend.mockResolvedValueOnce({ Count: 5 });
    // 3. Unresolved findings
    mockSend.mockResolvedValueOnce({ Count: 3 });
    // 4. Unresolved enforcements (critical)
    mockSend.mockResolvedValueOnce({ Count: 1 });
    // 5-11. ScanSessions for 7 days of compliance trend
    for (let i = 0; i < 7; i++) {
      mockSend.mockResolvedValueOnce({
        Items: [
          { result: 'allowed', timestamp: '2024-01-01T08:00:00Z' },
          { result: 'allowed', timestamp: '2024-01-01T09:00:00Z' },
          { result: 'denied', timestamp: '2024-01-01T10:00:00Z' },
        ],
      });
    }

    const { handler } = await import('../../src/services/reporting/handler.js');

    const response = await handler(createEvent(tenantAdminClaims));
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(200);

    const body = JSON.parse((response as { body: string }).body);
    expect(body.totalActiveWorkers).toBe(42);
    expect(body.certsExpiringIn30Days).toBe(5);
    expect(body.pendingFindings).toBe(3);
    expect(body.unresolvedEnforcements).toBe(1);
    expect(body.siteCompliancePercent).toBeGreaterThanOrEqual(0);
    expect(body.siteCompliancePercent).toBeLessThanOrEqual(100);
    expect(body.complianceTrend).toHaveLength(7);
    expect(body.complianceTrend[0]).toHaveProperty('date');
    expect(body.complianceTrend[0]).toHaveProperty('value');
  });

  it('returns 100% compliance when no scan sessions exist', async () => {
    mockSend.mockResolvedValueOnce({ Count: 10 }); // Workers
    mockSend.mockResolvedValueOnce({ Count: 0 });  // Expiring certs
    mockSend.mockResolvedValueOnce({ Count: 0 });  // Findings
    mockSend.mockResolvedValueOnce({ Count: 0 });  // Enforcements
    // 7 days with no sessions
    for (let i = 0; i < 7; i++) {
      mockSend.mockResolvedValueOnce({ Items: [] });
    }

    const { handler } = await import('../../src/services/reporting/handler.js');

    const response = await handler(createEvent(tenantAdminClaims));
    expect((response as { statusCode: number }).statusCode).toBe(200);

    const body = JSON.parse((response as { body: string }).body);
    expect(body.siteCompliancePercent).toBe(100);
    expect(body.complianceTrend.every((t: { value: number }) => t.value === 100)).toBe(true);
  });

  it('complianceTrend contains exactly 7 entries with date and value (Req 11.3)', async () => {
    mockSend.mockResolvedValueOnce({ Count: 5 });  // Workers
    mockSend.mockResolvedValueOnce({ Count: 2 });  // Expiring certs
    mockSend.mockResolvedValueOnce({ Count: 1 });  // Findings
    mockSend.mockResolvedValueOnce({ Count: 0 });  // Enforcements
    for (let i = 0; i < 7; i++) {
      mockSend.mockResolvedValueOnce({
        Items: [{ result: 'allowed', timestamp: '2024-01-01T08:00:00Z' }],
      });
    }

    const { handler } = await import('../../src/services/reporting/handler.js');

    const response = await handler(createEvent(tenantAdminClaims));
    const body = JSON.parse((response as { body: string }).body);

    expect(body.complianceTrend).toHaveLength(7);
    for (const entry of body.complianceTrend) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof entry.value).toBe('number');
      expect(entry.value).toBeGreaterThanOrEqual(0);
      expect(entry.value).toBeLessThanOrEqual(100);
    }
  });
});
