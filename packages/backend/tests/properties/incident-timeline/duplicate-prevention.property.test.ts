// Feature: incident-timeline, Property 3: Prevención de vínculos duplicados

/**
 * Property-based test for duplicate link prevention.
 *
 * Property 3: For any pair (incident_id, response_id), if there already exists an active
 * Linked_Document (not unlinked) with that pair, then an attempt to create a new link with
 * the same pair SHALL be rejected. If no active link exists, the operation SHALL be accepted.
 *
 * **Validates: Requirements 1.4**
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

/** Arbitrary for incident IDs (UUID-like) */
const arbIncidentId = fc.uuid();

/** Arbitrary for response IDs (UUID-like) */
const arbResponseId = fc.uuid();

/** Arbitrary for link IDs (UUID-like) */
const arbLinkId = fc.uuid();

/** Arbitrary for ISO 8601 date strings */
const arbIsoDate = fc
  .integer({ min: 1704067200000, max: 1735689600000 }) // 2024-01-01 to 2025-01-01
  .map((ms) => new Date(ms).toISOString());

/**
 * Arbitrary for a linked document DynamoDB item.
 * Generates items that represent active (non-unlinked) linked documents.
 */
function arbActiveLinkedItem(incidentId: string, responseId: string) {
  return fc.tuple(arbLinkId, arbIsoDate).map(([linkId, linkedAt]) => ({
    PK: `INCIDENT#${incidentId}`,
    SK: `LINK#${linkedAt}#${linkId}`,
    link_id: linkId,
    incident_id: incidentId,
    response_id: responseId,
    linked_at: linkedAt,
    // No unlinked_at field — this is an active link
  }));
}

/**
 * Arbitrary for a linked document DynamoDB item that has been unlinked (soft-deleted).
 */
function arbUnlinkedItem(incidentId: string, responseId: string) {
  return fc.tuple(arbLinkId, arbIsoDate, arbIsoDate).map(([linkId, linkedAt, unlinkedAt]) => ({
    PK: `INCIDENT#${incidentId}`,
    SK: `LINK#${linkedAt}#${linkId}`,
    link_id: linkId,
    incident_id: incidentId,
    response_id: responseId,
    linked_at: linkedAt,
    unlinked_at: unlinkedAt, // Present — this link was soft-deleted
  }));
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 3: Duplicate link prevention', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 1.4**
  it('isAlreadyLinked returns true when an active link exists for the (incidentId, responseId) pair', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbIncidentId,
        arbResponseId,
        async (incidentId, responseId) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          // Generate an active linked item for this pair
          const activeItem = fc.sample(arbActiveLinkedItem(incidentId, responseId), 1)[0];

          // Mock DynamoDB returning the active item (the filter already excludes unlinked items)
          mockSend.mockResolvedValueOnce({
            Items: [activeItem],
            Count: 1,
          });

          const { isAlreadyLinked } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await isAlreadyLinked(incidentId, responseId);

          // When an active link exists, isAlreadyLinked must return true (duplicate rejected)
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isAlreadyLinked returns false when no active link exists for the (incidentId, responseId) pair', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbIncidentId,
        arbResponseId,
        async (incidentId, responseId) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          // Mock DynamoDB returning no items (no active link exists)
          mockSend.mockResolvedValueOnce({
            Items: [],
            Count: 0,
          });

          const { isAlreadyLinked } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await isAlreadyLinked(incidentId, responseId);

          // When no active link exists, isAlreadyLinked must return false (link accepted)
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isAlreadyLinked returns false when only unlinked (soft-deleted) records exist for the pair', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbIncidentId,
        arbResponseId,
        async (incidentId, responseId) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          // DynamoDB filter (attribute_not_exists(unlinked_at)) means unlinked items
          // are excluded from the result set. So DynamoDB returns empty when only
          // soft-deleted records exist.
          mockSend.mockResolvedValueOnce({
            Items: [],
            Count: 0,
          });

          const { isAlreadyLinked } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await isAlreadyLinked(incidentId, responseId);

          // Only unlinked records exist — link should be accepted
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isAlreadyLinked correctly queries with the right key condition and filter for any pair', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbIncidentId,
        arbResponseId,
        fc.boolean(), // Whether an active link exists
        async (incidentId, responseId, hasActiveLink) => {
          vi.resetModules();
          mockSend.mockReset();
          mockAwsSdk();

          const items = hasActiveLink
            ? [fc.sample(arbActiveLinkedItem(incidentId, responseId), 1)[0]]
            : [];

          mockSend.mockResolvedValueOnce({
            Items: items,
            Count: items.length,
          });

          const { isAlreadyLinked } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await isAlreadyLinked(incidentId, responseId);

          // Verify the query parameters passed to DynamoDB
          expect(mockSend).toHaveBeenCalledOnce();
          const queryParams = mockSend.mock.calls[0][0];

          // The mock returns the raw params object from QueryCommand constructor
          // Verify key condition uses INCIDENT#{incidentId} as PK
          expect(queryParams.ExpressionAttributeValues[':pk']).toBe(
            `INCIDENT#${incidentId}`
          );
          // Verify filter includes response_id match
          expect(queryParams.ExpressionAttributeValues[':responseId']).toBe(responseId);
          // Verify filter excludes unlinked items
          expect(queryParams.FilterExpression).toContain('attribute_not_exists');

          // Result should match whether an active link exists
          expect(result).toBe(hasActiveLink);
        }
      ),
      { numRuns: 100 }
    );
  });
});
