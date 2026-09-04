/**
 * Unit tests for policy validation.
 * Verifies that schema violations are rejected with the expected error code (BAD_REQUEST).
 *
 * Tests missing required fields, invalid types, and constraint violations
 * for policy creation and version creation endpoints.
 *
 * Validates: Requirements 3.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEvent } from '../../../../tests/helpers/mock-event.js';
import { createMockClaims } from '../../../../tests/helpers/mock-user.js';
import { setupDynamoMock, getMockSend, resetDynamoMock } from '../../../../tests/helpers/mock-dynamo.js';

// Mock DynamoDB before importing handler
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock event-publisher to avoid SNS calls
vi.mock('../../../shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

import { handler } from '../handler.js';

// --- Test Setup ---

const validClaims = createMockClaims({ role: 'tenant_admin' });

function parseResponseBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

// --- Tests ---

describe('Policy Validation — Create Policy (POST /policies)', () => {
  beforeEach(() => {
    resetDynamoMock();
    setupDynamoMock();
  });

  it('rejects empty body with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects missing required field "name" with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        description: 'A valid description',
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
    expect(body['message']).toContain('Validation failed');
  });

  it('rejects missing required field "site_id" with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        name: 'Fall Protection Policy',
        description: 'A valid description',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects invalid UUID for site_id with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        name: 'Fall Protection Policy',
        description: 'A valid description',
        site_id: 'not-a-valid-uuid',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects invalid owner_type enum value with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        name: 'Fall Protection Policy',
        description: 'A valid description',
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        jurisdiction: 'BC',
        owner_type: 'invalid_type',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects name exceeding max length constraint (200 chars) with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        name: 'x'.repeat(201),
        description: 'A valid description',
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects empty string for name with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        name: '',
        description: 'A valid description',
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects invalid type (number where string expected) with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: {
        name: 12345,
        description: 'A valid description',
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        owner_id: '550e8400-e29b-41d4-a716-446655440001',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });
});

describe('Policy Validation — Create Version (POST /policies/{id}/versions)', () => {
  beforeEach(() => {
    resetDynamoMock();
    // Set up mock to return a valid policy when queried
    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(
      JSON.stringify({
        TableName: 'test-Policies',
        IndexName: undefined,
        ExpressionAttributeValues: {
          ':pk': 'TENANT#tenant-test',
          ':sk': 'POLICY#policy-123',
        },
      }),
      [
        {
          policy_id: 'policy-123',
          tenant_id: 'tenant-test',
          site_id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Test Policy',
          description: 'Test description',
          jurisdiction: 'BC',
          owner_type: 'tenant',
          owner_id: '550e8400-e29b-41d4-a716-446655440001',
          current_version_number: 0,
          created_at: '2024-01-01T00:00:00.000Z',
          created_by: 'user-test-1',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ]
    );
    setupDynamoMock({ queryResponses });
  });

  it('rejects empty body with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      pathParameters: { id: 'policy-123' },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects missing required field "effective_from" with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      pathParameters: { id: 'policy-123' },
      body: {
        rules: [
          {
            rule_id: 'rule-1',
            rule_type: 'certification_required',
            description: 'Must have cert',
            conditions: {},
            actions: {},
          },
        ],
        change_summary: 'Initial version',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects invalid date format for effective_from with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      pathParameters: { id: 'policy-123' },
      body: {
        effective_from: '2024/06/01',
        rules: [
          {
            rule_id: 'rule-1',
            rule_type: 'certification_required',
            description: 'Must have cert',
            conditions: {},
            actions: {},
          },
        ],
        change_summary: 'Initial version',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects empty rules array with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      pathParameters: { id: 'policy-123' },
      body: {
        effective_from: '2024-06-01',
        rules: [],
        change_summary: 'Initial version',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects change_summary exceeding 1000 chars with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      pathParameters: { id: 'policy-123' },
      body: {
        effective_from: '2024-06-01',
        rules: [
          {
            rule_id: 'rule-1',
            rule_type: 'certification_required',
            description: 'Must have cert',
            conditions: {},
            actions: {},
          },
        ],
        change_summary: 'x'.repeat(1001),
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects empty change_summary with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      pathParameters: { id: 'policy-123' },
      body: {
        effective_from: '2024-06-01',
        rules: [
          {
            rule_id: 'rule-1',
            rule_type: 'certification_required',
            description: 'Must have cert',
            conditions: {},
            actions: {},
          },
        ],
        change_summary: '',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects rule with empty rule_id with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      pathParameters: { id: 'policy-123' },
      body: {
        effective_from: '2024-06-01',
        rules: [
          {
            rule_id: '',
            rule_type: 'certification_required',
            description: 'Must have cert',
            conditions: {},
            actions: {},
          },
        ],
        change_summary: 'Initial version',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects rule with description exceeding 500 chars with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies/{id}/versions',
      pathParameters: { id: 'policy-123' },
      body: {
        effective_from: '2024-06-01',
        rules: [
          {
            rule_id: 'rule-1',
            rule_type: 'certification_required',
            description: 'x'.repeat(501),
            conditions: {},
            actions: {},
          },
        ],
        change_summary: 'Initial version',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });
});

describe('Policy Validation — Update Version (PATCH /policies/{id}/versions/{versionId})', () => {
  beforeEach(() => {
    resetDynamoMock();
    // Set up mock to return a valid policy and version when queried
    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(
      JSON.stringify({
        TableName: 'test-Policies',
        IndexName: undefined,
        ExpressionAttributeValues: {
          ':pk': 'TENANT#tenant-test',
          ':sk': 'POLICY#policy-123',
        },
      }),
      [
        {
          policy_id: 'policy-123',
          tenant_id: 'tenant-test',
          site_id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Test Policy',
          description: 'Test description',
          jurisdiction: 'BC',
          owner_type: 'tenant',
          owner_id: '550e8400-e29b-41d4-a716-446655440001',
          current_version_number: 1,
          created_at: '2024-01-01T00:00:00.000Z',
          created_by: 'user-test-1',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ]
    );
    setupDynamoMock({ queryResponses });
  });

  it('rejects empty body with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/policies/{id}/versions/{versionId}',
      pathParameters: { id: 'policy-123', versionId: 'version-1' },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects change_summary exceeding 1000 chars with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/policies/{id}/versions/{versionId}',
      pathParameters: { id: 'policy-123', versionId: 'version-1' },
      body: {
        change_summary: 'x'.repeat(1001),
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });

  it('rejects invalid effective_to date format with 400 BAD_REQUEST', async () => {
    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/policies/{id}/versions/{versionId}',
      pathParameters: { id: 'policy-123', versionId: 'version-1' },
      body: {
        effective_to: '2024/12/31',
      },
      claims: validClaims,
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(400);

    const body = parseResponseBody(response.body);
    expect(body['code']).toBe('BAD_REQUEST');
  });
});
