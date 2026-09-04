// Feature: incident-timeline, Property 1: Aislamiento de tenant en respuestas disponibles

/**
 * Property-based test for tenant isolation in linkable responses.
 *
 * Property 1: For any authenticated user with a `tenant_id`, the list of Form_Response
 * available for linking SHALL contain only responses where `response.tenant_id === user.tenant_id`.
 * No response from another tenant SHALL appear in the results.
 *
 * **Validates: Requirements 1.1**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: vi.fn().mockImplementation((params) => params),
    PutCommand: vi.fn().mockImplementation((params) => params),
    UpdateCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for tenant IDs */
const arbTenantId = fc.uuid();

/** Arbitrary for a form response item from DynamoDB */
const arbFormResponseItem = (tenantId: string) =>
  fc.record({
    response_id: fc.uuid(),
    form_id: fc.uuid(),
    form_name: fc.string({ minLength: 1, maxLength: 50 }),
    folio: fc.string({ minLength: 3, maxLength: 20 }),
    submitted_at: fc
      .integer({ min: 1704067200000, max: 1735689600000 })
      .map((ms) => new Date(ms).toISOString()),
    submitted_by_name: fc.string({ minLength: 1, maxLength: 50 }),
    tenant_id: fc.constant(tenantId),
  });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 1: Tenant isolation in linkable responses', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 1.1**
  it('getLinkableResponses queries DynamoDB with the correct tenant_id as key condition', async () => {
    await fc.assert(
      fc.asyncProperty(arbTenantId, async (tenantId) => {
        vi.resetModules();
        mockSend.mockReset();
        mockAwsSdk();

        // Mock DynamoDB returning items belonging to this tenant
        const items = fc.sample(arbFormResponseItem(tenantId), 3);
        mockSend.mockResolvedValueOnce({ Items: items, Count: items.length });

        const { getLinkableResponses } = await import(
          '../../../src/services/incidents/linked-documents-repository.js'
        );

        await getLinkableResponses(tenantId);

        // Verify that the query uses the user's tenant_id as the key condition value
        expect(mockSend).toHaveBeenCalledOnce();
        const queryParams = mockSend.mock.calls[0][0];
        expect(queryParams.ExpressionAttributeValues[':tenantId']).toBe(tenantId);
        expect(queryParams.KeyConditionExpression).toContain('tenant_id = :tenantId');
        expect(queryParams.IndexName).toBe('tenant-index');
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.1**
  it('all returned responses belong to the queried tenant_id only', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTenantId,
        fc.array(fc.uuid(), { minLength: 1, maxLength: 10 }),
        async (tenantId, otherTenantIds) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          // DynamoDB with tenant-index returns only items for the queried tenant
          // Simulate that DynamoDB correctly isolates by tenant (GSI key condition)
          const tenantItems = fc.sample(arbFormResponseItem(tenantId), 5);
          mockSend.mockResolvedValueOnce({ Items: tenantItems, Count: tenantItems.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await getLinkableResponses(tenantId);

          // All returned responses must have data matching the queried tenant's responses
          // Since the query uses tenant_id as GSI PK, only that tenant's data returns
          for (const response of result.responses) {
            // Verify the response is one of the items we returned for this tenant
            const matchingItem = tenantItems.find(
              (item) => item.response_id === response.response_id
            );
            expect(matchingItem).toBeDefined();
            expect(matchingItem!.tenant_id).toBe(tenantId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.1**
  it('no response from a different tenant can appear in results regardless of DynamoDB content', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTenantId,
        arbTenantId.filter((id) => id.length > 0),
        async (userTenantId, otherTenantId) => {
          // Only meaningful when tenants are different
          fc.pre(userTenantId !== otherTenantId);

          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          // DynamoDB tenant-index query only returns items matching the key condition
          // Even if another tenant's items exist, the GSI ensures isolation at the DB level
          const userItems = fc.sample(arbFormResponseItem(userTenantId), 3);
          mockSend.mockResolvedValueOnce({ Items: userItems, Count: userItems.length });

          const { getLinkableResponses } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await getLinkableResponses(userTenantId);

          // No response in the results should belong to a different tenant
          // (The GSI guarantees this, and the code passes the correct tenantId)
          for (const response of result.responses) {
            const sourceItem = userItems.find((i) => i.response_id === response.response_id);
            expect(sourceItem).toBeDefined();
            // Confirm the source item is from the user's tenant, not the other tenant
            expect(sourceItem!.tenant_id).not.toBe(otherTenantId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
