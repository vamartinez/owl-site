/**
 * E2E tests for auth enforcement on /access endpoints.
 * Verifies:
 *   1. POST /access/scan without auth → 401 (Requirement 6.9)
 *   2. POST /access/override with gate_operator role → 403 (Requirement 6.10)
 *
 * These tests invoke the handler directly with mock API Gateway events,
 * exercising the full routing + auth + RBAC path.
 *
 * Requirements: 6.9, 6.10
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

// Mock event publisher (not under test)
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock decision engine (not under test)
vi.mock('../../src/services/decision-engine/evaluator.js', () => ({
  evaluateDecision: vi.fn().mockResolvedValue({
    response: { decision: 'allowed', decision_id: 'dec-001', reasons: [], policy_version_used: 'v1' },
  }),
}));

// Mock token-manager (not under test)
vi.mock('../../src/services/access/token-manager.js', () => ({
  generateToken: vi.fn().mockResolvedValue({ token_id: 'tok-001', expires_at: new Date().toISOString() }),
  getToken: vi.fn().mockResolvedValue(null),
  validateToken: vi.fn().mockReturnValue({ valid: true }),
  markTokenUsed: vi.fn().mockResolvedValue(undefined),
  revokeToken: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock scan-session (not under test)
vi.mock('../../src/services/access/scan-session.js', () => ({
  recordScanSession: vi.fn().mockResolvedValue({ session_id: 'sess-001' }),
  detectReplay: vi.fn().mockResolvedValue({ isReplay: false }),
}));

// Import handler after mocks are set up
import { handler } from '../../src/services/access/handler.js';

describe('Access Service — Auth Enforcement E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
    setupDynamoMock();
  });

  describe('Requirement 6.9: Missing auth on POST /access/scan → 401', () => {
    it('returns 401 when no Authorization header or claims are provided', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/access/scan',
        body: {
          token_id: '550e8400-e29b-41d4-a716-446655440000',
          device_id: 'device-001',
          scanner_type: 'qr',
        },
        noAuth: true,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.message).toBeDefined();
      expect(typeof body.message).toBe('string');
      expect(body.request_id).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    it('error body conforms to standard error shape with code, message, request_id, timestamp', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/access/scan',
        body: {
          token_id: '660e8400-e29b-41d4-a716-446655440000',
          device_id: 'device-002',
          scanner_type: 'sms',
        },
        noAuth: true,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      expect(response.headers).toBeDefined();
      expect(response.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(response.body);
      // Verify all required fields of the error body
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('request_id');
      expect(body).toHaveProperty('timestamp');
      // Verify code value
      expect(body.code).toBe('UNAUTHORIZED');
      // Verify timestamp is ISO-8601
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });
  });

  describe('Requirement 6.10: gate_operator on POST /access/override → 403', () => {
    it('returns 403 when gate_operator role attempts to create an override', async () => {
      const claims = createMockClaims({ role: 'gate_operator' });

      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/access/override',
        body: {
          decision_id: '770e8400-e29b-41d4-a716-446655440000',
          reason: 'Worker needs emergency access',
          evidence: 'Verbal authorization from supervisor',
        },
        claims,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body);
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toBeDefined();
      expect(typeof body.message).toBe('string');
      expect(body.request_id).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    it('error body conforms to standard error shape with code, message, request_id, timestamp', async () => {
      const claims = createMockClaims({ role: 'gate_operator' });

      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/access/override',
        body: {
          decision_id: '880e8400-e29b-41d4-a716-446655440000',
          reason: 'Access needed for safety check',
          evidence: 'Work order #12345',
        },
        claims,
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(403);
      expect(response.headers).toBeDefined();
      expect(response.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(response.body);
      // Verify all required fields of the error body
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('request_id');
      expect(body).toHaveProperty('timestamp');
      // Verify code value
      expect(body.code).toBe('FORBIDDEN');
      // Verify message indicates permission denial
      expect(body.message.toLowerCase()).toContain('permission');
      // Verify timestamp is ISO-8601
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });
  });
});
