/**
 * E2E tests for auth enforcement on /sites and /policies endpoints.
 * Tests the full handler path for authentication and authorization enforcement.
 *
 * Validates: Requirements 4.13
 *
 * (1) Request with unauthorized role (worker) to POST /sites → 403
 * (2) Request without auth (noAuth: true) → 401
 * (3) Request with unauthorized role (worker) to POST /policies → 403
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

// Import handler after mocks are in place
import { handler } from '../../src/services/policy/handler.js';

describe('Auth enforcement on /sites and /policies endpoints - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
    setupDynamoMock({ putCapture: [] });
  });

  describe('POST /sites - unauthorized role → 403', () => {
    it('worker role on POST /sites returns 403 FORBIDDEN', async () => {
      const claims = createMockClaims({ role: 'worker' });

      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/sites',
        body: {
          name: 'Unauthorized Site',
          address: '123 Forbidden St',
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

    it('gate_operator role on POST /sites returns 403 FORBIDDEN', async () => {
      const claims = createMockClaims({ role: 'gate_operator' });

      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/sites',
        body: {
          name: 'Unauthorized Site',
          address: '456 Blocked Rd',
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

  describe('POST /sites - no auth → 401', () => {
    it('POST /sites without auth returns 401 UNAUTHORIZED', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/sites',
        body: {
          name: 'No Auth Site',
          address: '789 Unauthenticated Way',
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
  });

  describe('POST /policies - unauthorized role → 403', () => {
    it('worker role on POST /policies returns 403 FORBIDDEN', async () => {
      const claims = createMockClaims({ role: 'worker' });

      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/policies',
        body: {
          name: 'Unauthorized Policy',
          description: 'Should be denied',
          site_id: '550e8400-e29b-41d4-a716-446655440000',
          jurisdiction: 'British Columbia',
          owner_type: 'tenant',
          owner_id: '550e8400-e29b-41d4-a716-446655440001',
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

    it('gate_operator role on POST /policies returns 403 FORBIDDEN', async () => {
      const claims = createMockClaims({ role: 'gate_operator' });

      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/policies',
        body: {
          name: 'Unauthorized Policy',
          description: 'Should be denied',
          site_id: '550e8400-e29b-41d4-a716-446655440000',
          jurisdiction: 'British Columbia',
          owner_type: 'tenant',
          owner_id: '550e8400-e29b-41d4-a716-446655440001',
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

  describe('POST /policies - no auth → 401', () => {
    it('POST /policies without auth returns 401 UNAUTHORIZED', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/policies',
        body: {
          name: 'No Auth Policy',
          description: 'Should fail auth',
          site_id: '550e8400-e29b-41d4-a716-446655440000',
          jurisdiction: 'British Columbia',
          owner_type: 'tenant',
          owner_id: '550e8400-e29b-41d4-a716-446655440001',
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
  });
});
