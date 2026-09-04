/**
 * Unit tests for policy creation module in the Policy Service.
 * Verifies that when a policy is created, both a policy record AND a draft
 * version record are persisted (two PutCommands).
 *
 * Validates: Requirements 3.2
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
// Use vi.hoisted so the mock fn is available when vi.mock hoists
const mockUuidv4 = vi.hoisted(() => vi.fn());
vi.mock('uuid', () => ({
  v4: mockUuidv4,
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

describe('Policy Creation Module', () => {
  const tenantId = 'tenant-abc';
  const userId = 'user-123';
  const validPolicyBody = {
    name: 'Fall Protection Policy',
    description: 'Governs fall protection requirements',
    site_id: '550e8400-e29b-41d4-a716-446655440000',
    jurisdiction: 'British Columbia',
    owner_type: 'tenant',
    owner_id: '550e8400-e29b-41d4-a716-446655440001',
  };

  beforeEach(() => {
    resetDynamoMock();
    const putCapture: Array<Record<string, unknown>> = [];
    setupDynamoMock({ putCapture });

    // Reset uuid mock to return fresh IDs for each test
    mockUuidv4.mockReset();
    mockUuidv4
      .mockReturnValueOnce('generated-policy-id-001')
      .mockReturnValueOnce('generated-version-id-001');

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

  it('persists a policy record via PutCommand', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: validPolicyBody,
      claims: createMockClaims({ tenant_id: tenantId, user_id: userId }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(201);

    const calls = getDynamoCalls();
    const putCalls = calls.filter((c) => c.command === 'PutCommand');

    // At least one PutCommand should be for the policy record
    const policyPut = putCalls.find((c) => {
      const input = c.input as { TableName: string; Item: Record<string, unknown> };
      return input.TableName === 'test-Policies';
    });
    expect(policyPut).toBeDefined();

    const policyInput = policyPut!.input as { TableName: string; Item: Record<string, unknown> };
    expect(policyInput.Item['PK']).toBe(`TENANT#${tenantId}`);
    expect(policyInput.Item['SK']).toBe('POLICY#generated-policy-id-001');
    expect(policyInput.Item['policy_id']).toBe('generated-policy-id-001');
    expect(policyInput.Item['tenant_id']).toBe(tenantId);
    expect(policyInput.Item['name']).toBe('Fall Protection Policy');
  });

  it('persists a draft version record alongside the policy record', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: validPolicyBody,
      claims: createMockClaims({ tenant_id: tenantId, user_id: userId }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(201);

    const calls = getDynamoCalls();
    const putCalls = calls.filter((c) => c.command === 'PutCommand');

    // Should have at least two PutCommands: one for policy, one for draft version
    expect(putCalls.length).toBeGreaterThanOrEqual(2);

    // Find the version put (written to PolicyVersions table)
    const versionPut = putCalls.find((c) => {
      const input = c.input as { TableName: string; Item: Record<string, unknown> };
      return input.TableName === 'test-PolicyVersions';
    });
    expect(versionPut).toBeDefined();

    const versionInput = versionPut!.input as { TableName: string; Item: Record<string, unknown> };
    expect(versionInput.Item['policy_id']).toBe('generated-policy-id-001');
    expect(versionInput.Item['tenant_id']).toBe(tenantId);
    expect(versionInput.Item['version_number']).toBe(1);
  });

  it('draft version has status "draft"', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: validPolicyBody,
      claims: createMockClaims({ tenant_id: tenantId, user_id: userId }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(201);

    const calls = getDynamoCalls();
    const putCalls = calls.filter((c) => c.command === 'PutCommand');

    const versionPut = putCalls.find((c) => {
      const input = c.input as { TableName: string; Item: Record<string, unknown> };
      return input.TableName === 'test-PolicyVersions';
    });
    expect(versionPut).toBeDefined();

    const versionInput = versionPut!.input as { TableName: string; Item: Record<string, unknown> };
    expect(versionInput.Item['status']).toBe('draft');
  });

  it('both policy and draft version records are written in the same request', async () => {
    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/policies',
      body: validPolicyBody,
      claims: createMockClaims({ tenant_id: tenantId, user_id: userId }),
    });

    const response = await handler(event as never);
    expect(response.statusCode).toBe(201);

    const calls = getDynamoCalls();
    const putCalls = calls.filter((c) => c.command === 'PutCommand');

    const policyPut = putCalls.find((c) => {
      const input = c.input as { TableName: string; Item: Record<string, unknown> };
      return input.TableName === 'test-Policies';
    });
    const versionPut = putCalls.find((c) => {
      const input = c.input as { TableName: string; Item: Record<string, unknown> };
      return input.TableName === 'test-PolicyVersions';
    });

    // Both must be present
    expect(policyPut).toBeDefined();
    expect(versionPut).toBeDefined();
  });
});
