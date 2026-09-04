/**
 * Unit tests for site creation module in the Policy Service.
 * Verifies that a PutCommand is issued with the correct tenant partition key
 * and a generated site ID.
 *
 * Validates: Requirements 3.1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo';
import { createMockClaims } from '../../../../tests/helpers/mock-user';
import { createMockEvent } from '../../../../tests/helpers/mock-event';

// Mock the dynamo-client module before importing handler
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock uuid to control generated IDs for assertion
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'generated-site-id-001'),
}));

// Mock auth-middleware to return authenticated user
vi.mock('../../../shared/auth-middleware.js', () => ({
  authenticateRequest: vi.fn(),
}));

// Mock rbac to allow the operation
vi.mock('../../../shared/rbac.js', () => ({
  enforcePermission: vi.fn(() => null),
  enforceTenantIsolation: vi.fn(() => null),
}));

import { handler } from '../handler.js';
import { authenticateRequest } from '../../../shared/auth-middleware.js';

describe('Site Creation Module', () => {
  const tenantId = 'tenant-abc';
  const userId = 'user-123';

  beforeEach(() => {
    resetDynamoMock();
    const putCapture: Array<Record<string, unknown>> = [];
    setupDynamoMock({ putCapture });

    // Configure auth to return authenticated user
    vi.mocked(authenticateRequest).mockReturnValue({
      user: {
        user_id: userId,
        tenant_id: tenantId,
        role: 'tenant_admin' as never,
        email: 'admin@tenant-abc.com',
        assigned_sites: undefined,
      },
    });
  });

  it('issues a PutCommand with correct tenant partition key (TENANT#<tenant_id>)', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/sites',
      body: { name: 'Main Office', address: '123 Main St' },
      claims: createMockClaims({ tenant_id: tenantId, user_id: userId }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(201);

    const calls = getDynamoCalls();
    const putCall = calls.find((c) => c.command === 'PutCommand');
    expect(putCall).toBeDefined();

    const input = putCall!.input as { TableName: string; Item: Record<string, unknown> };
    expect(input.Item['PK']).toBe(`TENANT#${tenantId}`);
  });

  it('issues a PutCommand with a generated site ID in the sort key', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/sites',
      body: { name: 'Warehouse B', address: '456 Industrial Dr' },
      claims: createMockClaims({ tenant_id: tenantId, user_id: userId }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(201);

    const calls = getDynamoCalls();
    const putCall = calls.find((c) => c.command === 'PutCommand');
    expect(putCall).toBeDefined();

    const input = putCall!.input as { TableName: string; Item: Record<string, unknown> };
    // The SK should contain the generated site ID
    expect(input.Item['SK']).toBe('SITE#generated-site-id-001');
    // The site_id field should match the generated ID
    expect(input.Item['site_id']).toBe('generated-site-id-001');
  });

  it('stores the site with the correct tenant_id field in the item', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/sites',
      body: { name: 'Site Alpha', address: '789 Oak Ave' },
      claims: createMockClaims({ tenant_id: tenantId, user_id: userId }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(201);

    const calls = getDynamoCalls();
    const putCall = calls.find((c) => c.command === 'PutCommand');
    const input = putCall!.input as { TableName: string; Item: Record<string, unknown> };

    expect(input.Item['tenant_id']).toBe(tenantId);
  });

  it('writes to the correct Sites table', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/sites',
      body: { name: 'Test Site' },
      claims: createMockClaims({ tenant_id: tenantId, user_id: userId }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(201);

    const calls = getDynamoCalls();
    const putCall = calls.find((c) => c.command === 'PutCommand');
    const input = putCall!.input as { TableName: string; Item: Record<string, unknown> };

    expect(input.TableName).toBe('test-Sites');
  });

  it('returns the created site in the response body with generated ID', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/sites',
      body: { name: 'Response Test Site', address: '100 Response Rd' },
      claims: createMockClaims({ tenant_id: tenantId, user_id: userId }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body.site.site_id).toBe('generated-site-id-001');
    expect(body.site.tenant_id).toBe(tenantId);
    expect(body.site.name).toBe('Response Test Site');
    expect(body.site.created_at).toBeDefined();
  });
});
