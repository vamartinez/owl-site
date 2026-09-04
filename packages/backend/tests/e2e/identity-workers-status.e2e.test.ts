/**
 * E2E tests for GET /workers/{id}/status endpoint.
 * Tests the full handler path through routing, auth, and business logic.
 * The status endpoint returns worker eligibility status based on their
 * certifications and compliance state.
 *
 * Validates: Requirements 2.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEvent } from '../helpers/mock-event.js';
import { createMockClaims } from '../helpers/mock-user.js';
import { setupDynamoMock, getMockSend, resetDynamoMock } from '../helpers/mock-dynamo.js';

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

describe('E2E: GET /workers/{id}/status', () => {
  const tenantId = 'tenant-test';
  const workerId = 'worker-abc-123';
  const claims = createMockClaims({ tenant_id: tenantId, role: 'tenant_admin' });

  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns 200 with eligibility status for a worker with valid certifications', async () => {
    const workerGetKey = JSON.stringify({
      PK: `TENANT#${tenantId}`,
      SK: `WORKER#${workerId}`,
    });

    // The handler queries Certifications table with PK and SK begins_with
    // The mock matches on TableName + IndexName + ExpressionAttributeValues
    const certQueryKey = JSON.stringify({
      TableName: 'test-Certifications',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#WORKER#${workerId}`,
        ':prefix': 'CERT#',
      },
    });

    setupDynamoMock({
      getResponses: new Map([
        [workerGetKey, {
          worker_id: workerId,
          tenant_id: tenantId,
          legal_name: 'Jane Doe',
          phone: '+14155551234',
          language_preference: 'en',
          status: 'active',
          created_at: '2024-01-15T10:00:00.000Z',
          updated_at: '2024-03-10T14:30:00.000Z',
        }],
      ]),
      queryResponses: new Map([
        [certQueryKey, [
          {
            certification_id: 'cert-1',
            worker_id: workerId,
            certification_type: 'whmis_2015',
            issuer: 'BC Safety Authority',
            issue_date: '2024-01-15',
            expiry_date: '2028-01-15',
            validation_status: 'validated',
            created_at: '2024-01-15T10:00:00.000Z',
          },
          {
            certification_id: 'cert-2',
            worker_id: workerId,
            certification_type: 'first_aid',
            issuer: 'Red Cross',
            issue_date: '2024-03-01',
            expiry_date: '2028-03-01',
            validation_status: 'validated',
            created_at: '2024-03-01T08:00:00.000Z',
          },
        ]],
      ]),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/status',
      path: `/workers/${workerId}/status`,
      pathParameters: { id: workerId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.certifications_summary).toHaveProperty('total');
    expect(body.certifications_summary).toHaveProperty('valid');
    expect(body.certifications_summary.total).toBe(2);
    expect(body.certifications_summary.valid).toBe(2);
    expect(body.eligible).toBe(true);
  });

  it('returns 200 with ineligible status when certifications are expired', async () => {
    const workerGetKey = JSON.stringify({
      PK: `TENANT#${tenantId}`,
      SK: `WORKER#${workerId}`,
    });

    const certQueryKey = JSON.stringify({
      TableName: 'test-Certifications',
      IndexName: undefined,
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#WORKER#${workerId}`,
        ':prefix': 'CERT#',
      },
    });

    setupDynamoMock({
      getResponses: new Map([
        [workerGetKey, {
          worker_id: workerId,
          tenant_id: tenantId,
          legal_name: 'Jane Doe',
          phone: '+14155551234',
          language_preference: 'en',
          status: 'active',
          created_at: '2024-01-15T10:00:00.000Z',
          updated_at: '2024-03-10T14:30:00.000Z',
        }],
      ]),
      queryResponses: new Map([
        [certQueryKey, [
          {
            certification_id: 'cert-1',
            worker_id: workerId,
            certification_type: 'whmis_2015',
            issuer: 'BC Safety Authority',
            issue_date: '2022-01-15',
            expiry_date: '2023-01-15',
            validation_status: 'expired',
            created_at: '2022-01-15T10:00:00.000Z',
          },
        ]],
      ]),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/status',
      path: `/workers/${workerId}/status`,
      pathParameters: { id: workerId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('worker_id', workerId);
    expect(body).toHaveProperty('eligible');
    expect(body.eligible).toBe(false);
    expect(body).toHaveProperty('certifications_summary');
    expect(body.certifications_summary).toHaveProperty('expired');
    expect(body.certifications_summary.expired).toBeGreaterThan(0);
  });

  it('returns 200 with status when worker has no certifications', async () => {
    const workerGetKey = JSON.stringify({
      PK: `TENANT#${tenantId}`,
      SK: `WORKER#${workerId}`,
    });

    setupDynamoMock({
      getResponses: new Map([
        [workerGetKey, {
          worker_id: workerId,
          tenant_id: tenantId,
          legal_name: 'Jane Doe',
          phone: '+14155551234',
          language_preference: 'en',
          status: 'active',
          created_at: '2024-01-15T10:00:00.000Z',
          updated_at: '2024-03-10T14:30:00.000Z',
        }],
      ]),
      queryResponses: new Map(),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/status',
      path: `/workers/${workerId}/status`,
      pathParameters: { id: workerId },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty('worker_id', workerId);
    expect(body).toHaveProperty('eligible');
    expect(body).toHaveProperty('certifications_summary');
    expect(body.certifications_summary.total).toBe(0);
  });

  it('returns 404 when worker does not exist', async () => {
    setupDynamoMock({
      getResponses: new Map(),
      queryResponses: new Map(),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/status',
      path: '/workers/non-existent-id/status',
      pathParameters: { id: 'non-existent-id' },
      claims,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 401 when no auth is provided', async () => {
    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/status',
      path: `/workers/${workerId}/status`,
      pathParameters: { id: workerId },
      noAuth: true,
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });
});
