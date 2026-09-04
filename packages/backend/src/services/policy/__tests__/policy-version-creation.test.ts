/**
 * Unit tests for the policy version creation module.
 * Verifies that creating a new policy version queries existing versions
 * and sets the new version_number to N+1.
 *
 * Requirements: 3.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDynamoMock, getDynamoCalls, getMockSend, resetDynamoMock } from '../../../../tests/helpers/mock-dynamo.js';
import { createMockClaims } from '../../../../tests/helpers/mock-user.js';
import type { Policy } from '../types.js';

// Mock the dynamo-client module
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock the event-publisher module
const mockPublishEvent = vi.fn().mockResolvedValue({
  event_id: 'mock-event-id',
  event_type: 'test',
  source_service: 'policy-service',
  tenant_id: 'tenant-test',
  timestamp: '2024-01-01T00:00:00.000Z',
  payload: {},
  correlation_id: 'mock-corr-id',
  version: '1.0',
});

vi.mock('../../../shared/event-publisher.js', () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

// Mock uuid to return deterministic values
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-version-uuid'),
}));

// Import the module under test after mocks are set up
import { createPolicyVersion, getNextVersionNumber } from '../version-manager.js';

// --- Helpers ---

function createMockPolicy(overrides?: Partial<Policy>): Policy {
  return {
    policy_id: 'policy-001',
    tenant_id: 'tenant-test',
    site_id: 'site-001',
    name: 'Test Policy',
    description: 'A test policy',
    jurisdiction: 'British Columbia',
    owner_type: 'tenant',
    owner_id: 'owner-001',
    current_version_number: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    created_by: 'user-001',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createValidVersionInput() {
  return {
    effective_from: '2024-07-01',
    effective_to: '2024-12-31',
    rules: [
      {
        rule_id: 'rule-1',
        rule_type: 'certification_required',
        description: 'Workers must have safety certification',
        conditions: { certification_type: 'safety' },
        actions: { deny_if_missing: true },
      },
    ],
    change_summary: 'Initial version with safety certification requirement',
  };
}

/**
 * Builds the query key that mock-dynamo uses as lookup for QueryCommand responses.
 */
function buildQueryKey(tableName: string, expressionValues: Record<string, unknown>, indexName?: string) {
  return JSON.stringify({
    TableName: tableName,
    IndexName: indexName,
    ExpressionAttributeValues: expressionValues,
  });
}

// --- Tests ---

describe('policy version creation: version number auto-increment', () => {
  beforeEach(() => {
    resetDynamoMock();
    vi.clearAllMocks();
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123456789:test-topic';
  });

  describe('getNextVersionNumber', () => {
    it('returns 1 when no existing versions for the policy', async () => {
      // Set up mock to return empty result for version query
      const queryKey = buildQueryKey('test-PolicyVersions', { ':pk': 'POLICY#policy-001' });
      setupDynamoMock({
        queryResponses: new Map([[queryKey, []]]),
      });

      const nextVersion = await getNextVersionNumber('policy-001');

      expect(nextVersion).toBe(1);

      // Verify the query was made with correct parameters
      const calls = getDynamoCalls();
      const queryCall = calls.find((c) => c.command === 'QueryCommand');
      expect(queryCall).toBeDefined();
      const input = queryCall!.input as Record<string, unknown>;
      expect(input['TableName']).toBe('test-PolicyVersions');
      expect(input['KeyConditionExpression']).toBe('PK = :pk');
      expect(input['ExpressionAttributeValues']).toEqual({ ':pk': 'POLICY#policy-001' });
      expect(input['ScanIndexForward']).toBe(false);
      expect(input['Limit']).toBe(1);
    });

    it('returns N+1 when N versions already exist (latest is version 3)', async () => {
      // Mock returns the latest version with version_number = 3
      const queryKey = buildQueryKey('test-PolicyVersions', { ':pk': 'POLICY#policy-001' });
      setupDynamoMock({
        queryResponses: new Map([
          [queryKey, [{ version_number: 3, policy_version_id: 'v-3' }]],
        ]),
      });

      const nextVersion = await getNextVersionNumber('policy-001');

      expect(nextVersion).toBe(4);
    });

    it('returns 2 when one version already exists', async () => {
      const queryKey = buildQueryKey('test-PolicyVersions', { ':pk': 'POLICY#policy-002' });
      setupDynamoMock({
        queryResponses: new Map([
          [queryKey, [{ version_number: 1, policy_version_id: 'v-1' }]],
        ]),
      });

      const nextVersion = await getNextVersionNumber('policy-002');

      expect(nextVersion).toBe(2);
    });
  });

  describe('createPolicyVersion', () => {
    it('creates first version with version_number = 1 when no existing versions', async () => {
      const policy = createMockPolicy();
      const input = createValidVersionInput();

      // Query for existing versions (overlap check) returns empty
      const versionsQueryKey = buildQueryKey('test-PolicyVersions', { ':pk': 'POLICY#policy-001' });

      const putCapture: Array<Record<string, unknown>> = [];
      const updateCapture: Array<Record<string, unknown>> = [];

      setupDynamoMock({
        queryResponses: new Map([[versionsQueryKey, []]]),
        putCapture,
        updateCapture,
      });

      const result = await createPolicyVersion(policy, input, 'user-001');

      expect(result.error).toBeUndefined();
      expect(result.version).toBeDefined();
      expect(result.version!.version_number).toBe(1);
    });

    it('creates version with version_number = N+1 based on existing versions', async () => {
      const policy = createMockPolicy({ current_version_number: 2 });
      const input = createValidVersionInput();

      // First query returns existing versions for overlap check (with non-overlapping date range)
      // Second query (getNextVersionNumber) returns latest version = 2
      const versionsQueryKey = buildQueryKey('test-PolicyVersions', { ':pk': 'POLICY#policy-001' });

      const putCapture: Array<Record<string, unknown>> = [];
      const updateCapture: Array<Record<string, unknown>> = [];

      // The mock-dynamo returns the same result for the same query key.
      // Both getVersionsForPolicy and getNextVersionNumber query with the same PK.
      // getVersionsForPolicy returns full list (used for overlap check),
      // getNextVersionNumber returns the latest (with ScanIndexForward=false, Limit=1).
      // Since the mock returns the same items for both, we provide a version with non-overlapping dates.
      setupDynamoMock({
        queryResponses: new Map([
          [
            versionsQueryKey,
            [
              {
                policy_version_id: 'v-1',
                policy_id: 'policy-001',
                tenant_id: 'tenant-test',
                version_number: 2,
                effective_from: '2024-01-01',
                effective_to: '2024-06-30',
                rules: [],
                rule_snapshot_json: '[]',
                change_summary: 'Previous version',
                published_by: 'user-001',
                published_at: '2024-01-01T00:00:00.000Z',
                is_active: true,
                used_in_decisions: false,
              },
            ],
          ],
        ]),
        putCapture,
        updateCapture,
      });

      const result = await createPolicyVersion(policy, input, 'user-001');

      expect(result.error).toBeUndefined();
      expect(result.version).toBeDefined();
      expect(result.version!.version_number).toBe(3);
    });

    it('persists the version with the correct version_number in DynamoDB', async () => {
      const policy = createMockPolicy();
      const input = createValidVersionInput();

      const versionsQueryKey = buildQueryKey('test-PolicyVersions', { ':pk': 'POLICY#policy-001' });

      const putCapture: Array<Record<string, unknown>> = [];
      const updateCapture: Array<Record<string, unknown>> = [];

      setupDynamoMock({
        queryResponses: new Map([
          [
            versionsQueryKey,
            [
              {
                policy_version_id: 'v-existing',
                policy_id: 'policy-001',
                tenant_id: 'tenant-test',
                version_number: 5,
                effective_from: '2023-01-01',
                effective_to: '2023-12-31',
                rules: [],
                rule_snapshot_json: '[]',
                change_summary: 'Older version',
                published_by: 'user-001',
                published_at: '2023-01-01T00:00:00.000Z',
                is_active: true,
                used_in_decisions: false,
              },
            ],
          ],
        ]),
        putCapture,
        updateCapture,
      });

      const result = await createPolicyVersion(policy, input, 'user-001');

      expect(result.version!.version_number).toBe(6);

      // Verify the PutCommand was called with version_number in the item
      const putCall = putCapture.find(
        (c) => (c['TableName'] as string) === 'test-PolicyVersions'
      );
      expect(putCall).toBeDefined();
      const item = putCall!['Item'] as Record<string, unknown>;
      expect(item['version_number']).toBe(6);
      expect(item['PK']).toBe('POLICY#policy-001');
      expect(item['SK']).toBe('VERSION#mock-version-uuid');
    });

    it('updates the policy current_version_number after creating a new version', async () => {
      const policy = createMockPolicy();
      const input = createValidVersionInput();

      const versionsQueryKey = buildQueryKey('test-PolicyVersions', { ':pk': 'POLICY#policy-001' });

      const putCapture: Array<Record<string, unknown>> = [];
      const updateCapture: Array<Record<string, unknown>> = [];

      setupDynamoMock({
        queryResponses: new Map([[versionsQueryKey, []]]),
        putCapture,
        updateCapture,
      });

      await createPolicyVersion(policy, input, 'user-001');

      // Verify the UpdateCommand was called to update the policy's current_version_number
      const updateCall = updateCapture.find(
        (c) => (c['TableName'] as string) === 'test-Policies'
      );
      expect(updateCall).toBeDefined();
      const key = updateCall!['Key'] as Record<string, string>;
      expect(key['PK']).toBe('TENANT#tenant-test');
      expect(key['SK']).toBe('POLICY#policy-001');
      expect(updateCall!['UpdateExpression']).toContain('current_version_number');
      const values = updateCall!['ExpressionAttributeValues'] as Record<string, unknown>;
      expect(values[':vn']).toBe(1);
    });

    it('queries existing versions to determine the next version number', async () => {
      const policy = createMockPolicy();
      const input = createValidVersionInput();

      const versionsQueryKey = buildQueryKey('test-PolicyVersions', { ':pk': 'POLICY#policy-001' });

      setupDynamoMock({
        queryResponses: new Map([[versionsQueryKey, []]]),
        putCapture: [],
        updateCapture: [],
      });

      await createPolicyVersion(policy, input, 'user-001');

      // Verify queries were made to check existing versions
      const calls = getDynamoCalls();
      const queryCalls = calls.filter((c) => c.command === 'QueryCommand');

      // Should have at least 2 queries: one for getVersionsForPolicy (overlap) and one for getNextVersionNumber
      expect(queryCalls.length).toBeGreaterThanOrEqual(2);

      // Both should target the PolicyVersions table with the policy's PK
      for (const call of queryCalls) {
        const input = call.input as Record<string, unknown>;
        expect(input['TableName']).toBe('test-PolicyVersions');
        expect(input['ExpressionAttributeValues']).toEqual(
          expect.objectContaining({ ':pk': 'POLICY#policy-001' })
        );
      }
    });
  });
});
