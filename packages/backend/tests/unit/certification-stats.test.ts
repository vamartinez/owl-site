/**
 * Unit tests for the handleCertificationStats handler.
 * Tests the GET /certifications/stats endpoint logic including:
 * - Permission enforcement
 * - Aggregation by status
 * - byType grouping
 * - Response shape
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/services/identity/handler.js';
import type { ApiGatewayEvent } from '../../src/shared/auth-middleware.js';

// Mock DynamoDB
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: (name: string) => `dev-${name}`,
}));

// Import the mocked docClient
import { docClient } from '../../src/shared/dynamo-client.js';

function createEvent(overrides: Partial<Record<string, unknown>> = {}): ApiGatewayEvent {
  return {
    httpMethod: 'GET',
    resource: '/certifications/stats',
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

describe('handleCertificationStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when user lacks certifications:read permission', async () => {
    // Mock enforcePermission to simulate a forbidden response
    const rbac = await import('../../src/shared/rbac.js');
    const enforcePermissionSpy = vi.spyOn(rbac, 'enforcePermission');
    enforcePermissionSpy.mockReturnValueOnce({
      statusCode: 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Correlation-Id,X-Tenant-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' },
      body: JSON.stringify({ code: 'FORBIDDEN', message: 'You do not have permission to perform this action', request_id: 'test', timestamp: new Date().toISOString() }),
    });

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('FORBIDDEN');

    enforcePermissionSpy.mockRestore();
  });

  it('returns aggregated stats with HTTP 200 for authorized user', async () => {
    const now = new Date();
    const futureDate = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // 15 days from now
    const farFutureDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days from now
    const pastDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

    // NOTE: real certification records persist the type under `certification_type`
    // (see the Certification interface and createCertification), NOT `cert_type`.
    // These mocks intentionally use the real field name so the "byType" grouping
    // is validated against the actual data contract and cannot regress to the
    // "Unknown" bucket bug again.
    const mockItems = [
      { status: 'active', certification_type: 'whmis_2015', expiry_date: farFutureDate.toISOString() },
      { status: 'active', certification_type: 'whmis_2015', expiry_date: farFutureDate.toISOString() },
      { status: 'active', certification_type: 'fall_protection', expiry_date: futureDate.toISOString() }, // expiring soon
      { status: 'pending_validation', certification_type: 'first_aid', expiry_date: farFutureDate.toISOString() },
      { status: 'expired', certification_type: 'site_ready_bc', expiry_date: pastDate.toISOString() },
    ];

    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: mockItems,
      $metadata: {},
    } as never);

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('totalActive');
    expect(body).toHaveProperty('pendingValidation');
    expect(body).toHaveProperty('expiringSoon');
    expect(body).toHaveProperty('expired');
    expect(body).toHaveProperty('byType');

    // Verify aggregation
    expect(body.pendingValidation).toBe(1);
    expect(body.expired).toBe(1);
    expect(body.expiringSoon).toBe(1); // fall_protection expiring in 15 days
    expect(body.totalActive).toBe(2); // 2 active with far future dates

    // Verify byType
    expect(body.byType).toBeInstanceOf(Array);
    expect(body.byType.length).toBe(4);
    const whmisCounts = body.byType.find((t: { type: string }) => t.type === 'whmis_2015');
    expect(whmisCounts).toEqual({ type: 'whmis_2015', count: 2 });

    // Regression guard: records that carry a real `certification_type` must never
    // collapse into the "Unknown" bucket (the original by-Type chart defect).
    expect(body.byType.find((t: { type: string }) => t.type === 'Unknown')).toBeUndefined();
  });

  it('groups by the persisted certification_type field, not the "Unknown" fallback (Req 5.2)', async () => {
    const farFutureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const mockItems = [
      { status: 'active', certification_type: 'fall_protection', expiry_date: farFutureDate.toISOString() },
      { status: 'active', certification_type: 'fall_protection', expiry_date: farFutureDate.toISOString() },
      { status: 'active', certification_type: 'first_aid', expiry_date: farFutureDate.toISOString() },
    ];

    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: mockItems,
      $metadata: {},
    } as never);

    const response = await handler(createEvent());
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    const types = (body.byType as { type: string; count: number }[])
      .map((t) => t.type)
      .sort();
    expect(types).toEqual(['fall_protection', 'first_aid']);
    expect(body.byType).not.toContainEqual(
      expect.objectContaining({ type: 'Unknown' })
    );
  });

  it('returns empty stats when no certifications exist', async () => {
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      $metadata: {},
    } as never);

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.totalActive).toBe(0);
    expect(body.pendingValidation).toBe(0);
    expect(body.expiringSoon).toBe(0);
    expect(body.expired).toBe(0);
    expect(body.byType).toEqual([]);
  });

  it('queries DynamoDB with correct tenant-scoped GSI1 key', async () => {
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
      TableName: 'dev-Certifications',
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
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
});
