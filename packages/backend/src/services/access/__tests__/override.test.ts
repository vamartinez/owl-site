/**
 * Unit tests for the override creation module in the Access Service.
 * Verifies:
 *   1. Override record references the decision and includes the authorizing user (Req 5.6)
 *   2. Unauthorized role (gate_operator) is rejected with a permission error (Req 5.7)
 *
 * Requirements: 5.6, 5.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDynamoMock, getDynamoCalls, getMockSend, resetDynamoMock } from '../../../../tests/helpers/mock-dynamo.js';
import { mockAuthSuccess, resetAuthMock } from '../../../../tests/helpers/mock-auth.js';
import { createMockClaims } from '../../../../tests/helpers/mock-user.js';
import { Role, OverrideStatus } from '../../../shared/types/common.js';

// Mock DynamoDB client
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock auth middleware
vi.mock('../../../shared/auth-middleware.js', async () => {
  const { createAuthMock } = await import('../../../../tests/helpers/mock-auth.js');
  return {
    authenticateRequest: createAuthMock(),
  };
});

// Mock event publisher (not under test)
vi.mock('../../../shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock decision engine (not under test)
vi.mock('../../decision-engine/evaluator.js', () => ({
  evaluateDecision: vi.fn().mockResolvedValue({ response: { decision: 'allowed', decision_id: 'dec-001', reasons: [] } }),
}));

// Mock token-manager (not under test)
vi.mock('../token-manager.js', () => ({
  generateToken: vi.fn().mockResolvedValue({ token_id: 'tok-001', expires_at: new Date().toISOString() }),
  getToken: vi.fn().mockResolvedValue(null),
  validateToken: vi.fn().mockReturnValue({ valid: true }),
  markTokenUsed: vi.fn().mockResolvedValue(undefined),
  revokeToken: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock scan-session (not under test)
vi.mock('../scan-session.js', () => ({
  recordScanSession: vi.fn().mockResolvedValue({ session_id: 'sess-001' }),
  detectReplay: vi.fn().mockResolvedValue({ isReplay: false }),
}));

// Mock uuid to return predictable values
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('override-uuid-001'),
}));

// Import handler after mocks are set up
import { handler } from '../handler.js';

function createOverrideEvent(body: Record<string, unknown>, claims?: Record<string, string>) {
  const userClaims = claims ?? createMockClaims({ role: 'tenant_admin' });
  return {
    httpMethod: 'POST',
    resource: '/access/override',
    path: '/access/override',
    pathParameters: null,
    queryStringParameters: null,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mock-token',
    },
    body: JSON.stringify(body),
    requestContext: {
      requestId: 'req-override-001',
      authorizer: {
        claims: userClaims,
      },
    },
  };
}

describe('override creation module', () => {
  beforeEach(() => {
    resetDynamoMock();
    resetAuthMock();
  });

  describe('Requirement 5.6: Override record references decision and includes authorizing user', () => {
    it('creates an override record that references the decision_id and includes the requester user_id', async () => {
      const decisionId = '550e8400-e29b-41d4-a716-446655440000';
      const userId = 'user-admin-001';
      const tenantId = 'tenant-abc';

      // Set up auth mock with known user
      mockAuthSuccess({
        user_id: userId,
        tenant_id: tenantId,
        role: Role.TENANT_ADMIN,
      });

      // Mock the decision lookup to return an existing decision
      const queryKey = JSON.stringify({
        TableName: 'test-DecisionRecords',
        IndexName: undefined,
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':sk': `DECISION#${decisionId}`,
        },
      });

      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({
        queryResponses: new Map([
          [queryKey, [{ decision_id: decisionId, tenant_id: tenantId }]],
        ]),
        putCapture,
      });

      const event = createOverrideEvent({
        decision_id: decisionId,
        reason: 'Worker has verbal confirmation from site admin',
        evidence: 'Photo of signed authorization form',
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.override).toBeDefined();
      expect(body.override.decision_id).toBe(decisionId);
      expect(body.override.requester_id).toBe(userId);
      expect(body.override.tenant_id).toBe(tenantId);
      expect(body.override.status).toBe(OverrideStatus.PENDING);
      expect(body.override.reason).toBe('Worker has verbal confirmation from site admin');
      expect(body.override.evidence).toBe('Photo of signed authorization form');
      expect(body.override.override_id).toBeDefined();
      expect(body.override.created_at).toBeDefined();
      expect(body.override.updated_at).toBeDefined();
    });

    it('persists the override with correct DynamoDB keys referencing the decision', async () => {
      const decisionId = '660e8400-e29b-41d4-a716-446655440000';
      const userId = 'user-cso-001';
      const tenantId = 'tenant-xyz';

      mockAuthSuccess({
        user_id: userId,
        tenant_id: tenantId,
        role: Role.CSO,
      });

      const queryKey = JSON.stringify({
        TableName: 'test-DecisionRecords',
        IndexName: undefined,
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':sk': `DECISION#${decisionId}`,
        },
      });

      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({
        queryResponses: new Map([
          [queryKey, [{ decision_id: decisionId, tenant_id: tenantId }]],
        ]),
        putCapture,
      });

      const event = createOverrideEvent({
        decision_id: decisionId,
        reason: 'Emergency access needed',
        evidence: 'Signed waiver attached',
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(201);

      // Verify the PutCommand was called with the override data
      const dynamoCalls = getDynamoCalls();
      const putCalls = dynamoCalls.filter(c => c.command === 'PutCommand');
      expect(putCalls.length).toBe(1);

      const putInput = putCalls[0]!.input as Record<string, unknown>;
      expect(putInput.TableName).toBe('test-OverrideRequests');

      const item = putInput.Item as Record<string, unknown>;
      expect(item.PK).toBe(`TENANT#${tenantId}`);
      expect(item.SK).toContain('OVERRIDE#');
      expect(item.GSI1PK).toBe(`DECISION#${decisionId}`);
      expect(item.decision_id).toBe(decisionId);
      expect(item.requester_id).toBe(userId);
      expect(item.tenant_id).toBe(tenantId);
      expect(item.status).toBe(OverrideStatus.PENDING);
    });
  });

  describe('Requirement 5.7: Unauthorized role rejection', () => {
    it('rejects override creation by gate_operator with a 403 permission error', async () => {
      mockAuthSuccess({
        user_id: 'user-gate-001',
        tenant_id: 'tenant-abc',
        role: Role.GATE_OPERATOR,
      });

      const event = createOverrideEvent({
        decision_id: '770e8400-e29b-41d4-a716-446655440000',
        reason: 'Worker needs access',
        evidence: 'N/A',
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toContain('permission');
    });

    it('rejects override creation by worker role with a 403 permission error', async () => {
      mockAuthSuccess({
        user_id: 'user-worker-001',
        tenant_id: 'tenant-abc',
        role: Role.WORKER,
      });

      const event = createOverrideEvent({
        decision_id: '880e8400-e29b-41d4-a716-446655440000',
        reason: 'I need access to site',
        evidence: 'None',
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('FORBIDDEN');
    });

    it('allows override creation by site_admin (authorized role)', async () => {
      const decisionId = '990e8400-e29b-41d4-a716-446655440000';
      const tenantId = 'tenant-abc';

      mockAuthSuccess({
        user_id: 'user-siteadmin-001',
        tenant_id: tenantId,
        role: Role.SITE_ADMIN,
      });

      const queryKey = JSON.stringify({
        TableName: 'test-DecisionRecords',
        IndexName: undefined,
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':sk': `DECISION#${decisionId}`,
        },
      });

      setupDynamoMock({
        queryResponses: new Map([
          [queryKey, [{ decision_id: decisionId, tenant_id: tenantId }]],
        ]),
        putCapture: [],
      });

      const event = createOverrideEvent({
        decision_id: decisionId,
        reason: 'Site admin approved verbally',
        evidence: 'Email confirmation',
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(201);
    });
  });
});
