/**
 * Property 7: Policy creation always produces a draft version
 *
 * For any valid policy creation request, the system SHALL persist both a policy
 * record and an accompanying version record with status `draft`.
 *
 * **Validates: Requirements 3.2**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../helpers/mock-dynamo';
import { createMockClaims } from '../helpers/mock-user';
import { createMockEvent } from '../helpers/mock-event';

// Mock the dynamo-client module before importing handler
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock uuid to return unique IDs per call
const mockUuidv4 = vi.hoisted(() => vi.fn());
vi.mock('uuid', () => ({
  v4: mockUuidv4,
}));

// Mock auth-middleware to return authenticated user
vi.mock('../../src/shared/auth-middleware.js', () => ({
  authenticateRequest: vi.fn(),
}));

// Mock rbac to allow the operation
vi.mock('../../src/shared/rbac.js', () => ({
  enforcePermission: vi.fn(() => null),
  enforceTenantIsolation: vi.fn(() => null),
}));

import { handler } from '../../src/services/policy/handler.js';
import { authenticateRequest } from '../../src/shared/auth-middleware.js';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid policy names (1-200 chars, non-empty) */
const arbPolicyName = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for valid descriptions (1-2000 chars) */
const arbDescription = fc
  .string({ minLength: 1, maxLength: 2000 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for valid jurisdictions (1-100 chars) */
const arbJurisdiction = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for valid UUIDs */
const arbUuid = fc.uuid();

/** Arbitrary for owner types (valid enum values) */
const arbOwnerType = fc.constantFrom('platform', 'tenant', 'site', 'project');

/** Arbitrary for tenant IDs */
const arbTenantId = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 3,
    maxLength: 36,
  })
  .map((id) => `tenant-${id}`);

/** Arbitrary for user IDs */
const arbUserId = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 3,
    maxLength: 36,
  })
  .map((id) => `user-${id}`);

/** Arbitrary for a complete valid policy creation input */
const arbPolicyCreationInput = fc.record({
  name: arbPolicyName,
  description: arbDescription,
  site_id: arbUuid,
  jurisdiction: arbJurisdiction,
  owner_type: arbOwnerType,
  owner_id: arbUuid,
});

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Policy Creation Draft Property Tests', () => {
  // **Validates: Requirements 3.2**
  describe('Property 7: Policy creation always produces a draft version', () => {
    let uuidCounter: number;

    beforeEach(() => {
      resetDynamoMock();
      setupDynamoMock({ putCapture: [] });
      uuidCounter = 0;

      // Generate unique UUIDs for each call
      mockUuidv4.mockReset();
      mockUuidv4.mockImplementation(() => {
        uuidCounter++;
        return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
      });
    });

    it('for any valid policy creation request, both a policy record and a draft version record are persisted', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbPolicyCreationInput,
          arbTenantId,
          arbUserId,
          async (policyInput, tenantId, userId) => {
            // Reset state for each iteration
            resetDynamoMock();
            setupDynamoMock({ putCapture: [] });
            uuidCounter = 0;
            mockUuidv4.mockReset();
            mockUuidv4.mockImplementation(() => {
              uuidCounter++;
              return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
            });

            // Configure auth to return the generated user
            vi.mocked(authenticateRequest).mockReturnValue({
              user: {
                user_id: userId,
                tenant_id: tenantId,
                role: 'tenant_admin' as never,
                email: `admin@${tenantId}.com`,
                assigned_sites: undefined,
              },
            });

            const event = createMockEvent({
              httpMethod: 'POST',
              resource: '/policies',
              body: policyInput,
              claims: createMockClaims({ tenant_id: tenantId, user_id: userId }),
            });

            const response = await handler(event as never);

            // The handler should respond with 201
            expect(response.statusCode).toBe(201);

            // Retrieve all DynamoDB calls
            const calls = getDynamoCalls();
            const putCalls = calls.filter((c) => c.command === 'PutCommand');

            // TWO PutCommands must have been issued
            expect(putCalls.length).toBeGreaterThanOrEqual(2);

            // Find the policy record PutCommand (Policies table)
            const policyPut = putCalls.find((c) => {
              const input = c.input as { TableName: string; Item: Record<string, unknown> };
              return input.TableName === 'test-Policies';
            });
            expect(policyPut).toBeDefined();

            // Verify the policy record has correct fields
            const policyItem = (policyPut!.input as { TableName: string; Item: Record<string, unknown> }).Item;
            expect(policyItem['tenant_id']).toBe(tenantId);
            expect(policyItem['name']).toBe(policyInput.name.trim());
            expect(policyItem['PK']).toBe(`TENANT#${tenantId}`);

            // Find the version record PutCommand (PolicyVersions table)
            const versionPut = putCalls.find((c) => {
              const input = c.input as { TableName: string; Item: Record<string, unknown> };
              return input.TableName === 'test-PolicyVersions';
            });
            expect(versionPut).toBeDefined();

            // Verify the version record has status 'draft'
            const versionItem = (versionPut!.input as { TableName: string; Item: Record<string, unknown> }).Item;
            expect(versionItem['status']).toBe('draft');
            expect(versionItem['tenant_id']).toBe(tenantId);
            expect(versionItem['policy_id']).toBe(policyItem['policy_id']);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('the draft version record always references the created policy ID', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbPolicyCreationInput,
          arbTenantId,
          arbUserId,
          async (policyInput, tenantId, userId) => {
            // Reset state
            resetDynamoMock();
            setupDynamoMock({ putCapture: [] });
            uuidCounter = 0;
            mockUuidv4.mockReset();
            mockUuidv4.mockImplementation(() => {
              uuidCounter++;
              return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
            });

            vi.mocked(authenticateRequest).mockReturnValue({
              user: {
                user_id: userId,
                tenant_id: tenantId,
                role: 'tenant_admin' as never,
                email: `admin@${tenantId}.com`,
                assigned_sites: undefined,
              },
            });

            const event = createMockEvent({
              httpMethod: 'POST',
              resource: '/policies',
              body: policyInput,
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

            expect(policyPut).toBeDefined();
            expect(versionPut).toBeDefined();

            const policyItem = (policyPut!.input as { TableName: string; Item: Record<string, unknown> }).Item;
            const versionItem = (versionPut!.input as { TableName: string; Item: Record<string, unknown> }).Item;

            // The version's policy_id must match the policy's policy_id
            expect(versionItem['policy_id']).toBe(policyItem['policy_id']);
            // The version's PK must reference the policy ID
            expect(versionItem['PK']).toBe(`POLICY#${policyItem['policy_id']}`);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('the draft version always has version_number 1', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbPolicyCreationInput,
          arbTenantId,
          arbUserId,
          async (policyInput, tenantId, userId) => {
            // Reset state
            resetDynamoMock();
            setupDynamoMock({ putCapture: [] });
            uuidCounter = 0;
            mockUuidv4.mockReset();
            mockUuidv4.mockImplementation(() => {
              uuidCounter++;
              return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, '0')}`;
            });

            vi.mocked(authenticateRequest).mockReturnValue({
              user: {
                user_id: userId,
                tenant_id: tenantId,
                role: 'tenant_admin' as never,
                email: `admin@${tenantId}.com`,
                assigned_sites: undefined,
              },
            });

            const event = createMockEvent({
              httpMethod: 'POST',
              resource: '/policies',
              body: policyInput,
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

            const versionItem = (versionPut!.input as { TableName: string; Item: Record<string, unknown> }).Item;
            expect(versionItem['version_number']).toBe(1);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
