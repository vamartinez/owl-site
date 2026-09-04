/**
 * E2E tests for policies CRUD endpoints.
 * Tests the full handler path: routing → auth → validation → business logic → response.
 *
 * Validates: Requirements 4.7, 4.8, 4.9
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

describe('POST /policies - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
    setupDynamoMock({
      putCapture: [],
    });
  });

  it('returns 201 with created policy object for valid input', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        name: 'Fall Protection Policy',
        description: 'Governs fall protection requirements for all sites',
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        jurisdiction: 'British Columbia',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('policy');

    const policy = body.policy;
    expect(policy).toHaveProperty('policy_id');
    expect(policy).toHaveProperty('tenant_id', 'tenant-test');
    expect(policy).toHaveProperty('name', 'Fall Protection Policy');
    expect(policy).toHaveProperty('description', 'Governs fall protection requirements for all sites');
    expect(policy).toHaveProperty('site_id', '550e8400-e29b-41d4-a716-446655440000');
    expect(policy).toHaveProperty('jurisdiction', 'British Columbia');
    expect(policy).toHaveProperty('owner_type', 'tenant');
    expect(policy).toHaveProperty('owner_id', '550e8400-e29b-41d4-a716-446655440001');
    expect(policy).toHaveProperty('current_version_number', 0);
    expect(policy).toHaveProperty('created_at');
    expect(policy).toHaveProperty('updated_at');
    expect(policy).toHaveProperty('created_by', 'user-test-1');

    // Verify UUID format for policy_id
    expect(policy.policy_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    // Verify DynamoDB PutCommands were called (policy + draft version)
    const calls = getDynamoCalls();
    const putCalls = calls.filter((c) => c.command === 'PutCommand');
    expect(putCalls.length).toBe(2);

    // First put: the policy record
    const policyPut = putCalls[0]!.input as Record<string, unknown>;
    expect(policyPut).toHaveProperty('TableName', 'test-Policies');
    const policyItem = policyPut['Item'] as Record<string, unknown>;
    expect(policyItem['PK']).toBe('TENANT#tenant-test');
    expect(policyItem['SK']).toMatch(/^POLICY#/);

    // Second put: the draft version record
    const versionPut = putCalls[1]!.input as Record<string, unknown>;
    expect(versionPut).toHaveProperty('TableName', 'test-PolicyVersions');
    const versionItem = versionPut['Item'] as Record<string, unknown>;
    expect(versionItem['status']).toBe('draft');
    expect(versionItem['version_number']).toBe(1);
  });

  it('returns 400 when body is missing', async () => {
    const claims = createMockClaims({ role: 'tenant_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when required fields are missing', async () => {
    const claims = createMockClaims({ role: 'tenant_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        name: 'Incomplete Policy',
        // Missing description, site_id, jurisdiction, owner_type, owner_id
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.message).toContain('Validation failed');
  });

  it('returns 401 when no auth is provided', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        name: 'Test Policy',
        description: 'Test description',
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
      },
      noAuth: true,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(401);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when worker role attempts to create a policy', async () => {
    const claims = createMockClaims({ role: 'worker' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        name: 'Test Policy',
        description: 'Test description',
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(403);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('FORBIDDEN');
  });
});

describe('GET /policies - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns 200 with array of policies', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    // Set up query response for listing policies
    const queryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': 'TENANT#tenant-test',
        ':prefix': 'POLICY#',
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, [
      {
        policy_id: 'policy-1',
        tenant_id: 'tenant-test',
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Fall Protection Policy',
        description: 'Fall protection requirements',
        jurisdiction: 'British Columbia',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
        current_version_number: 2,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-06-01T00:00:00.000Z',
      },
      {
        policy_id: 'policy-2',
        tenant_id: 'tenant-test',
        site_id: '550e8400-e29b-41d4-a716-446655440002',
        name: 'PPE Requirements',
        description: 'Personal protective equipment requirements',
        jurisdiction: 'Alberta',
        owner_type: 'site',
        owner_id: '550e8400-e29b-41d4-a716-446655440003',
        current_version_number: 1,
        created_at: '2024-02-01T00:00:00.000Z',
        updated_at: '2024-02-01T00:00:00.000Z',
      },
    ]);

    setupDynamoMock({ queryResponses });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies',
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('policies');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.policies)).toBe(true);
    expect(body.policies).toHaveLength(2);
    expect(body.total).toBe(2);

    // Verify policy fields
    const firstPolicy = body.policies[0];
    expect(firstPolicy).toHaveProperty('policy_id', 'policy-1');
    expect(firstPolicy).toHaveProperty('name', 'Fall Protection Policy');
    expect(firstPolicy).toHaveProperty('tenant_id', 'tenant-test');
    expect(firstPolicy).toHaveProperty('site_id');
    expect(firstPolicy).toHaveProperty('jurisdiction');
    expect(firstPolicy).toHaveProperty('owner_type');
    expect(firstPolicy).toHaveProperty('created_at');
  });

  it('returns 200 with empty array when no policies exist', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    setupDynamoMock({ queryResponses: new Map() });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies',
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.policies).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns 401 when no auth is provided', async () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies',
      noAuth: true,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /policies/{id} - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns 200 with matching policy and versions', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const policyId = '550e8400-e29b-41d4-a716-446655440099';

    // Set up query responses: one for getting the policy, one for getting versions
    const policyQueryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': 'TENANT#tenant-test',
        ':sk': `POLICY#${policyId}`,
      },
    });

    const versionsQueryKey = JSON.stringify({
      TableName: 'test-PolicyVersions',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `POLICY#${policyId}`,
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(policyQueryKey, [
      {
        policy_id: policyId,
        tenant_id: 'tenant-test',
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Fall Protection Policy',
        description: 'Governs fall protection requirements',
        jurisdiction: 'British Columbia',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
        current_version_number: 1,
        created_at: '2024-01-01T00:00:00.000Z',
        created_by: 'user-test-1',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
    ]);
    queryResponses.set(versionsQueryKey, [
      {
        policy_version_id: 'version-1',
        policy_id: policyId,
        tenant_id: 'tenant-test',
        version_number: 1,
        effective_from: '2024-01-01',
        effective_to: '2024-12-31',
        rules: [],
        rule_snapshot_json: '[]',
        change_summary: 'Initial draft',
        published_by: 'user-test-1',
        published_at: '2024-01-01T00:00:00.000Z',
        is_active: true,
        used_in_decisions: false,
      },
    ]);

    setupDynamoMock({ queryResponses });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies/{id}',
      path: `/policies/${policyId}`,
      pathParameters: { id: policyId },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('policy');

    const policy = body.policy;
    expect(policy).toHaveProperty('policy_id', policyId);
    expect(policy).toHaveProperty('name', 'Fall Protection Policy');
    expect(policy).toHaveProperty('tenant_id', 'tenant-test');
    expect(policy).toHaveProperty('description', 'Governs fall protection requirements');
    expect(policy).toHaveProperty('jurisdiction', 'British Columbia');
    expect(policy).toHaveProperty('versions');
    expect(Array.isArray(policy.versions)).toBe(true);
    expect(policy.versions).toHaveLength(1);
    expect(policy.versions[0]).toHaveProperty('version_number', 1);
  });

  it('returns 404 when policy does not exist', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const policyId = 'non-existent-policy-id';

    setupDynamoMock({ queryResponses: new Map() });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/policies/{id}',
      path: `/policies/${policyId}`,
      pathParameters: { id: policyId },
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
      resource: '/policies/{id}',
      path: '/policies/some-id',
      pathParameters: { id: 'some-id' },
      noAuth: true,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(401);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });
});
