/**
 * E2E tests for PATCH /workers/{id} endpoint.
 * Tests the full handler path: routing → auth → validation → business logic → response.
 *
 * Validates: Requirements 2.4
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
    event_type: 'WORKER_UPDATED',
    source_service: 'identity-service',
    tenant_id: 'tenant-test',
    timestamp: '2024-01-01T00:00:00.000Z',
    payload: {},
    correlation_id: 'corr-mock',
    version: '1.0',
  }),
}));

// Import handler after mocks are in place
import { handler } from '../../src/services/identity/handler.js';

// Get reference to mock send for assertions
const mockSend = getMockSend();

const EXISTING_WORKER = {
  PK: 'TENANT#tenant-test',
  SK: 'WORKER#worker-123',
  worker_id: 'worker-123',
  tenant_id: 'tenant-test',
  legal_name: 'Jane Doe',
  preferred_name: 'Janie',
  phone: '+14155551234',
  language_preference: 'en',
  email: 'jane@example.com',
  qr_identity_reference: 'qr-ref-001',
  status: 'active',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

describe('PATCH /workers/{id} - E2E', () => {
  const getResponses = new Map<string, Record<string, unknown>>();

  beforeEach(() => {
    resetDynamoMock();
    getResponses.clear();

    // Configure GetCommand to return existing worker
    const getKey = JSON.stringify({ PK: 'TENANT#tenant-test', SK: 'WORKER#worker-123' });
    getResponses.set(getKey, { ...EXISTING_WORKER });

    setupDynamoMock({
      getResponses,
      updateCapture: [],
    });

    // Override mock to also handle UpdateCommand with ALL_NEW return behavior
    mockSend.mockImplementation((command: unknown) => {
      const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
      const commandName = cmd.constructor?.name ?? 'UnknownCommand';

      if (commandName === 'GetCommand') {
        const key = JSON.stringify(cmd.input.Key ?? {});
        const item = getResponses.get(key);
        return Promise.resolve({ Item: item ?? undefined });
      }

      if (commandName === 'UpdateCommand') {
        // Simulate ReturnValues: ALL_NEW — return existing worker with updated fields
        const expressionValues = cmd.input.ExpressionAttributeValues as Record<string, unknown> | undefined;
        const updated: Record<string, unknown> = { ...EXISTING_WORKER };

        if (expressionValues) {
          if (expressionValues[':legal_name'] !== undefined) {
            updated['legal_name'] = expressionValues[':legal_name'];
          }
          if (expressionValues[':preferred_name'] !== undefined) {
            updated['preferred_name'] = expressionValues[':preferred_name'];
          }
          if (expressionValues[':phone'] !== undefined) {
            updated['phone'] = expressionValues[':phone'];
          }
          if (expressionValues[':language_preference'] !== undefined) {
            updated['language_preference'] = expressionValues[':language_preference'];
          }
          if (expressionValues[':email'] !== undefined) {
            updated['email'] = expressionValues[':email'];
          }
          if (expressionValues[':updated_at'] !== undefined) {
            updated['updated_at'] = expressionValues[':updated_at'];
          }
        }

        return Promise.resolve({ Attributes: updated });
      }

      return Promise.resolve({});
    });
  });

  it('returns 200 with updated worker when valid fields are provided', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}',
      path: '/workers/worker-123',
      pathParameters: { id: 'worker-123' },
      body: {
        legal_name: 'Jane Smith',
        phone: '+14155559999',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('worker');

    const worker = body.worker;
    expect(worker.worker_id).toBe('worker-123');
    expect(worker.legal_name).toBe('Jane Smith');
    expect(worker.phone).toBe('+14155559999');
    // Unchanged fields should remain
    expect(worker.tenant_id).toBe('tenant-test');
    expect(worker.language_preference).toBe('en');
    // updated_at should be refreshed
    expect(worker.updated_at).toBeDefined();
    expect(worker.updated_at).not.toBe('2024-01-01T00:00:00.000Z');
  });

  it('returns 200 when updating only preferred_name', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}',
      path: '/workers/worker-123',
      pathParameters: { id: 'worker-123' },
      body: {
        preferred_name: 'JD',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.worker.preferred_name).toBe('JD');
    // Other fields remain unchanged
    expect(body.worker.legal_name).toBe('Jane Doe');
    expect(body.worker.phone).toBe('+14155551234');
  });

  it('returns 200 when updating language_preference', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}',
      path: '/workers/worker-123',
      pathParameters: { id: 'worker-123' },
      body: {
        language_preference: 'es',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.worker.language_preference).toBe('es');
  });

  it('returns 400 when body is missing', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}',
      path: '/workers/worker-123',
      pathParameters: { id: 'worker-123' },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when no updatable fields are provided', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}',
      path: '/workers/worker-123',
      pathParameters: { id: 'worker-123' },
      body: {},
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for invalid phone number format', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}',
      path: '/workers/worker-123',
      pathParameters: { id: 'worker-123' },
      body: {
        phone: '555-invalid',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 404 when worker does not exist', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}',
      path: '/workers/non-existent-id',
      pathParameters: { id: 'non-existent-id' },
      body: {
        legal_name: 'Updated Name',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(404);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 401 when no auth is provided', async () => {
    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}',
      path: '/workers/worker-123',
      pathParameters: { id: 'worker-123' },
      body: {
        legal_name: 'Updated Name',
      },
      noAuth: true,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(401);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when worker role attempts to update', async () => {
    const claims = createMockClaims({ role: 'worker', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}',
      path: '/workers/worker-123',
      pathParameters: { id: 'worker-123' },
      body: {
        legal_name: 'Updated Name',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(403);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('FORBIDDEN');
  });

  it('issues DynamoDB UpdateCommand with only the specified fields', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}',
      path: '/workers/worker-123',
      pathParameters: { id: 'worker-123' },
      body: {
        legal_name: 'Only This Field',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    // Verify the UpdateCommand was called (second call after GetCommand)
    const calls = mockSend.mock.calls;
    const updateCall = calls.find((call: unknown[]) => {
      const cmd = call[0] as { constructor: { name: string } };
      return cmd.constructor?.name === 'UpdateCommand';
    });

    expect(updateCall).toBeDefined();

    const updateInput = (updateCall![0] as { input: Record<string, unknown> }).input;
    expect(updateInput.TableName).toBe('test-Workers');
    expect(updateInput.Key).toEqual({
      PK: 'TENANT#tenant-test',
      SK: 'WORKER#worker-123',
    });

    // Verify only legal_name and updated_at are in the update expression
    const updateExpression = updateInput.UpdateExpression as string;
    expect(updateExpression).toContain('legal_name');
    expect(updateExpression).toContain('updated_at');
    expect(updateExpression).not.toContain('phone');
    expect(updateExpression).not.toContain('preferred_name');
    expect(updateExpression).not.toContain('language_preference');
  });
});
