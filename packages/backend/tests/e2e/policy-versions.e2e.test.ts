/**
 * E2E tests for policy version endpoints.
 * Tests the full handler path: routing → auth → validation → business logic → response.
 *
 * Validates: Requirements 4.10, 4.11, 4.12
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockEvent } from '../helpers/mock-event.js';
import { createMockClaims } from '../helpers/mock-user.js';
import { setupDynamoMock, getDynamoCalls, resetDynamoMock, getMockSend } from '../helpers/mock-dynamo.js';

// Mock DynamoDB client
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock event publisher (SNS)
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({
    event_id: 'evt-mock',
    event_type: 'SITE_POLICY_PUBLISHED',
    source_service: 'policy-service',
    tenant_id: 'tenant-test',
    timestamp: '2024-01-01T00:00:00.000Z',
    payload: {},
    correlation_id: 'corr-mock',
    version: '1.0',
  }),
}));

// Import handler after mocks are in place
import { handler } from '../../src/services/policy/handler.js';

// --- Test Data ---

const POLICY_ID = 'policy-001-uuid';
const VERSION_ID = 'version-001-uuid';
const TENANT_ID = 'tenant-test';

const mockPolicy = {
  PK: `TENANT#${TENANT_ID}`,
  SK: `POLICY#${POLICY_ID}`,
  policy_id: POLICY_ID,
  tenant_id: TENANT_ID,
  site_id: 'site-001-uuid',
  name: 'Safety Policy',
  description: 'Standard safety policy for site operations',
  jurisdiction: 'BC',
  owner_type: 'tenant',
  owner_id: 'owner-001-uuid',
  current_version_number: 1,
  created_at: '2024-01-01T00:00:00.000Z',
  created_by: 'user-test-1',
  updated_at: '2024-01-01T00:00:00.000Z',
};

const mockVersion = {
  PK: `POLICY#${POLICY_ID}`,
  SK: `VERSION#${VERSION_ID}`,
  policy_version_id: VERSION_ID,
  policy_id: POLICY_ID,
  tenant_id: TENANT_ID,
  version_number: 1,
  effective_from: '2024-01-01',
  effective_to: '2024-12-31',
  rules: [
    {
      rule_id: 'rule-1',
      rule_type: 'certification_required',
      description: 'WHMIS certification required',
      conditions: { certification_type: 'whmis_2015' },
      actions: { block_access: true },
    },
  ],
  rule_snapshot_json: JSON.stringify([
    {
      rule_id: 'rule-1',
      rule_type: 'certification_required',
      description: 'WHMIS certification required',
      conditions: { certification_type: 'whmis_2015' },
      actions: { block_access: true },
    },
  ]),
  change_summary: 'Initial version',
  published_by: 'user-test-1',
  published_at: '2024-01-01T00:00:00.000Z',
  is_active: true,
  used_in_decisions: false,
};

// --- Tests ---

describe('POST /policies/{id}/versions - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns 201 with new version record for valid input', async () => {
    // Setup: policy exists, no existing versions (for overlap check), version number query returns empty
    const policyQueryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${TENANT_ID}`,
        ':sk': `POLICY#${POLICY_ID}`,
      },
    });

    const versionsQueryKey = JSON.stringify({
      TableName: 'test-PolicyVersions',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `POLICY#${POLICY_ID}`,
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [policyQueryKey, [mockPolicy]],
        [versionsQueryKey, []],
      ]),
      putCapture: [],
      updateCapture: [],
    });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      path: `/policies/${POLICY_ID}/versions`,
      pathParameters: { id: POLICY_ID },
      body: {
        effective_from: '2025-01-01',
        effective_to: '2025-12-31',
        rules: [
          {
            rule_id: 'rule-new-1',
            rule_type: 'certification_required',
            description: 'Updated WHMIS requirement',
            conditions: { certification_type: 'whmis_2015' },
            actions: { block_access: true },
          },
        ],
        change_summary: 'Added new certification requirement',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('version');

    const version = body.version;
    expect(version).toHaveProperty('policy_version_id');
    expect(version).toHaveProperty('policy_id', POLICY_ID);
    expect(version).toHaveProperty('tenant_id', TENANT_ID);
    expect(version).toHaveProperty('version_number');
    expect(version).toHaveProperty('effective_from', '2025-01-01');
    expect(version).toHaveProperty('effective_to', '2025-12-31');
    expect(version).toHaveProperty('rules');
    expect(version.rules).toHaveLength(1);
    expect(version).toHaveProperty('change_summary', 'Added new certification requirement');
    expect(version).toHaveProperty('published_by');
    expect(version).toHaveProperty('published_at');
    expect(version).toHaveProperty('is_active', true);
    expect(version).toHaveProperty('used_in_decisions', false);

    // Verify DynamoDB PutCommand was called for the version
    const calls = getDynamoCalls();
    const putCalls = calls.filter((c) => c.command === 'PutCommand');
    expect(putCalls.length).toBeGreaterThanOrEqual(1);

    const versionPut = putCalls.find((c) => {
      const input = c.input as Record<string, unknown>;
      return input['TableName'] === 'test-PolicyVersions';
    });
    expect(versionPut).toBeDefined();
  });

  it('returns 404 when policy does not exist', async () => {
    const policyQueryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${TENANT_ID}`,
        ':sk': `POLICY#non-existent-id`,
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [policyQueryKey, []],
      ]),
    });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      path: '/policies/non-existent-id/versions',
      pathParameters: { id: 'non-existent-id' },
      body: {
        effective_from: '2025-01-01',
        rules: [
          {
            rule_id: 'rule-1',
            rule_type: 'test',
            description: 'Test rule',
            conditions: {},
            actions: {},
          },
        ],
        change_summary: 'Test version',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 when body is missing', async () => {
    const policyQueryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${TENANT_ID}`,
        ':sk': `POLICY#${POLICY_ID}`,
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [policyQueryKey, [mockPolicy]],
      ]),
    });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      path: `/policies/${POLICY_ID}/versions`,
      pathParameters: { id: POLICY_ID },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 401 when no auth is provided', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      path: `/policies/${POLICY_ID}/versions`,
      pathParameters: { id: POLICY_ID },
      body: {
        effective_from: '2025-01-01',
        rules: [
          {
            rule_id: 'rule-1',
            rule_type: 'test',
            description: 'Test rule',
            conditions: {},
            actions: {},
          },
        ],
        change_summary: 'Test version',
      },
      noAuth: true,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(401);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /policies/{id} (versions listing) - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns 200 with policy and versions array', async () => {
    const policyQueryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${TENANT_ID}`,
        ':sk': `POLICY#${POLICY_ID}`,
      },
    });

    const versionsQueryKey = JSON.stringify({
      TableName: 'test-PolicyVersions',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `POLICY#${POLICY_ID}`,
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [policyQueryKey, [mockPolicy]],
        [versionsQueryKey, [mockVersion]],
      ]),
    });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies/{id}',
      path: `/policies/${POLICY_ID}`,
      pathParameters: { id: POLICY_ID },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('policy');
    expect(body.policy).toHaveProperty('versions');
    expect(Array.isArray(body.policy.versions)).toBe(true);
    expect(body.policy.versions).toHaveLength(1);

    const version = body.policy.versions[0];
    expect(version).toHaveProperty('policy_version_id', VERSION_ID);
    expect(version).toHaveProperty('policy_id', POLICY_ID);
    expect(version).toHaveProperty('version_number', 1);
    expect(version).toHaveProperty('effective_from', '2024-01-01');
    expect(version).toHaveProperty('change_summary', 'Initial version');
    expect(version).toHaveProperty('is_active', true);
  });

  it('returns 200 with empty versions array when no versions exist', async () => {
    const policyQueryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${TENANT_ID}`,
        ':sk': `POLICY#${POLICY_ID}`,
      },
    });

    const versionsQueryKey = JSON.stringify({
      TableName: 'test-PolicyVersions',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `POLICY#${POLICY_ID}`,
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [policyQueryKey, [mockPolicy]],
        [versionsQueryKey, []],
      ]),
    });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies/{id}',
      path: `/policies/${POLICY_ID}`,
      pathParameters: { id: POLICY_ID },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.policy.versions).toEqual([]);
  });

  it('returns 404 when policy does not exist', async () => {
    const policyQueryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${TENANT_ID}`,
        ':sk': `POLICY#non-existent-id`,
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [policyQueryKey, []],
      ]),
    });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies/{id}',
      path: '/policies/non-existent-id',
      pathParameters: { id: 'non-existent-id' },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });
});

describe('GET /policies/{id}/versions/{versionId} - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns 200 with the matching version record', async () => {
    const policyQueryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${TENANT_ID}`,
        ':sk': `POLICY#${POLICY_ID}`,
      },
    });

    const versionQueryKey = JSON.stringify({
      TableName: 'test-PolicyVersions',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `POLICY#${POLICY_ID}`,
        ':sk': `VERSION#${VERSION_ID}`,
      },
    });

    // DecisionRecords query for immutability check
    const decisionsQueryKey = JSON.stringify({
      TableName: 'test-DecisionRecords',
      IndexName: 'GSI2',
      ExpressionAttributeValues: {
        ':pk': `POLICYVERSION#${VERSION_ID}`,
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [policyQueryKey, [mockPolicy]],
        [versionQueryKey, [mockVersion]],
        [decisionsQueryKey, []],
      ]),
    });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies/{id}/versions/{versionId}',
      path: `/policies/${POLICY_ID}/versions/${VERSION_ID}`,
      pathParameters: { id: POLICY_ID, versionId: VERSION_ID },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('is_immutable', false);

    const version = body.version;
    expect(version).toHaveProperty('policy_version_id', VERSION_ID);
    expect(version).toHaveProperty('policy_id', POLICY_ID);
    expect(version).toHaveProperty('tenant_id', TENANT_ID);
    expect(version).toHaveProperty('version_number', 1);
    expect(version).toHaveProperty('effective_from', '2024-01-01');
    expect(version).toHaveProperty('effective_to', '2024-12-31');
    expect(version).toHaveProperty('rules');
    expect(version.rules).toHaveLength(1);
    expect(version).toHaveProperty('change_summary', 'Initial version');
    expect(version).toHaveProperty('published_by', 'user-test-1');
    expect(version).toHaveProperty('published_at');
    expect(version).toHaveProperty('is_active', true);
    expect(version).toHaveProperty('used_in_decisions', false);
  });

  it('returns 404 when version does not exist', async () => {
    const policyQueryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${TENANT_ID}`,
        ':sk': `POLICY#${POLICY_ID}`,
      },
    });

    const versionQueryKey = JSON.stringify({
      TableName: 'test-PolicyVersions',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `POLICY#${POLICY_ID}`,
        ':sk': `VERSION#non-existent-version`,
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [policyQueryKey, [mockPolicy]],
        [versionQueryKey, []],
      ]),
    });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies/{id}/versions/{versionId}',
      path: `/policies/${POLICY_ID}/versions/non-existent-version`,
      pathParameters: { id: POLICY_ID, versionId: 'non-existent-version' },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 when policy does not exist', async () => {
    const policyQueryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${TENANT_ID}`,
        ':sk': `POLICY#non-existent-policy`,
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [policyQueryKey, []],
      ]),
    });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies/{id}/versions/{versionId}',
      path: '/policies/non-existent-policy/versions/some-version',
      pathParameters: { id: 'non-existent-policy', versionId: 'some-version' },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 401 when no auth is provided', async () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies/{id}/versions/{versionId}',
      path: `/policies/${POLICY_ID}/versions/${VERSION_ID}`,
      pathParameters: { id: POLICY_ID, versionId: VERSION_ID },
      noAuth: true,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(401);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });
});
