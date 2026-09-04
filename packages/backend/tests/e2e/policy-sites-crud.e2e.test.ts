/**
 * E2E tests for sites CRUD endpoints in the Policy Service.
 * Tests the full handler path: routing → auth → validation → business logic → response.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
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

// Import handler after mocks are in place
import { handler } from '../../src/services/policy/handler.js';

describe('Sites CRUD - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  describe('POST /sites → 201', () => {
    beforeEach(() => {
      setupDynamoMock({
        putCapture: [],
      });
    });

    it('returns 201 with created site object for valid input', async () => {
      const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/sites',
        body: {
          name: 'Downtown Construction Site',
          address: '123 Main St, Vancouver, BC',
          timezone: 'America/Vancouver',
        },
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('site');

      const site = body.site;
      expect(site).toHaveProperty('site_id');
      expect(site).toHaveProperty('tenant_id', 'tenant-test');
      expect(site).toHaveProperty('name', 'Downtown Construction Site');
      expect(site).toHaveProperty('address', '123 Main St, Vancouver, BC');
      expect(site).toHaveProperty('timezone', 'America/Vancouver');
      expect(site).toHaveProperty('status', 'active');
      expect(site).toHaveProperty('created_at');
      expect(site).toHaveProperty('updated_at');

      // Verify UUID format for site_id
      expect(site.site_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );

      // Verify DynamoDB PutCommand was called with correct keys
      const calls = getDynamoCalls();
      const putCall = calls.find((c) => c.command === 'PutCommand');
      expect(putCall).toBeDefined();

      const putInput = putCall!.input as Record<string, unknown>;
      expect(putInput).toHaveProperty('TableName', 'test-Sites');

      const item = putInput['Item'] as Record<string, unknown>;
      expect(item['PK']).toBe('TENANT#tenant-test');
      expect((item['SK'] as string)).toMatch(/^SITE#/);
    });

    it('returns 201 with default timezone when not provided', async () => {
      const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/sites',
        body: {
          name: 'North Shore Site',
          address: '456 Mountain Ave',
        },
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(201);

      const body = JSON.parse(response.body);
      expect(body.site.timezone).toBe('America/Vancouver');
    });

    it('returns 400 when site name is missing', async () => {
      const claims = createMockClaims({ role: 'tenant_admin' });

      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/sites',
        body: {
          address: '123 Main St',
        },
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.code).toBe('BAD_REQUEST');
    });

    it('returns 400 when body is missing', async () => {
      const claims = createMockClaims({ role: 'tenant_admin' });

      const event = createMockEvent({
        httpMethod: 'POST',
        resource: '/sites',
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.code).toBe('BAD_REQUEST');
    });
  });

  describe('GET /sites → 200 array', () => {
    it('returns 200 with array of site records', async () => {
      const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

      // Setup mock to return sites from a query
      const queryKey = JSON.stringify({
        TableName: 'test-Sites',
        IndexName: undefined,
        ExpressionAttributeValues: {
          ':pk': 'TENANT#tenant-test',
          ':prefix': 'SITE#',
        },
      });

      setupDynamoMock({
        queryResponses: new Map([
          [queryKey, [
            {
              site_id: 'site-1',
              name: 'Site Alpha',
              address: '100 First Ave',
              timezone: 'America/Vancouver',
              status: 'active',
              created_at: '2024-01-01T00:00:00.000Z',
            },
            {
              site_id: 'site-2',
              name: 'Site Beta',
              address: '200 Second Ave',
              timezone: 'America/Toronto',
              status: 'active',
              created_at: '2024-01-02T00:00:00.000Z',
            },
          ]],
        ]),
      });

      const event = createMockEvent({
        httpMethod: 'GET',
        resource: '/sites',
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('sites');
      expect(Array.isArray(body.sites)).toBe(true);
      expect(body.sites).toHaveLength(2);
      expect(body).toHaveProperty('total', 2);

      // Verify site record shapes
      expect(body.sites[0]).toHaveProperty('name', 'Site Alpha');
      expect(body.sites[1]).toHaveProperty('name', 'Site Beta');
    });

    it('returns 200 with empty array when no sites exist', async () => {
      const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

      setupDynamoMock({
        queryResponses: new Map(),
      });

      const event = createMockEvent({
        httpMethod: 'GET',
        resource: '/sites',
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.sites).toEqual([]);
      expect(body.total).toBe(0);
    });
  });

  describe('GET /sites/{id} → 200', () => {
    it('returns 200 with matching site object', async () => {
      const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

      const queryKey = JSON.stringify({
        TableName: 'test-Sites',
        IndexName: undefined,
        ExpressionAttributeValues: {
          ':pk': 'TENANT#tenant-test',
          ':sk': 'SITE#site-123',
        },
      });

      setupDynamoMock({
        queryResponses: new Map([
          [queryKey, [
            {
              site_id: 'site-123',
              tenant_id: 'tenant-test',
              name: 'Main Construction Site',
              address: '789 Builder Blvd',
              timezone: 'America/Vancouver',
              status: 'active',
              created_at: '2024-01-15T10:00:00.000Z',
              updated_at: '2024-01-15T10:00:00.000Z',
            },
          ]],
        ]),
      });

      const event = createMockEvent({
        httpMethod: 'GET',
        resource: '/sites/{id}',
        path: '/sites/site-123',
        pathParameters: { id: 'site-123' },
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('site');
      expect(body.site).toHaveProperty('site_id', 'site-123');
      expect(body.site).toHaveProperty('name', 'Main Construction Site');
      expect(body.site).toHaveProperty('address', '789 Builder Blvd');
      expect(body.site).toHaveProperty('timezone', 'America/Vancouver');
      expect(body.site).toHaveProperty('status', 'active');
    });

    it('returns 404 when site does not exist', async () => {
      const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

      // Return empty results for non-existent site
      setupDynamoMock({
        queryResponses: new Map(),
      });

      const event = createMockEvent({
        httpMethod: 'GET',
        resource: '/sites/{id}',
        path: '/sites/non-existent-id',
        pathParameters: { id: 'non-existent-id' },
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /sites/{id} → 200', () => {
    beforeEach(() => {
      setupDynamoMock({
        updateCapture: [],
      });
    });

    it('returns 200 with update confirmation for valid fields', async () => {
      const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

      const event = createMockEvent({
        httpMethod: 'PATCH',
        resource: '/sites/{id}',
        path: '/sites/site-456',
        pathParameters: { id: 'site-456' },
        body: {
          name: 'Updated Site Name',
          address: '999 New Address',
        },
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('message', 'Site updated');

      // Verify DynamoDB UpdateCommand was called with correct key
      const calls = getDynamoCalls();
      const updateCall = calls.find((c) => c.command === 'UpdateCommand');
      expect(updateCall).toBeDefined();

      const updateInput = updateCall!.input as Record<string, unknown>;
      expect(updateInput).toHaveProperty('TableName', 'test-Sites');

      const key = updateInput['Key'] as Record<string, unknown>;
      expect(key['PK']).toBe('TENANT#tenant-test');
      expect(key['SK']).toBe('SITE#site-456');

      // Verify update expression includes the provided fields
      const updateExpr = updateInput['UpdateExpression'] as string;
      expect(updateExpr).toContain(':name');
      expect(updateExpr).toContain(':addr');
    });

    it('returns 200 when updating only status', async () => {
      const claims = createMockClaims({ role: 'tenant_admin', tenant_id: 'tenant-test' });

      const event = createMockEvent({
        httpMethod: 'PATCH',
        resource: '/sites/{id}',
        path: '/sites/site-789',
        pathParameters: { id: 'site-789' },
        body: {
          status: 'inactive',
        },
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(200);

      const calls = getDynamoCalls();
      const updateCall = calls.find((c) => c.command === 'UpdateCommand');
      expect(updateCall).toBeDefined();

      const updateInput = updateCall!.input as Record<string, unknown>;
      const updateExpr = updateInput['UpdateExpression'] as string;
      expect(updateExpr).toContain(':status');
    });

    it('returns 400 when body is missing', async () => {
      const claims = createMockClaims({ role: 'tenant_admin' });

      const event = createMockEvent({
        httpMethod: 'PATCH',
        resource: '/sites/{id}',
        path: '/sites/site-456',
        pathParameters: { id: 'site-456' },
        claims,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.code).toBe('BAD_REQUEST');
    });
  });

  describe('Auth enforcement', () => {
    it('returns 401 when no auth is provided', async () => {
      const event = createMockEvent({
        httpMethod: 'GET',
        resource: '/sites',
        noAuth: true,
      });

      const response = await handler(event as never);

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when worker role attempts POST /sites', async () => {
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
    });

    it('returns 403 when gate_operator role attempts POST /sites', async () => {
      const claims = createMockClaims({ role: 'gate_operator' });

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
    });
  });
});
