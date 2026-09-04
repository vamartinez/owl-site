/**
 * E2E tests for GET /workers and GET /workers/{id} endpoints.
 * Tests the full handler path through routing, auth, and business logic
 * with mocked AWS SDK (DynamoDB).
 *
 * Validates: Requirements 2.2, 2.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEvent } from '../helpers/mock-event.js';
import { createMockClaims } from '../helpers/mock-user.js';
import { setupDynamoMock, getMockSend } from '../helpers/mock-dynamo.js';

// Mock DynamoDB client
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock event publisher (SNS) to prevent actual network calls
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({}),
}));

// Set required env var
process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123456789:test-topic';

import { handler } from '../../src/services/identity/handler.js';

describe('E2E: GET /workers', () => {
  const tenantId = 'tenant-test';
  const claims = createMockClaims({ tenant_id: tenantId, role: 'tenant_admin' });

  beforeEach(() => {
    setupDynamoMock();
  });

  it('returns 200 with an array of workers', async () => {
    // Configure DynamoDB to return workers on query
    const queryKey = JSON.stringify({
      TableName: 'test-Workers',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': 'WORKER#',
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [queryKey, [
          {
            worker_id: 'worker-1',
            legal_name: 'Jane Doe',
            preferred_name: 'Jane',
            phone: '+14155551234',
            language_preference: 'en',
            created_at: '2024-01-01T00:00:00.000Z',
          },
          {
            worker_id: 'worker-2',
            legal_name: 'Carlos Garcia',
            preferred_name: 'Carlos',
            phone: '+14155555678',
            language_preference: 'es',
            created_at: '2024-02-01T00:00:00.000Z',
          },
        ]],
      ]),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('workers');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.workers)).toBe(true);
    expect(body.workers).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('returns workers with expected fields', async () => {
    const queryKey = JSON.stringify({
      TableName: 'test-Workers',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': 'WORKER#',
      },
    });

    setupDynamoMock({
      queryResponses: new Map([
        [queryKey, [
          {
            worker_id: 'worker-1',
            legal_name: 'Jane Doe',
            preferred_name: 'Jane',
            phone: '+14155551234',
            language_preference: 'en',
            created_at: '2024-01-01T00:00:00.000Z',
          },
        ]],
      ]),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const worker = body.workers[0];
    expect(worker).toHaveProperty('worker_id', 'worker-1');
    expect(worker).toHaveProperty('legal_name', 'Jane Doe');
    expect(worker).toHaveProperty('preferred_name', 'Jane');
    expect(worker).toHaveProperty('phone', '+14155551234');
    expect(worker).toHaveProperty('language_preference', 'en');
    expect(worker).toHaveProperty('created_at', '2024-01-01T00:00:00.000Z');
  });

  it('returns 200 with empty array when no workers exist', async () => {
    // Default setupDynamoMock returns empty arrays for queries
    setupDynamoMock({
      queryResponses: new Map(),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers',
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.workers).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe('E2E: GET /workers/{id}', () => {
  const tenantId = 'tenant-test';
  const claims = createMockClaims({ tenant_id: tenantId, role: 'tenant_admin' });
  const workerId = 'worker-abc-123';

  beforeEach(() => {
    setupDynamoMock();
  });

  it('returns 200 with a single worker object', async () => {
    const getKey = JSON.stringify({
      PK: `TENANT#${tenantId}`,
      SK: `WORKER#${workerId}`,
    });

    setupDynamoMock({
      getResponses: new Map([
        [getKey, {
          worker_id: workerId,
          tenant_id: tenantId,
          legal_name: 'John Smith',
          preferred_name: 'Johnny',
          phone: '+14155559999',
          language_preference: 'en',
          status: 'active',
          created_at: '2024-01-15T10:00:00.000Z',
          updated_at: '2024-03-10T14:30:00.000Z',
        }],
      ]),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}',
      path: `/workers/${workerId}`,
      pathParameters: { id: workerId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('worker');
    expect(body.worker.worker_id).toBe(workerId);
    expect(body.worker.tenant_id).toBe(tenantId);
    expect(body.worker.legal_name).toBe('John Smith');
    expect(body.worker.preferred_name).toBe('Johnny');
    expect(body.worker.phone).toBe('+14155559999');
    expect(body.worker.language_preference).toBe('en');
    expect(body.worker.status).toBe('active');
    expect(body.worker.created_at).toBe('2024-01-15T10:00:00.000Z');
    expect(body.worker.updated_at).toBe('2024-03-10T14:30:00.000Z');
  });

  it('returns 404 when worker does not exist', async () => {
    // Default mock returns undefined for get (no item found)
    setupDynamoMock({
      getResponses: new Map(),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}',
      path: '/workers/non-existent-id',
      pathParameters: { id: 'non-existent-id' },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toContain('Worker not found');
  });
});
