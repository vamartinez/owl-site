/**
 * E2E tests for auth enforcement on /workers endpoints.
 * Tests the full handler path for authentication and authorization enforcement.
 *
 * Validates: Requirements 2.10, 2.11
 *
 * (1) Request without auth (noAuth: true) → 401
 * (2) Request with worker role to POST /workers → 403
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockEvent } from '../helpers/mock-event.js';
import { createMockClaims } from '../helpers/mock-user.js';
import { setupDynamoMock, resetDynamoMock, getMockSend } from '../helpers/mock-dynamo.js';

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

describe('Auth enforcement on /workers endpoints - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
    setupDynamoMock({ putCapture: [] });
  });

  describe('Missing auth → 401 (Requirement 2.10)', () => {
    it('POST /workers without auth returns 401', async () => {
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
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('request_id');
      expect(body).toHaveProperty('timestamp');
    });

    it('GET /workers without auth returns 401', async () => {
      const event = createMockEvent({
        httpMethod: 'GET',
        resource: '/workers',
        noAuth: true,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('request_id');
      expect(body).toHaveProperty('timestamp');
    });

    it('GET /workers/{id} without auth returns 401', async () => {
      const event = createMockEvent({
        httpMethod: 'GET',
        resource: '/workers/{id}',
        path: '/workers/worker-123',
        pathParameters: { id: 'worker-123' },
        noAuth: true,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('request_id');
      expect(body).toHaveProperty('timestamp');
    });

    it('PATCH /workers/{id} without auth returns 401', async () => {
      const event = createMockEvent({
        httpMethod: 'PATCH',
        resource: '/workers/{id}',
        path: '/workers/worker-123',
        pathParameters: { id: 'worker-123' },
        body: { legal_name: 'Updated Name' },
        noAuth: true,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('request_id');
      expect(body).toHaveProperty('timestamp');
    });
  });

  describe('Insufficient role → 403 (Requirement 2.11)', () => {
    it('POST /workers with worker role returns 403', async () => {
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
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('request_id');
      expect(body).toHaveProperty('timestamp');
    });

    it('POST /workers with gate_operator role returns 403', async () => {
      const claims = createMockClaims({ role: 'gate_operator' });

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
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('request_id');
      expect(body).toHaveProperty('timestamp');
    });
  });
});
