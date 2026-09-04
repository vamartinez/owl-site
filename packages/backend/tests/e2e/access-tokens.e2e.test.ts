/**
 * E2E tests for access tokens CRUD endpoints:
 * - POST /access/tokens → 201 with token and expiration
 * - DELETE /access/tokens/{id} → 200 confirming deletion
 *
 * Tests the full handler path: routing → auth → permission check → business logic → response.
 * AWS SDK is mocked at module level; auth is exercised via Cognito authorizer claims
 * in requestContext.authorizer.claims.
 *
 * Validates: Requirements 6.4, 6.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEvent } from '../helpers/mock-event.js';
import { createMockClaims } from '../helpers/mock-user.js';

// Mock DynamoDB
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: (name: string) => `test-${name}`,
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

import { handler } from '../../src/services/access/handler.js';
import { generateToken, revokeToken } from '../../src/services/access/token-manager.js';

describe('POST /access/tokens - E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 201 with token and expiration for valid request', async () => {
    const tenantId = 'tenant-test';
    const workerId = '550e8400-e29b-41d4-a716-446655440001';
    const siteId = '550e8400-e29b-41d4-a716-446655440002';

    const mockToken = {
      token_id: '550e8400-e29b-41d4-a716-446655440099',
      tenant_id: tenantId,
      worker_id: workerId,
      site_id: siteId,
      token_type: 'qr_session',
      device_id: 'device-abc',
      issued_at: '2024-06-15T10:00:00.000Z',
      expires_at: '2024-06-15T10:10:00.000Z',
      revoked: false,
      used: false,
    };

    vi.mocked(generateToken).mockResolvedValueOnce(mockToken as never);

    const claims = createMockClaims({
      role: 'platform_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/tokens',
      body: {
        worker_id: workerId,
        site_id: siteId,
        token_type: 'qr_session',
        device_id: 'device-abc',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('token');
    expect(body.token.token_id).toBe(mockToken.token_id);
    expect(body.token.worker_id).toBe(workerId);
    expect(body.token.site_id).toBe(siteId);
    expect(body.token.token_type).toBe('qr_session');
    expect(body.token.expires_at).toBe('2024-06-15T10:10:00.000Z');
    expect(body.token.revoked).toBe(false);
    expect(body.token.used).toBe(false);
  });

  it('calls generateToken with correct parameters', async () => {
    const tenantId = 'tenant-test';
    const workerId = '550e8400-e29b-41d4-a716-446655440001';
    const siteId = '550e8400-e29b-41d4-a716-446655440002';

    vi.mocked(generateToken).mockResolvedValueOnce({
      token_id: 'token-gen-id',
      tenant_id: tenantId,
      worker_id: workerId,
      site_id: siteId,
      token_type: 'sms_magic_link',
      device_id: 'mobile-device',
      issued_at: '2024-06-15T10:00:00.000Z',
      expires_at: '2024-06-15T10:10:00.000Z',
      revoked: false,
      used: false,
    } as never);

    const claims = createMockClaims({
      role: 'gate_operator',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/tokens',
      body: {
        worker_id: workerId,
        site_id: siteId,
        token_type: 'sms_magic_link',
        device_id: 'mobile-device',
      },
      claims,
    });

    await handler(event);

    expect(generateToken).toHaveBeenCalledWith(
      tenantId,
      workerId,
      siteId,
      'sms_magic_link',
      'mobile-device'
    );
  });

  it('returns 400 when request body is missing', async () => {
    const claims = createMockClaims({ role: 'platform_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/tokens',
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when worker_id is not a valid UUID', async () => {
    const claims = createMockClaims({ role: 'platform_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/tokens',
      body: {
        worker_id: 'not-a-uuid',
        site_id: '550e8400-e29b-41d4-a716-446655440002',
        token_type: 'qr_session',
        device_id: 'device-abc',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when device_id is empty', async () => {
    const claims = createMockClaims({ role: 'platform_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/tokens',
      body: {
        worker_id: '550e8400-e29b-41d4-a716-446655440001',
        site_id: '550e8400-e29b-41d4-a716-446655440002',
        token_type: 'qr_session',
        device_id: '',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 401 when no authorization is provided', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/tokens',
      body: {
        worker_id: '550e8400-e29b-41d4-a716-446655440001',
        site_id: '550e8400-e29b-41d4-a716-446655440002',
        token_type: 'qr_session',
        device_id: 'device-abc',
      },
      noAuth: true,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });
});

describe('DELETE /access/tokens/{id} - E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 confirming deletion when token exists', async () => {
    const tenantId = 'tenant-test';
    const tokenId = '550e8400-e29b-41d4-a716-446655440099';

    vi.mocked(revokeToken).mockResolvedValueOnce({ success: true });

    const claims = createMockClaims({
      role: 'platform_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'DELETE',
      resource: '/access/tokens/{id}',
      path: `/access/tokens/${tokenId}`,
      pathParameters: { id: tokenId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.message).toContain('revoked');
  });

  it('calls revokeToken with correct tenant and token ID', async () => {
    const tenantId = 'tenant-test';
    const tokenId = 'token-to-revoke';

    vi.mocked(revokeToken).mockResolvedValueOnce({ success: true });

    const claims = createMockClaims({
      role: 'platform_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'DELETE',
      resource: '/access/tokens/{id}',
      path: `/access/tokens/${tokenId}`,
      pathParameters: { id: tokenId },
      claims,
    });

    await handler(event);

    expect(revokeToken).toHaveBeenCalledWith(tenantId, tokenId);
  });

  it('returns 404 when token does not exist', async () => {
    const tenantId = 'tenant-test';
    const tokenId = 'non-existent-token';

    vi.mocked(revokeToken).mockResolvedValueOnce({
      success: false,
      error: 'Token not found',
    });

    const claims = createMockClaims({
      role: 'platform_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'DELETE',
      resource: '/access/tokens/{id}',
      path: `/access/tokens/${tokenId}`,
      pathParameters: { id: tokenId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toContain('Token not found');
  });

  it('returns 401 when no authorization is provided', async () => {
    const tokenId = 'token-123';

    const event = createMockEvent({
      httpMethod: 'DELETE',
      resource: '/access/tokens/{id}',
      path: `/access/tokens/${tokenId}`,
      pathParameters: { id: tokenId },
      noAuth: true,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });
});
