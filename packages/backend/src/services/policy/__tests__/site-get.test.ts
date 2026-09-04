/**
 * Unit tests for GET /sites/{id} (handleGetSite) shape.
 *
 * Verifies the detail endpoint returns the same flat, mapped shape as the list
 * endpoint (no `site` wrapper, no internal DynamoDB attributes) plus real
 * computed activeWorkers / compliancePercent / contractor fields.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupDynamoMock,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo';
import { createMockClaims } from '../../../../tests/helpers/mock-user';
import { createMockEvent } from '../../../../tests/helpers/mock-event';

vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

vi.mock('../../../shared/auth-middleware.js', () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock('../../../shared/rbac.js', () => ({
  enforcePermission: vi.fn(() => null),
  enforceTenantIsolation: vi.fn(() => null),
}));

import { handler } from '../handler.js';
import { authenticateRequest } from '../../../shared/auth-middleware.js';

const TENANT = 'tenant-abc';
const USER = 'user-123';
const SITE = 'site-1';

function siteQueryKey() {
  return JSON.stringify({
    TableName: 'test-Sites',
    IndexName: undefined,
    ExpressionAttributeValues: {
      ':pk': `TENANT#${TENANT}`,
      ':sk': `SITE#${SITE}`,
    },
  });
}

function sessionsQueryKey() {
  return JSON.stringify({
    TableName: 'test-ScanSessions',
    IndexName: undefined,
    ExpressionAttributeValues: {
      ':pk': `TENANT#${TENANT}`,
      ':siteId': SITE,
    },
  });
}

describe('GET /sites/{id} — handleGetSite shape', () => {
  beforeEach(() => {
    resetDynamoMock();
    vi.mocked(authenticateRequest).mockReturnValue({
      user: {
        user_id: USER,
        tenant_id: TENANT,
        role: 'tenant_admin' as never,
        email: 'admin@tenant-abc.com',
        assigned_sites: undefined,
      },
    });
  });

  it('returns a flat shape (no `site` wrapper) with mapped fields and computed values', async () => {
    const rawItem = {
      PK: `TENANT#${TENANT}`,
      SK: `SITE#${SITE}`,
      GSI1PK: `TENANT#${TENANT}`,
      GSI1SK: `SITE#2026-01-01`,
      site_id: SITE,
      name: 'Downtown Tower',
      address: '123 Main St',
      timezone: 'America/Vancouver',
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      contractor: 'Acme Builders',
    };
    const sessions = [
      { worker_id: 'w1', result: 'allowed' },
      { worker_id: 'w2', result: 'denied' },
    ];

    setupDynamoMock({
      queryResponses: new Map<string, Record<string, unknown>[]>([
        [siteQueryKey(), [rawItem]],
        [sessionsQueryKey(), sessions],
      ]),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/sites/{id}',
      pathParameters: { id: SITE },
      claims: createMockClaims({ tenant_id: TENANT, user_id: USER }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);

    // Flat shape — matches what SiteProfile.tsx reads directly
    expect(body.site).toBeUndefined();
    expect(body.id).toBe(SITE);
    expect(body.name).toBe('Downtown Tower');
    expect(body.address).toBe('123 Main St');
    expect(body.status).toBe('active');

    // Computed fields
    expect(body.compliancePercent).toBe(50); // 1 allowed / 2 total
    expect(body.activeWorkers).toBe(2);
    expect(body.contractor).toBe('Acme Builders');

    // No internal DynamoDB attributes leak
    expect(body.PK).toBeUndefined();
    expect(body.SK).toBeUndefined();
    expect(body.GSI1PK).toBeUndefined();
    expect(body.GSI1SK).toBeUndefined();
  });

  it('returns 404 when the site does not exist', async () => {
    setupDynamoMock({
      queryResponses: new Map<string, Record<string, unknown>[]>([[siteQueryKey(), []]]),
    });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/sites/{id}',
      pathParameters: { id: SITE },
      claims: createMockClaims({ tenant_id: TENANT, user_id: USER }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(404);
  });
});
