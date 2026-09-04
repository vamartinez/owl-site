/**
 * E2E tests for GET /access/decisions/{id}
 *
 * Tests the full handler path: routing → auth → permission check → DynamoDB query → response.
 * AWS SDK is mocked at module level; auth is exercised via Cognito authorizer claims
 * in requestContext.authorizer.claims.
 *
 * Validates: Requirements 6.3
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
import { docClient } from '../../src/shared/dynamo-client.js';

describe('GET /access/decisions/{id} - E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with full decision record when decision exists', async () => {
    const decisionId = 'dec-abc-123';
    const tenantId = 'tenant-test';

    const mockDecisionRecord = {
      PK: `TENANT#${tenantId}`,
      SK: `DECISION#${decisionId}`,
      decision_id: decisionId,
      decision_result: 'allowed',
      decision_type: 'site_access',
      subject_type: 'worker',
      subject_id: 'worker-001',
      site_id: 'site-001',
      reasons: ['All certifications valid', 'No active violations'],
      rules_applied: ['cert_check', 'violation_check', 'policy_compliance'],
      policy_version_used: 'policy-v3',
      jurisdiction: 'BC',
      timestamp: '2024-06-15T10:30:00.000Z',
      explainability_payload: JSON.stringify({
        decision_path: ['cert_check:pass', 'violation_check:pass', 'policy_compliance:pass'],
        confidence: 0.98,
      }),
    };

    // Configure DynamoDB mock to return the decision record
    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [mockDecisionRecord],
      Count: 1,
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'tenant_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/access/decisions/{id}',
      path: `/access/decisions/${decisionId}`,
      pathParameters: { id: decisionId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('decision');

    const decision = body.decision;
    expect(decision.decision_id).toBe(decisionId);
    expect(decision.decision_result).toBe('allowed');
    expect(decision.decision_type).toBe('site_access');
    expect(decision.subject_type).toBe('worker');
    expect(decision.subject_id).toBe('worker-001');
    expect(decision.site_id).toBe('site-001');
    expect(decision.reasons).toEqual(['All certifications valid', 'No active violations']);
    expect(decision.rules_applied).toEqual(['cert_check', 'violation_check', 'policy_compliance']);
    expect(decision.policy_version_used).toBe('policy-v3');
    expect(decision.jurisdiction).toBe('BC');
    expect(decision.timestamp).toBe('2024-06-15T10:30:00.000Z');
    expect(decision.explainability).toEqual({
      decision_path: ['cert_check:pass', 'violation_check:pass', 'policy_compliance:pass'],
      confidence: 0.98,
    });
  });

  it('returns 200 with null explainability when no explainability_payload stored', async () => {
    const decisionId = 'dec-no-explain';
    const tenantId = 'tenant-test';

    const mockDecisionRecord = {
      PK: `TENANT#${tenantId}`,
      SK: `DECISION#${decisionId}`,
      decision_id: decisionId,
      decision_result: 'denied',
      decision_type: 'site_access',
      subject_type: 'worker',
      subject_id: 'worker-002',
      site_id: 'site-002',
      reasons: ['Missing required certification: first_aid'],
      rules_applied: ['cert_check'],
      policy_version_used: 'policy-v2',
      jurisdiction: 'BC',
      timestamp: '2024-06-16T14:00:00.000Z',
    };

    vi.mocked(docClient.send).mockResolvedValueOnce({
      Items: [mockDecisionRecord],
      Count: 1,
      $metadata: {},
    } as never);

    const claims = createMockClaims({
      role: 'site_admin',
      tenant_id: tenantId,
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/access/decisions/{id}',
      path: `/access/decisions/${decisionId}`,
      pathParameters: { id: decisionId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.decision.decision_id).toBe(decisionId);
    expect(body.decision.decision_result).toBe('denied');
    expect(body.decision.explainability).toBeNull();
  });

  it('returns 404 when decision record does not exist', async () => {
    const decisionId = 'non-existent-decision';
    const tenantId = 'tenant-test';

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
      httpMethod: 'GET',
      resource: '/access/decisions/{id}',
      path: `/access/decisions/${decisionId}`,
      pathParameters: { id: decisionId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toContain('Decision record not found');
  });

  it('returns 401 when no authorization is provided', async () => {
    const decisionId = 'dec-abc-123';

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/access/decisions/{id}',
      path: `/access/decisions/${decisionId}`,
      pathParameters: { id: decisionId },
      noAuth: true,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('queries DynamoDB with correct tenant-scoped key', async () => {
    const decisionId = 'dec-query-check';
    const tenantId = 'tenant-test';

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
      httpMethod: 'GET',
      resource: '/access/decisions/{id}',
      path: `/access/decisions/${decisionId}`,
      pathParameters: { id: decisionId },
      claims,
    });

    await handler(event);

    expect(docClient.send).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(docClient.send).mock.calls[0]![0] as unknown as {
      input: Record<string, unknown>;
    };
    expect(callArg.input).toMatchObject({
      TableName: 'test-DecisionRecords',
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `DECISION#${decisionId}`,
      },
    });
  });
});
