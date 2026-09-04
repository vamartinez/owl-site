/**
 * E2E tests for POST /access/request and POST /access/scan.
 * Verifies 200 decision result for access request and 200 scan session response.
 *
 * Tests invoke the access service handler directly with mock API Gateway events,
 * mocking DynamoDB, the decision engine, token-manager, scan-session, and event-publisher.
 *
 * Requirements: 6.1, 6.2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockEvent } from '../helpers/mock-event';
import { createMockClaims } from '../helpers/mock-user';
import {
  setupDynamoMock,
  resetDynamoMock,
  getMockSend,
} from '../helpers/mock-dynamo';

// --- Mocks ---

// Mock DynamoDB client
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock uuid for deterministic IDs
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'generated-uuid-001'),
}));

// Mock the decision engine evaluator
vi.mock('../../src/services/decision-engine/evaluator.js', () => ({
  evaluateDecision: vi.fn().mockResolvedValue({
    response: {
      decision: 'allowed',
      decision_id: 'decision-id-001',
      reasons: ['All certifications valid'],
      policy_version_used: 'policy-v1.0',
    },
    error: null,
  }),
}));

// Mock token-manager
vi.mock('../../src/services/access/token-manager.js', () => ({
  generateToken: vi.fn().mockResolvedValue({
    token_id: 'token-id-001',
    tenant_id: 'tenant-test',
    worker_id: 'worker-id-001',
    site_id: 'site-id-001',
    token_type: 'qr_session',
    device_id: 'device-001',
    issued_at: '2024-06-15T10:00:00.000Z',
    expires_at: '2024-06-15T10:10:00.000Z',
    revoked: false,
    used: false,
  }),
  getToken: vi.fn().mockResolvedValue({
    token_id: 'token-id-001',
    tenant_id: 'tenant-test',
    worker_id: 'worker-id-001',
    site_id: 'site-id-001',
    token_type: 'qr_session',
    device_id: 'device-001',
    issued_at: '2024-06-15T10:00:00.000Z',
    expires_at: '2099-06-15T10:10:00.000Z',
    revoked: false,
    used: false,
  }),
  validateToken: vi.fn().mockReturnValue({ valid: true }),
  markTokenUsed: vi.fn().mockResolvedValue(undefined),
  revokeToken: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock scan-session
vi.mock('../../src/services/access/scan-session.js', () => ({
  recordScanSession: vi.fn().mockResolvedValue({
    session_id: 'session-id-001',
    tenant_id: 'tenant-test',
    worker_id: 'worker-id-001',
    site_id: 'site-id-001',
    timestamp: '2024-06-15T10:30:00.000Z',
    scanner_type: 'qr',
    device_id: 'device-001',
    token_ref: 'token-id-001',
    decision_ref: 'decision-id-001',
    result: 'allowed',
    replay_risk_flag: false,
    policy_version_used: 'policy-v1.0',
  }),
  detectReplay: vi.fn().mockResolvedValue({ isReplay: false }),
}));

// Mock event-publisher
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({}),
}));

// Mock filter-utils
vi.mock('../../src/shared/filter-utils.js', () => ({
  buildFilterExpression: vi.fn().mockReturnValue(null),
}));

// Import handler after mocks are set up
import { handler } from '../../src/services/access/handler';

describe('Access Service E2E — POST /access/request', () => {
  beforeEach(() => {
    resetDynamoMock();
    setupDynamoMock({});
  });

  it('returns 200 with decision result for a valid access request', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/request',
      body: {
        worker_id: '550e8400-e29b-41d4-a716-446655440000',
        site_id: '660e8400-e29b-41d4-a716-446655440000',
        token_type: 'qr_session',
        device_id: 'device-001',
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('decision');
    expect(body).toHaveProperty('decision_id');
    expect(body).toHaveProperty('token_id');
    expect(body).toHaveProperty('reasons');
    expect(body.decision).toBe('allowed');
    expect(body.decision_id).toBe('decision-id-001');
    expect(body.token_id).toBe('token-id-001');
    expect(body.reasons).toEqual(['All certifications valid']);
  });

  it('returns decision with policy_version_used field', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/request',
      body: {
        worker_id: '550e8400-e29b-41d4-a716-446655440000',
        site_id: '660e8400-e29b-41d4-a716-446655440000',
        token_type: 'qr_session',
        device_id: 'device-001',
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('policy_version_used');
    expect(body.policy_version_used).toBe('policy-v1.0');
  });

  it('returns decision with expires_at from token', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/request',
      body: {
        worker_id: '550e8400-e29b-41d4-a716-446655440000',
        site_id: '660e8400-e29b-41d4-a716-446655440000',
        token_type: 'sms_magic_link',
        device_id: 'device-002',
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('expires_at');
    expect(body.expires_at).toBe('2024-06-15T10:10:00.000Z');
  });

  it('returns 400 when request body is missing', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/request',
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when worker_id is not a valid UUID', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/request',
      body: {
        worker_id: 'not-a-uuid',
        site_id: '660e8400-e29b-41d4-a716-446655440000',
        token_type: 'qr_session',
        device_id: 'device-001',
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when required fields are missing', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/request',
      body: {
        worker_id: '550e8400-e29b-41d4-a716-446655440000',
        // missing site_id, token_type, device_id
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });
});

describe('Access Service E2E — POST /access/scan', () => {
  beforeEach(() => {
    resetDynamoMock();
    setupDynamoMock({});
  });

  it('returns 200 with scan session result for a valid scan', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/scan',
      body: {
        token_id: '550e8400-e29b-41d4-a716-446655440000',
        device_id: 'device-001',
        scanner_type: 'qr',
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('decision');
    expect(body).toHaveProperty('session_id');
    expect(body).toHaveProperty('reasons');
    expect(body.session_id).toBe('session-id-001');
    expect(body.decision).toBe('allowed');
  });

  it('returns scan result with decision_id and policy_version_used', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/scan',
      body: {
        token_id: '550e8400-e29b-41d4-a716-446655440000',
        device_id: 'device-001',
        scanner_type: 'qr',
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('decision_id');
    expect(body).toHaveProperty('policy_version_used');
    expect(body.decision_id).toBe('decision-id-001');
    expect(body.policy_version_used).toBe('policy-v1.0');
  });

  it('returns replay_risk_flag as false for a valid first-time scan', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/scan',
      body: {
        token_id: '550e8400-e29b-41d4-a716-446655440000',
        device_id: 'device-001',
        scanner_type: 'qr',
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.replay_risk_flag).toBe(false);
  });

  it('returns 400 when request body is missing', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/scan',
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when token_id is not a valid UUID', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/scan',
      body: {
        token_id: 'invalid-token-id',
        device_id: 'device-001',
        scanner_type: 'qr',
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when scanner_type is invalid', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/scan',
      body: {
        token_id: '550e8400-e29b-41d4-a716-446655440000',
        device_id: 'device-001',
        scanner_type: 'invalid_type',
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 404 when token is not found', async () => {
    // Override getToken to return null for this test
    const { getToken } = await import('../../src/services/access/token-manager.js');
    (getToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const claims = createMockClaims({ role: 'gate_operator' });
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/scan',
      body: {
        token_id: '550e8400-e29b-41d4-a716-446655440000',
        device_id: 'device-001',
        scanner_type: 'qr',
      },
      claims,
    });

    const response = await handler(event as any);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });
});
