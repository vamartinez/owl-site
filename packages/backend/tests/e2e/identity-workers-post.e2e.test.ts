/**
 * E2E tests for POST /workers endpoint.
 * Tests the full handler path: routing → auth → validation → business logic → response.
 *
 * Validates: Requirements 2.1
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
    event_type: 'WORKER_CREATED',
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

describe('POST /workers - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
    setupDynamoMock({
      putCapture: [],
    });
  });

  it('returns 201 with created worker object for valid input', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers',
      body: {
        legal_name: 'Jane Doe',
        phone: '+14155551234',
        language_preference: 'en',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('worker');

    const worker = body.worker;
    expect(worker).toHaveProperty('worker_id');
    expect(worker).toHaveProperty('tenant_id', 'tenant-test');
    expect(worker).toHaveProperty('legal_name', 'Jane Doe');
    expect(worker).toHaveProperty('phone', '+14155551234');
    expect(worker).toHaveProperty('language_preference', 'en');
    expect(worker).toHaveProperty('status', 'active');
    expect(worker).toHaveProperty('created_at');
    expect(worker).toHaveProperty('updated_at');
    expect(worker).toHaveProperty('qr_identity_reference');

    // Verify UUID format for worker_id
    expect(worker.worker_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    // Verify DynamoDB PutCommand was called
    const calls = getDynamoCalls();
    const putCall = calls.find((c) => c.command === 'PutCommand');
    expect(putCall).toBeDefined();

    const putInput = putCall!.input as Record<string, unknown>;
    expect(putInput).toHaveProperty('TableName', 'test-Workers');

    const item = putInput['Item'] as Record<string, unknown>;
    expect(item['PK']).toBe('TENANT#tenant-test');
    expect(item['SK']).toMatch(/^WORKER#/);
  });

  it('returns 201 with optional preferred_name included', async () => {
    const claims = createMockClaims({ role: 'tenant_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers',
      body: {
        legal_name: 'Carlos Martinez',
        preferred_name: 'Charlie',
        phone: '+14155559876',
        language_preference: 'es',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body.worker.legal_name).toBe('Carlos Martinez');
    expect(body.worker.preferred_name).toBe('Charlie');
    expect(body.worker.language_preference).toBe('es');
  });

  it('returns 400 when body is missing', async () => {
    const claims = createMockClaims({ role: 'tenant_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers',
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
      resource: '/workers',
      body: {
        legal_name: 'Test Worker',
        // missing phone and language_preference
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(400);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.message).toContain('Validation failed');
  });

  it('returns 400 for invalid phone number', async () => {
    const claims = createMockClaims({ role: 'tenant_admin' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers',
      body: {
        legal_name: 'Test Worker',
        phone: '555-1234',
        language_preference: 'en',
      },
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
      resource: '/workers',
      body: {
        legal_name: 'Jane Doe',
        phone: '+14155551234',
        language_preference: 'en',
      },
      noAuth: true,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(401);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when worker role attempts to create a worker', async () => {
    const claims = createMockClaims({ role: 'worker' });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers',
      body: {
        legal_name: 'Jane Doe',
        phone: '+14155551234',
        language_preference: 'en',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(403);

    const body = JSON.parse(response.body);
    expect(body.code).toBe('FORBIDDEN');
  });
});
