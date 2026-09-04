/**
 * Property-based test for effective-policies aggregation correctness.
 *
 * Property 6: Effective-policies aggregation correctness
 * For any site with a set of assigned policies having mixed statuses (active, draft, archived),
 * the effective-policies endpoint SHALL return only those policies with status `active`
 * that are assigned to the requested site.
 *
 * **Validates: Requirements 3.4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  setupDynamoMock,
  resetDynamoMock,
  getMockSend,
} from '../helpers/mock-dynamo';

// Mock the dynamo-client module before importing the module under test
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

import { getEffectivePolicies } from '../../src/services/policy/effective-policies.js';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Valid policy statuses as used in the system */
const POLICY_STATUSES = ['active', 'draft', 'archived'] as const;

/** Arbitrary for a policy status */
const arbPolicyStatus = fc.constantFrom(...POLICY_STATUSES);

/** Arbitrary for a tenant ID */
const arbTenantId = fc.string({ minLength: 4, maxLength: 20 }).map(
  (s) => `tenant-${s.replace(/[^a-zA-Z0-9]/g, 'x')}`
);

/** Arbitrary for a site ID */
const arbSiteId = fc.uuid();

/** Arbitrary for a policy ID */
const arbPolicyId = fc.uuid();

/** Arbitrary for a policy name */
const arbPolicyName = fc.string({ minLength: 3, maxLength: 100 }).filter((s) => s.trim().length > 0);

/** Arbitrary for a jurisdiction */
const arbJurisdiction = fc.constantFrom('BC', 'Alberta', 'Ontario', 'Quebec', 'Manitoba', 'Saskatchewan');

/** Arbitrary for an owner type */
const arbOwnerType = fc.constantFrom('tenant', 'site', 'platform');

/** Arbitrary for a version number */
const arbVersionNumber = fc.integer({ min: 1, max: 100 });

/** Arbitrary for a single policy record as stored in DynamoDB */
interface MockPolicyRecord {
  policy_id: string;
  tenant_id: string;
  site_id: string;
  name: string;
  description: string;
  jurisdiction: string;
  owner_type: string;
  status: string;
  current_version_number: number;
}

const arbPolicyRecord = (siteId: string, requestingTenantId: string): fc.Arbitrary<MockPolicyRecord> =>
  fc.record({
    policy_id: arbPolicyId,
    tenant_id: fc.oneof(
      fc.constant(requestingTenantId), // Same tenant (more likely)
      arbTenantId, // Possibly different tenant
    ),
    site_id: fc.constant(siteId),
    name: arbPolicyName,
    description: fc.string({ minLength: 0, maxLength: 200 }),
    jurisdiction: arbJurisdiction,
    owner_type: arbOwnerType,
    status: arbPolicyStatus,
    current_version_number: arbVersionNumber,
  });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Effective Policies Aggregation Property Tests', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  // **Validates: Requirements 3.4**
  describe('Property 6: Effective-policies aggregation correctness', () => {
    it('only active policies from the requesting tenant assigned to the site are returned', () => {
      fc.assert(
        fc.asyncProperty(
          arbSiteId,
          arbTenantId,
          fc.integer({ min: 0, max: 20 }),
          fc.infiniteStream(fc.nat()),
          async (siteId, tenantId, policyCount, seeds) => {
            resetDynamoMock();

            // Generate a list of policies with mixed statuses and tenants
            const policies: MockPolicyRecord[] = [];
            const seedIterator = seeds[Symbol.iterator]();

            for (let i = 0; i < policyCount; i++) {
              const seed = seedIterator.next().value ?? i;
              // Determine status: distribute across active, draft, archived
              const statusIndex = seed % 3;
              const status = POLICY_STATUSES[statusIndex];

              // Determine tenant: 60% same tenant, 40% different
              const isSameTenant = (seed % 5) < 3;
              const policyTenantId = isSameTenant ? tenantId : `tenant-other-${i}`;

              policies.push({
                policy_id: `policy-${i}-${seed}`,
                tenant_id: policyTenantId,
                site_id: siteId,
                name: `Policy ${i}`,
                description: `Description for policy ${i}`,
                jurisdiction: ['BC', 'Alberta', 'Ontario'][i % 3],
                owner_type: ['tenant', 'site', 'platform'][i % 3],
                status,
                current_version_number: (i % 10) + 1,
              });
            }

            // Set up the DynamoDB mock to return the generated policies
            const queryKey = JSON.stringify({
              TableName: 'test-Policies',
              IndexName: 'GSI1',
              ExpressionAttributeValues: {
                ':gsi1pk': `SITE#${siteId}`,
              },
            });

            const queryResponses = new Map<string, Record<string, unknown>[]>();
            queryResponses.set(queryKey, policies as unknown as Record<string, unknown>[]);
            setupDynamoMock({ queryResponses });

            // Call the function under test
            const result = await getEffectivePolicies(siteId, tenantId);

            // Compute the expected result: only active policies from the same tenant
            const expectedPolicies = policies.filter(
              (p) => p.status === 'active' && p.tenant_id === tenantId
            );

            // Verify count matches
            expect(result).toHaveLength(expectedPolicies.length);

            // Verify all returned policies are active
            for (const policy of result) {
              expect(policy.status).toBe('active');
            }

            // Verify all returned policy IDs match expected active policies
            const resultIds = result.map((p) => p.policy_id);
            const expectedIds = expectedPolicies.map((p) => p.policy_id);
            expect(resultIds).toEqual(expectedIds);

            // Verify no non-active policies are returned
            const nonActivePolicyIds = policies
              .filter((p) => p.status !== 'active' || p.tenant_id !== tenantId)
              .map((p) => p.policy_id);
            for (const id of nonActivePolicyIds) {
              expect(resultIds).not.toContain(id);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns empty array when all policies are non-active (draft or archived)', () => {
      fc.assert(
        fc.asyncProperty(
          arbSiteId,
          arbTenantId,
          fc.array(
            fc.record({
              policy_id: arbPolicyId,
              name: arbPolicyName,
              description: fc.string({ minLength: 0, maxLength: 200 }),
              jurisdiction: arbJurisdiction,
              owner_type: arbOwnerType,
              status: fc.constantFrom('draft', 'archived'),
              current_version_number: arbVersionNumber,
            }),
            { minLength: 1, maxLength: 15 },
          ),
          async (siteId, tenantId, nonActivePolicies) => {
            resetDynamoMock();

            const policies = nonActivePolicies.map((p) => ({
              ...p,
              tenant_id: tenantId,
              site_id: siteId,
            }));

            const queryKey = JSON.stringify({
              TableName: 'test-Policies',
              IndexName: 'GSI1',
              ExpressionAttributeValues: {
                ':gsi1pk': `SITE#${siteId}`,
              },
            });

            const queryResponses = new Map<string, Record<string, unknown>[]>();
            queryResponses.set(queryKey, policies as unknown as Record<string, unknown>[]);
            setupDynamoMock({ queryResponses });

            const result = await getEffectivePolicies(siteId, tenantId);

            // No policies should be returned since none are active
            expect(result).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('excludes active policies belonging to a different tenant', () => {
      fc.assert(
        fc.asyncProperty(
          arbSiteId,
          arbTenantId,
          arbTenantId,
          fc.array(
            fc.record({
              policy_id: arbPolicyId,
              name: arbPolicyName,
              description: fc.string({ minLength: 0, maxLength: 200 }),
              jurisdiction: arbJurisdiction,
              owner_type: arbOwnerType,
              current_version_number: arbVersionNumber,
            }),
            { minLength: 1, maxLength: 15 },
          ),
          async (siteId, requestingTenantId, otherTenantId, policyBases) => {
            // Ensure the two tenants are different
            fc.pre(requestingTenantId !== otherTenantId);

            resetDynamoMock();

            // All policies are active but belong to a different tenant
            const policies = policyBases.map((p) => ({
              ...p,
              tenant_id: otherTenantId,
              site_id: siteId,
              status: 'active',
            }));

            const queryKey = JSON.stringify({
              TableName: 'test-Policies',
              IndexName: 'GSI1',
              ExpressionAttributeValues: {
                ':gsi1pk': `SITE#${siteId}`,
              },
            });

            const queryResponses = new Map<string, Record<string, unknown>[]>();
            queryResponses.set(queryKey, policies as unknown as Record<string, unknown>[]);
            setupDynamoMock({ queryResponses });

            const result = await getEffectivePolicies(siteId, requestingTenantId);

            // No policies should be returned since they all belong to a different tenant
            expect(result).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
