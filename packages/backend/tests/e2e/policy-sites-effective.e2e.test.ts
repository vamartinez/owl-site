/**
 * E2E Tests for GET /sites/{id}/effective-policies and GET /sites/{id}/daily-summary.
 *
 * Tests invoke handlers directly with mock API Gateway events and mocked AWS SDK.
 * - GET /sites/{id}/effective-policies → Policy Service handler → 200 with aggregated policy list
 * - GET /sites/{id}/daily-summary → Reporting Service handler → 200 with daily summary object
 *
 * Validates: Requirements 4.5, 4.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEvent } from '../helpers/mock-event.js';
import { createMockClaims } from '../helpers/mock-user.js';
import { setupDynamoMock, getDynamoCalls, resetDynamoMock, getMockSend } from '../helpers/mock-dynamo.js';

// ─── Mock AWS SDK dependencies ───────────────────────────────────────────────

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: getMockSend() }) },
  PutCommand: vi.fn().mockImplementation((input) => ({ constructor: { name: 'PutCommand' }, input })),
  GetCommand: vi.fn().mockImplementation((input) => ({ constructor: { name: 'GetCommand' }, input })),
  QueryCommand: vi.fn().mockImplementation((input) => ({ constructor: { name: 'QueryCommand' }, input })),
  UpdateCommand: vi.fn().mockImplementation((input) => ({ constructor: { name: 'UpdateCommand' }, input })),
  DeleteCommand: vi.fn().mockImplementation((input) => ({ constructor: { name: 'DeleteCommand' }, input })),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn(() => ({ send: vi.fn() })),
  PublishCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: vi.fn() })),
  SendMessageCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
}));

// ─── Tests for GET /sites/{id}/effective-policies ────────────────────────────

describe('GET /sites/{id}/effective-policies', () => {
  const siteId = 'site-abc-123';
  const tenantId = 'tenant-test';

  beforeEach(() => {
    vi.resetModules();
    resetDynamoMock();
  });

  it('returns 200 with aggregated active policy list', async () => {
    const activePolicies = [
      {
        PK: `TENANT#${tenantId}`,
        SK: `POLICY#policy-1`,
        GSI1PK: `SITE#${siteId}`,
        policy_id: 'policy-1',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Safety Helmet Policy',
        description: 'Requires safety helmets on site',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        status: 'active',
        current_version_number: 2,
      },
      {
        PK: `TENANT#${tenantId}`,
        SK: `POLICY#policy-2`,
        GSI1PK: `SITE#${siteId}`,
        policy_id: 'policy-2',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Fire Safety Policy',
        description: 'Fire safety protocols',
        jurisdiction: 'BC',
        owner_type: 'site',
        status: 'active',
        current_version_number: 1,
      },
      {
        PK: `TENANT#${tenantId}`,
        SK: `POLICY#policy-3`,
        GSI1PK: `SITE#${siteId}`,
        policy_id: 'policy-3',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Draft Policy',
        description: 'Not yet active',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        status: 'draft',
        current_version_number: 0,
      },
    ];

    // The effective-policies module queries using GSI1 with SITE# prefix
    const queryKey = JSON.stringify({
      TableName: 'dev-Policies',
      IndexName: 'GSI1',
      ExpressionAttributeValues: { ':gsi1pk': `SITE#${siteId}` },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, activePolicies);

    setupDynamoMock({ queryResponses });

    const { handler } = await import('../../src/services/policy/handler.js');

    const claims = createMockClaims({ tenant_id: tenantId, role: 'tenant_admin' });
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/sites/{id}/effective-policies',
      path: `/sites/${siteId}/effective-policies`,
      pathParameters: { id: siteId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('policies');
    expect(Array.isArray(body.policies)).toBe(true);

    // Should only contain active policies (policy-1 and policy-2), not draft (policy-3)
    expect(body.policies).toHaveLength(2);
    expect(body.policies[0].policy_id).toBe('policy-1');
    expect(body.policies[0].name).toBe('Safety Helmet Policy');
    expect(body.policies[0].status).toBe('active');
    expect(body.policies[1].policy_id).toBe('policy-2');
    expect(body.policies[1].name).toBe('Fire Safety Policy');
    expect(body.total).toBe(2);
  });

  it('returns 200 with empty array when no active policies exist for site', async () => {
    const queryKey = JSON.stringify({
      TableName: 'dev-Policies',
      IndexName: 'GSI1',
      ExpressionAttributeValues: { ':gsi1pk': `SITE#${siteId}` },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, []);

    setupDynamoMock({ queryResponses });

    const { handler } = await import('../../src/services/policy/handler.js');

    const claims = createMockClaims({ tenant_id: tenantId, role: 'site_admin' });
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/sites/{id}/effective-policies',
      path: `/sites/${siteId}/effective-policies`,
      pathParameters: { id: siteId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.policies).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('returns 401 when request has no auth', async () => {
    setupDynamoMock();

    const { handler } = await import('../../src/services/policy/handler.js');

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/sites/{id}/effective-policies',
      path: `/sites/${siteId}/effective-policies`,
      pathParameters: { id: siteId },
      noAuth: true,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(401);
  });
});

// ─── Tests for GET /sites/{id}/daily-summary ─────────────────────────────────

describe('GET /sites/{id}/daily-summary', () => {
  const siteId = 'site-xyz-789';
  const tenantId = 'tenant-test';

  beforeEach(() => {
    vi.resetModules();
    resetDynamoMock();
  });

  it('returns 200 with daily compliance summary object', async () => {
    // The daily-summary handler calls generateDailyComplianceSummary which queries
    // multiple tables. We set up empty results so it generates a "no activity" summary.
    setupDynamoMock({ queryResponses: new Map(), putCapture: [] });

    const { handler } = await import('../../src/services/reporting/handler.js');

    const claims = createMockClaims({ tenant_id: tenantId, role: 'tenant_admin' });
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/sites/{id}/daily-summary',
      path: `/sites/${siteId}/daily-summary`,
      pathParameters: { id: siteId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse((response as { body: string }).body);
    expect(body).toHaveProperty('summary');

    const summary = body.summary;
    expect(summary).toHaveProperty('summary_id');
    expect(summary).toHaveProperty('site_id', siteId);
    expect(summary).toHaveProperty('tenant_id', tenantId);
    expect(summary).toHaveProperty('reporting_period_start');
    expect(summary).toHaveProperty('reporting_period_end');
    expect(summary).toHaveProperty('generated_at');
    expect(summary).toHaveProperty('access_decisions');
    expect(summary).toHaveProperty('findings');
    expect(summary).toHaveProperty('ai_narrative');
  });

  it('returns 200 with summary for specific date when date query param provided', async () => {
    const specificDate = '2024-06-15';
    const storedSummary = {
      summary_id: 'summary-stored-1',
      tenant_id: tenantId,
      site_id: siteId,
      reporting_period_start: `${specificDate}T00:00:00.000Z`,
      reporting_period_end: `${specificDate}T23:59:59.999Z`,
      generated_at: '2024-06-16T01:00:00.000Z',
      access_decisions: { allowed: 10, conditional: 2, denied: 1, total: 13 },
      findings: { generated: 3, confirmed: 1, dismissed: 1, pending_review: 1, total: 3 },
      unresolved_enforcement_actions: { count: 0, actions: [] },
      certification_compliance: [],
      active_policy_versions: [],
      ai_narrative: { summary_text: 'Normal operations', risk_trend: 'stable', key_observations: [] },
      no_activity: false,
    };

    // The handler calls getSummaryByDate which queries DynamoDB with date
    const queryKey = JSON.stringify({
      TableName: 'dev-DailyComplianceSummaries',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#SITE#${siteId}`,
        ':sk': `DATE#${specificDate}`,
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, [storedSummary as unknown as Record<string, unknown>]);

    setupDynamoMock({ queryResponses, putCapture: [] });

    const { handler } = await import('../../src/services/reporting/handler.js');

    const claims = createMockClaims({ tenant_id: tenantId, role: 'site_admin' });
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/sites/{id}/daily-summary',
      path: `/sites/${siteId}/daily-summary`,
      pathParameters: { id: siteId },
      queryStringParameters: { date: specificDate },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse((response as { body: string }).body);
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('summary_id');
    expect(body.summary).toHaveProperty('site_id', siteId);
  });

  it('returns 401 when request has no auth', async () => {
    setupDynamoMock();

    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/sites/{id}/daily-summary',
      path: `/sites/${siteId}/daily-summary`,
      pathParameters: { id: siteId },
      noAuth: true,
    });

    const response = await handler(event);

    expect((response as { statusCode: number }).statusCode).toBe(401);
  });

  it('returns 403 when worker role tries to access daily-summary', async () => {
    setupDynamoMock();

    const { handler } = await import('../../src/services/reporting/handler.js');

    const claims = createMockClaims({ tenant_id: tenantId, role: 'worker' });
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/sites/{id}/daily-summary',
      path: `/sites/${siteId}/daily-summary`,
      pathParameters: { id: siteId },
      claims,
    });

    const response = await handler(event);

    expect((response as { statusCode: number }).statusCode).toBe(403);
  });
});
