/**
 * Property-based test: Policy version auto-increment
 *
 * Property 5: For any policy with N existing versions, creating a new version
 * SHALL produce a version record with version_number equal to N + 1.
 *
 * **Validates: Requirements 3.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  setupDynamoMock,
  getMockSend,
  resetDynamoMock,
} from '../helpers/mock-dynamo.js';

// Mock the dynamo-client module
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock the event-publisher module
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({
    event_id: 'mock-event-id',
    event_type: 'test',
    source_service: 'policy-service',
    tenant_id: 'tenant-test',
    timestamp: '2024-01-01T00:00:00.000Z',
    payload: {},
    correlation_id: 'mock-corr-id',
    version: '1.0',
  }),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-version-uuid'),
}));

// Import the module under test after mocks are set up
import { getNextVersionNumber } from '../../src/services/policy/version-manager.js';

// --- Helpers ---

/**
 * Builds the query key that mock-dynamo uses as lookup for QueryCommand responses.
 */
function buildQueryKey(
  tableName: string,
  expressionValues: Record<string, unknown>,
  indexName?: string,
) {
  return JSON.stringify({
    TableName: tableName,
    IndexName: indexName,
    ExpressionAttributeValues: expressionValues,
  });
}

// --- Arbitraries ---

/** Arbitrary for N existing versions (1-50 as specified in task) */
const arbExistingVersionCount = fc.integer({ min: 1, max: 50 });

/** Arbitrary for policy IDs */
const arbPolicyId = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 5,
    maxLength: 36,
  })
  .filter((s) => s.length >= 5)
  .map((id) => `policy-${id}`);

// --- Tests ---

describe('Policy Version Auto-Increment Property Tests', () => {
  beforeEach(() => {
    resetDynamoMock();
    vi.clearAllMocks();
  });

  // **Validates: Requirements 3.3**
  describe('Property 5: Policy version auto-increment', () => {
    it('for N existing versions, getNextVersionNumber returns N + 1', () => {
      fc.assert(
        fc.asyncProperty(
          arbExistingVersionCount,
          arbPolicyId,
          async (n, policyId) => {
            resetDynamoMock();

            // Mock DynamoDB to return the latest version with version_number = N
            // (getNextVersionNumber queries with ScanIndexForward=false, Limit=1)
            const queryKey = buildQueryKey('test-PolicyVersions', {
              ':pk': `POLICY#${policyId}`,
            });

            setupDynamoMock({
              queryResponses: new Map([
                [queryKey, [{ version_number: n, policy_version_id: `v-${n}` }]],
              ]),
            });

            const nextVersion = await getNextVersionNumber(policyId);

            // The next version number must be exactly N + 1
            expect(nextVersion).toBe(n + 1);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns 1 when no existing versions (N=0 case)', () => {
      fc.assert(
        fc.asyncProperty(arbPolicyId, async (policyId) => {
          resetDynamoMock();

          // Mock DynamoDB to return empty result (no existing versions)
          const queryKey = buildQueryKey('test-PolicyVersions', {
            ':pk': `POLICY#${policyId}`,
          });

          setupDynamoMock({
            queryResponses: new Map([[queryKey, []]]),
          });

          const nextVersion = await getNextVersionNumber(policyId);

          // First version must be 1
          expect(nextVersion).toBe(1);
        }),
        { numRuns: 100 },
      );
    });
  });
});
