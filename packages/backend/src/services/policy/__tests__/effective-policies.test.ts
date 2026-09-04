/**
 * Unit tests for the effective-policies module in the Policy Service.
 * Verifies that all active policies assigned to a site are aggregated correctly,
 * and that draft/archived policies are excluded.
 *
 * Validates: Requirements 3.4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo';

// Mock the dynamo-client module before importing the module under test
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

import { getEffectivePolicies } from '../effective-policies.js';

describe('Effective Policies Module', () => {
  const siteId = 'site-001';
  const tenantId = 'tenant-abc';

  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns only active policies assigned to the site', async () => {
    const queryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: 'GSI1',
      ExpressionAttributeValues: {
        ':gsi1pk': `SITE#${siteId}`,
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, [
      {
        policy_id: 'policy-1',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Fall Protection Policy',
        description: 'Active fall protection',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        status: 'active',
        current_version_number: 2,
      },
      {
        policy_id: 'policy-2',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Draft Safety Policy',
        description: 'Still in draft',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        status: 'draft',
        current_version_number: 0,
      },
      {
        policy_id: 'policy-3',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Archived Hazard Policy',
        description: 'No longer applicable',
        jurisdiction: 'BC',
        owner_type: 'site',
        status: 'archived',
        current_version_number: 3,
      },
      {
        policy_id: 'policy-4',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'PPE Requirements',
        description: 'Active PPE policy',
        jurisdiction: 'Alberta',
        owner_type: 'tenant',
        status: 'active',
        current_version_number: 1,
      },
    ]);

    setupDynamoMock({ queryResponses });

    const result = await getEffectivePolicies(siteId, tenantId);

    // Should only include active policies (policy-1 and policy-4)
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.policy_id)).toEqual(['policy-1', 'policy-4']);
  });

  it('excludes draft policies from the result', async () => {
    const queryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: 'GSI1',
      ExpressionAttributeValues: {
        ':gsi1pk': `SITE#${siteId}`,
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, [
      {
        policy_id: 'policy-draft-1',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Draft Policy A',
        description: 'Draft description',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        status: 'draft',
        current_version_number: 0,
      },
      {
        policy_id: 'policy-draft-2',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Draft Policy B',
        description: 'Another draft',
        jurisdiction: 'BC',
        owner_type: 'site',
        status: 'draft',
        current_version_number: 0,
      },
    ]);

    setupDynamoMock({ queryResponses });

    const result = await getEffectivePolicies(siteId, tenantId);
    expect(result).toHaveLength(0);
  });

  it('excludes archived policies from the result', async () => {
    const queryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: 'GSI1',
      ExpressionAttributeValues: {
        ':gsi1pk': `SITE#${siteId}`,
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, [
      {
        policy_id: 'policy-archived',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Old Policy',
        description: 'Archived',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        status: 'archived',
        current_version_number: 5,
      },
    ]);

    setupDynamoMock({ queryResponses });

    const result = await getEffectivePolicies(siteId, tenantId);
    expect(result).toHaveLength(0);
  });

  it('returns an empty array when no policies are assigned to the site', async () => {
    const queryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: 'GSI1',
      ExpressionAttributeValues: {
        ':gsi1pk': `SITE#${siteId}`,
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, []);

    setupDynamoMock({ queryResponses });

    const result = await getEffectivePolicies(siteId, tenantId);
    expect(result).toHaveLength(0);
  });

  it('queries the Policies table via GSI1 with correct key', async () => {
    const queryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: 'GSI1',
      ExpressionAttributeValues: {
        ':gsi1pk': `SITE#${siteId}`,
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, []);

    setupDynamoMock({ queryResponses });

    await getEffectivePolicies(siteId, tenantId);

    const calls = getDynamoCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('QueryCommand');

    const input = calls[0].input as Record<string, unknown>;
    expect(input['TableName']).toBe('test-Policies');
    expect(input['IndexName']).toBe('GSI1');
    expect(input['KeyConditionExpression']).toBe('GSI1PK = :gsi1pk');
    expect(input['ExpressionAttributeValues']).toEqual({
      ':gsi1pk': `SITE#${siteId}`,
    });
  });

  it('maps active policies to the correct EffectivePolicy shape', async () => {
    const queryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: 'GSI1',
      ExpressionAttributeValues: {
        ':gsi1pk': `SITE#${siteId}`,
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, [
      {
        policy_id: 'policy-mapped',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Mapped Policy',
        description: 'Full description here',
        jurisdiction: 'Ontario',
        owner_type: 'platform',
        status: 'active',
        current_version_number: 7,
      },
    ]);

    setupDynamoMock({ queryResponses });

    const result = await getEffectivePolicies(siteId, tenantId);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      policy_id: 'policy-mapped',
      name: 'Mapped Policy',
      description: 'Full description here',
      jurisdiction: 'Ontario',
      owner_type: 'platform',
      site_id: siteId,
      status: 'active',
      current_version_number: 7,
    });
  });

  it('enforces tenant isolation by excluding policies from other tenants', async () => {
    const queryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: 'GSI1',
      ExpressionAttributeValues: {
        ':gsi1pk': `SITE#${siteId}`,
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, [
      {
        policy_id: 'policy-same-tenant',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Same Tenant Policy',
        description: 'Belongs to requesting tenant',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        status: 'active',
        current_version_number: 1,
      },
      {
        policy_id: 'policy-other-tenant',
        tenant_id: 'tenant-other',
        site_id: siteId,
        name: 'Other Tenant Policy',
        description: 'Belongs to different tenant',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        status: 'active',
        current_version_number: 2,
      },
    ]);

    setupDynamoMock({ queryResponses });

    const result = await getEffectivePolicies(siteId, tenantId);

    // Only the policy from the matching tenant should be returned
    expect(result).toHaveLength(1);
    expect(result[0].policy_id).toBe('policy-same-tenant');
  });

  it('aggregates multiple active policies from the same site', async () => {
    const queryKey = JSON.stringify({
      TableName: 'test-Policies',
      IndexName: 'GSI1',
      ExpressionAttributeValues: {
        ':gsi1pk': `SITE#${siteId}`,
      },
    });

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(queryKey, [
      {
        policy_id: 'policy-a',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Policy A',
        description: 'First active policy',
        jurisdiction: 'BC',
        owner_type: 'tenant',
        status: 'active',
        current_version_number: 1,
      },
      {
        policy_id: 'policy-b',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Policy B',
        description: 'Second active policy',
        jurisdiction: 'Alberta',
        owner_type: 'site',
        status: 'active',
        current_version_number: 3,
      },
      {
        policy_id: 'policy-c',
        tenant_id: tenantId,
        site_id: siteId,
        name: 'Policy C',
        description: 'Third active policy',
        jurisdiction: 'Ontario',
        owner_type: 'platform',
        status: 'active',
        current_version_number: 2,
      },
    ]);

    setupDynamoMock({ queryResponses });

    const result = await getEffectivePolicies(siteId, tenantId);

    expect(result).toHaveLength(3);
    expect(result.map((p) => p.policy_id)).toEqual(['policy-a', 'policy-b', 'policy-c']);
  });
});
