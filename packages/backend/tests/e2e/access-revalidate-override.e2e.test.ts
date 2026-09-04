/**
 * E2E tests for POST /access/revalidate and override endpoints.
 * - POST /access/revalidate → 200 with new decision
 * - POST /access/override → 201 with override record
 * - PATCH /access/override/{id} → 200 with updated override
 *
 * Tests invoke the access service handler directly with mock API Gateway events,
 * mocking DynamoDB, the decision engine, token-manager, scan-session, and event-publisher.
 *
 * Requirements: 6.6, 6.7, 6.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEvent } from '../helpers/mock-event.js';
import { createMockClaims } from '../helpers/mock-user.js';

// Mock DynamoDB client
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: (name: string) => `test-${name}`,
}));

// Mock event-publisher
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({}),
}));

// Mock decision engine
vi.mock('../../src/services/decision-engine/evaluator.js', () => ({
  evaluateDecision: vi.fn().mockResolvedValue({
    response: {
      decision: 'allowed',
      decision_id: 'new-decision-id-001',
      reasons: ['Certifications updated and now valid'],
      policy_version_used: 'policy-v2.0',
    },
    error: null,
  }),
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

// Mock filter-utils
vi.mock('../../src/shared/filter-utils.js', () => ({
  buildFilterExpression: vi.fn().mockReturnValue(null),
}));

// Mock uuid for deterministic IDs
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'generated-uuid-001'),
}));

import { handler } from '../../src/services/access/handler.js';
import { docClient } from '../../src/shared/dynamo-client.js';

// ─── POST /access/revalidate ────────────────────────────────────────────────

describe('POST /access/revalidate - E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with revalidation result for a valid request', async () => {
    const tenantId = 'tenant-test';

    // Mock: QueryCommand for revalidation attempts count (returns 0 previous attempts)
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      Count: 0,
      $metadata: {},
    } as never);

    // Mock: PutCommand for recording the revalidation attempt
    vi.mocked(docClient.send).mockResolvedValueOnce({
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'gate_operator',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/revalidate',
      body: {
        original_decision_id: '550e8400-e29b-41d4-a716-446655440000',
        worker_id: '660e8400-e29b-41d4-a716-446655440000',
        site_id: '770e8400-e29b-41d4-a716-446655440000',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('attempt_id');
    expect(body).toHaveProperty('original_decision_id', '550e8400-e29b-41d4-a716-446655440000');
    expect(body).toHaveProperty('new_decision_id');
    expect(body).toHaveProperty('new_result');
    expect(body).toHaveProperty('reasons');
    expect(body).toHaveProperty('attempts_remaining');
    expect(body.new_result).toBe('allowed');
    expect(body.reasons).toEqual(['Certifications updated and now valid']);
    expect(body.attempts_remaining).toBe(2); // 3 - (0 + 1) = 2
  });

  it('returns attempts_remaining reflecting previous attempts', async () => {
    const tenantId = 'tenant-test';

    // Mock: 2 previous attempts exist
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        { attempt_id: 'attempt-1', attempted_at: new Date().toISOString() },
        { attempt_id: 'attempt-2', attempted_at: new Date().toISOString() },
      ],
      Count: 2,
      $metadata: {},
    } as never);

    // Mock: PutCommand for recording the revalidation attempt
    vi.mocked(docClient.send).mockResolvedValueOnce({
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'gate_operator',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/revalidate',
      body: {
        original_decision_id: '550e8400-e29b-41d4-a716-446655440000',
        worker_id: '660e8400-e29b-41d4-a716-446655440000',
        site_id: '770e8400-e29b-41d4-a716-446655440000',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.attempts_remaining).toBe(0); // 3 - (2 + 1) = 0
  });

  it('returns 409 when max revalidation attempts (3) reached', async () => {
    const tenantId = 'tenant-test';

    // Mock: 3 previous attempts exist (max reached)
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [
        { attempt_id: 'attempt-1', attempted_at: new Date().toISOString() },
        { attempt_id: 'attempt-2', attempted_at: new Date().toISOString() },
        { attempt_id: 'attempt-3', attempted_at: new Date().toISOString() },
      ],
      Count: 3,
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'gate_operator',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/revalidate',
      body: {
        original_decision_id: '550e8400-e29b-41d4-a716-446655440000',
        worker_id: '660e8400-e29b-41d4-a716-446655440000',
        site_id: '770e8400-e29b-41d4-a716-446655440000',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('CONFLICT');
    expect(body.message).toContain('Maximum revalidation attempts');
  });

  it('returns 400 when request body is missing', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/revalidate',
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when original_decision_id is not a valid UUID', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/revalidate',
      body: {
        original_decision_id: 'not-a-valid-uuid',
        worker_id: '660e8400-e29b-41d4-a716-446655440000',
        site_id: '770e8400-e29b-41d4-a716-446655440000',
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
      resource: '/access/revalidate',
      body: {
        original_decision_id: '550e8400-e29b-41d4-a716-446655440000',
        worker_id: '660e8400-e29b-41d4-a716-446655440000',
        site_id: '770e8400-e29b-41d4-a716-446655440000',
      },
      noAuth: true,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });
});

// ─── POST /access/override ──────────────────────────────────────────────────

describe('POST /access/override - E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 201 with override record for a valid request', async () => {
    const tenantId = 'tenant-test';
    const decisionId = '550e8400-e29b-41d4-a716-446655440000';

    // Mock: QueryCommand to verify decision exists
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [{
        PK: `TENANT#${tenantId}`,
        SK: `DECISION#${decisionId}`,
        decision_id: decisionId,
        decision_result: 'denied',
      }],
      Count: 1,
      $metadata: {},
    } as never);

    // Mock: PutCommand for creating the override
    vi.mocked(docClient.send).mockResolvedValueOnce({
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'tenant_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/override',
      body: {
        decision_id: decisionId,
        reason: 'Worker has verbal confirmation from site admin',
        evidence: 'Photo of signed authorization form attached',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('override');

    const override = body.override;
    expect(override).toHaveProperty('override_id');
    expect(override).toHaveProperty('tenant_id', tenantId);
    expect(override).toHaveProperty('decision_id', decisionId);
    expect(override).toHaveProperty('requester_id', 'user-test-1');
    expect(override).toHaveProperty('reason', 'Worker has verbal confirmation from site admin');
    expect(override).toHaveProperty('evidence', 'Photo of signed authorization form attached');
    expect(override).toHaveProperty('status', 'pending');
    expect(override).toHaveProperty('created_at');
    expect(override).toHaveProperty('updated_at');
  });

  it('returns 404 when referenced decision does not exist', async () => {
    const tenantId = 'tenant-test';

    // Mock: QueryCommand returns empty (decision not found)
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      Count: 0,
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'tenant_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/override',
      body: {
        decision_id: '550e8400-e29b-41d4-a716-446655440000',
        reason: 'Reason text',
        evidence: 'Evidence text',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toContain('Decision record not found');
  });

  it('returns 400 when request body is missing', async () => {
    const claims = createMockClaims({ role: 'tenant_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/override',
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when decision_id is not a valid UUID', async () => {
    const claims = createMockClaims({ role: 'tenant_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/override',
      body: {
        decision_id: 'not-valid-uuid',
        reason: 'Valid reason',
        evidence: 'Valid evidence',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when reason is empty', async () => {
    const claims = createMockClaims({ role: 'tenant_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/override',
      body: {
        decision_id: '550e8400-e29b-41d4-a716-446655440000',
        reason: '',
        evidence: 'Valid evidence',
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
      resource: '/access/override',
      body: {
        decision_id: '550e8400-e29b-41d4-a716-446655440000',
        reason: 'Override reason',
        evidence: 'Evidence text',
      },
      noAuth: true,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when gate_operator role attempts override', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/access/override',
      body: {
        decision_id: '550e8400-e29b-41d4-a716-446655440000',
        reason: 'Override reason',
        evidence: 'Evidence text',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('FORBIDDEN');
  });
});

// ─── PATCH /access/override/{id} ────────────────────────────────────────────

describe('PATCH /access/override/{id} - E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with updated override when approving', async () => {
    const tenantId = 'tenant-test';
    const overrideId = 'override-abc-123';
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Mock: QueryCommand to retrieve the existing override (pending status)
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [{
        PK: `TENANT#${tenantId}`,
        SK: `OVERRIDE#${overrideId}`,
        override_id: overrideId,
        tenant_id: tenantId,
        decision_id: 'decision-001',
        requester_id: 'user-requester-1',
        reason: 'Worker has valid credentials',
        evidence: 'Photo evidence',
        status: 'pending',
        created_at: '2024-06-15T10:00:00.000Z',
        updated_at: '2024-06-15T10:00:00.000Z',
      }],
      Count: 1,
      $metadata: {},
    } as never);

    // Mock: UpdateCommand for updating the override
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Attributes: {},
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'tenant_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/access/override/{id}',
      path: `/access/override/${overrideId}`,
      pathParameters: { id: overrideId },
      body: {
        status: 'approved',
        expiration_date: futureDate,
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('override_id', overrideId);
    expect(body).toHaveProperty('status', 'approved');
    expect(body).toHaveProperty('approver_id', 'user-test-1');
    expect(body).toHaveProperty('approved_at');
    expect(body).toHaveProperty('expiration_date', futureDate);
  });

  it('returns 200 when rejecting an override', async () => {
    const tenantId = 'tenant-test';
    const overrideId = 'override-reject-001';

    // Mock: QueryCommand to retrieve the existing override (pending status)
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [{
        PK: `TENANT#${tenantId}`,
        SK: `OVERRIDE#${overrideId}`,
        override_id: overrideId,
        tenant_id: tenantId,
        decision_id: 'decision-002',
        requester_id: 'user-requester-2',
        reason: 'Worker claims to have certification',
        evidence: 'No evidence available',
        status: 'pending',
        created_at: '2024-06-15T10:00:00.000Z',
        updated_at: '2024-06-15T10:00:00.000Z',
      }],
      Count: 1,
      $metadata: {},
    } as never);

    // Mock: UpdateCommand
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Attributes: {},
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'site_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/access/override/{id}',
      path: `/access/override/${overrideId}`,
      pathParameters: { id: overrideId },
      body: {
        status: 'rejected',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('override_id', overrideId);
    expect(body).toHaveProperty('status', 'rejected');
    expect(body).toHaveProperty('approver_id', 'user-test-1');
    expect(body).toHaveProperty('approved_at');
    expect(body.expiration_date).toBeUndefined();
  });

  it('returns 404 when override does not exist', async () => {
    const tenantId = 'tenant-test';
    const overrideId = 'non-existent-override';

    // Mock: QueryCommand returns empty
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [],
      Count: 0,
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'tenant_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/access/override/{id}',
      path: `/access/override/${overrideId}`,
      pathParameters: { id: overrideId },
      body: {
        status: 'approved',
        expiration_date: '2025-01-01',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toContain('Override request not found');
  });

  it('returns 409 when override has already been processed', async () => {
    const tenantId = 'tenant-test';
    const overrideId = 'override-already-done';

    // Mock: QueryCommand returns an already-approved override
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [{
        PK: `TENANT#${tenantId}`,
        SK: `OVERRIDE#${overrideId}`,
        override_id: overrideId,
        status: 'approved',
        created_at: '2024-06-15T10:00:00.000Z',
        updated_at: '2024-06-16T10:00:00.000Z',
      }],
      Count: 1,
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'tenant_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/access/override/{id}',
      path: `/access/override/${overrideId}`,
      pathParameters: { id: overrideId },
      body: {
        status: 'rejected',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('CONFLICT');
    expect(body.message).toContain('already been processed');
  });

  it('returns 400 when approving without expiration_date', async () => {
    const tenantId = 'tenant-test';
    const overrideId = 'override-no-exp';

    // Mock: QueryCommand to retrieve existing pending override
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [{
        PK: `TENANT#${tenantId}`,
        SK: `OVERRIDE#${overrideId}`,
        override_id: overrideId,
        status: 'pending',
        created_at: '2024-06-15T10:00:00.000Z',
        updated_at: '2024-06-15T10:00:00.000Z',
      }],
      Count: 1,
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'tenant_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/access/override/{id}',
      path: `/access/override/${overrideId}`,
      pathParameters: { id: overrideId },
      body: {
        status: 'approved',
        // Missing expiration_date
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.message).toContain('expiration_date is required');
  });

  it('returns 400 when expiration_date exceeds 90 days', async () => {
    const tenantId = 'tenant-test';
    const overrideId = 'override-too-far';
    const tooFarDate = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Mock: QueryCommand to retrieve existing pending override
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [{
        PK: `TENANT#${tenantId}`,
        SK: `OVERRIDE#${overrideId}`,
        override_id: overrideId,
        status: 'pending',
        created_at: '2024-06-15T10:00:00.000Z',
        updated_at: '2024-06-15T10:00:00.000Z',
      }],
      Count: 1,
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'tenant_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/access/override/{id}',
      path: `/access/override/${overrideId}`,
      pathParameters: { id: overrideId },
      body: {
        status: 'approved',
        expiration_date: tooFarDate,
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.message).toContain('90 days');
  });

  it('returns 400 when request body is missing', async () => {
    const claims = createMockClaims({ role: 'tenant_admin' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/access/override/{id}',
      path: '/access/override/override-123',
      pathParameters: { id: 'override-123' },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when status is invalid', async () => {
    const claims = createMockClaims({ role: 'tenant_admin' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/access/override/{id}',
      path: '/access/override/override-123',
      pathParameters: { id: 'override-123' },
      body: {
        status: 'invalid_status',
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
      httpMethod: 'PATCH',
      resource: '/access/override/{id}',
      path: '/access/override/override-123',
      pathParameters: { id: 'override-123' },
      body: {
        status: 'approved',
        expiration_date: '2025-01-01',
      },
      noAuth: true,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when gate_operator role attempts to update override', async () => {
    const claims = createMockClaims({ role: 'gate_operator' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/access/override/{id}',
      path: '/access/override/override-123',
      pathParameters: { id: 'override-123' },
      body: {
        status: 'approved',
        expiration_date: '2025-01-01',
      },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('FORBIDDEN');
  });
});
