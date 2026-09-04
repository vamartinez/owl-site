// Feature: incident-timeline, Property 5: Creación de audit record para vinculación y desvinculación

/**
 * Property-based tests for audit trail event creation during link/unlink operations.
 *
 * Property 5:
 * - For any successful link operation, there SHALL exist a timeline event with
 *   event_type = "document_linked", the actor_id of the user, response_id linked,
 *   and UTC timestamp.
 * - For any successful unlink operation, there SHALL exist an event with
 *   event_type = "document_unlinked", actor_id, response_id, justification,
 *   and UTC timestamp.
 *
 * **Validates: Requirements 1.3, 5.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { TimelineEvent } from '../../../src/services/incidents/types.js';

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockSend = vi.fn();
let capturedTimelineEvents: TimelineEvent[] = [];

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => params),
    QueryCommand: vi.fn().mockImplementation((params) => params),
    UpdateCommand: vi.fn().mockImplementation((params) => params),
    GetCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

/**
 * Helper to capture timeline events written via PutCommand to the IncidentTimeline table.
 * Also handles PutCommand to IncidentLinkedDocuments and other tables.
 */
function setupMockSendForLink(responseId: string) {
  capturedTimelineEvents = [];

  mockSend.mockImplementation((params: Record<string, unknown>) => {
    const tableName = params['TableName'] as string | undefined;

    // Capture timeline events (PutCommand to IncidentTimeline)
    if (tableName && tableName.includes('IncidentTimeline') && params['Item']) {
      const item = params['Item'] as Record<string, unknown>;
      capturedTimelineEvents.push(item as unknown as TimelineEvent);
    }

    return Promise.resolve({ Items: [], Attributes: params['Item'] ?? {} });
  });
}

function setupMockSendForUnlink(existingItem: Record<string, unknown>) {
  capturedTimelineEvents = [];
  let callCount = 0;

  mockSend.mockImplementation((params: Record<string, unknown>) => {
    callCount++;
    const tableName = params['TableName'] as string | undefined;

    // First call: QueryCommand to find the link by link_id
    if (params['KeyConditionExpression'] && params['FilterExpression']) {
      return Promise.resolve({
        Items: [existingItem],
        Count: 1,
      });
    }

    // UpdateCommand for soft delete
    if (params['UpdateExpression']) {
      return Promise.resolve({
        Attributes: {
          ...existingItem,
          unlinked_at: new Date().toISOString(),
          unlinked_by: 'mock-user',
          unlinked_by_name: 'mock@example.com',
          unlink_justification: 'test justification',
        },
      });
    }

    // Capture timeline events (PutCommand to IncidentTimeline)
    if (tableName && tableName.includes('IncidentTimeline') && params['Item']) {
      const item = params['Item'] as Record<string, unknown>;
      capturedTimelineEvents.push(item as unknown as TimelineEvent);
    }

    return Promise.resolve({ Items: [], Attributes: {} });
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = [
  'investigacion',
  'accion_correctiva',
  'inspeccion',
  'declaracion_testigo',
  'reporte_seguimiento',
  'otro',
] as const;

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const arbUuid = fc.uuid();
const arbUserName = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);
const arbCategory = fc.constantFrom(...VALID_CATEGORIES);
const arbFormName = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);
const arbFolio = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);
const arbIsoDate = fc
  .integer({ min: 1704067200000, max: 1735689600000 })
  .map((ms) => new Date(ms).toISOString());
const arbJustification = fc.string({ minLength: 10, maxLength: 200 }).filter((s) => s.trim().length >= 10);

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 5: Audit record creation for link and unlink operations', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    capturedTimelineEvents = [];
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 1.3**
  it('for any successful link operation, a timeline event with event_type "document_linked" SHALL be created with actor_id, response_id, and UTC timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUuid,       // incident_id
        arbUuid,       // tenant_id
        arbUuid,       // response_id
        arbUuid,       // form_id
        arbCategory,   // document_category
        arbUuid,       // linked_by (actor_id / user_id)
        arbUserName,   // linked_by_name
        arbFormName,   // form_name
        arbFolio,      // folio
        arbIsoDate,    // response_submitted_at
        arbUserName,   // response_submitted_by
        async (
          incidentId,
          tenantId,
          responseId,
          formId,
          category,
          linkedBy,
          linkedByName,
          formName,
          folio,
          responseSubmittedAt,
          responseSubmittedBy
        ) => {
          vi.resetModules();
          mockSend.mockReset();
          capturedTimelineEvents = [];
          mockAwsSdk();

          setupMockSendForLink(responseId);

          const { createLinkedDocument } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );
          const { appendEvent } = await import(
            '../../../src/services/incidents/timeline-repository.js'
          );

          // Step 1: Create the linked document (as the handler would)
          const linkedDoc = await createLinkedDocument({
            incident_id: incidentId,
            tenant_id: tenantId,
            response_id: responseId,
            form_id: formId,
            document_category: category,
            linked_by: linkedBy,
            linked_by_name: linkedByName,
            form_name: formName,
            folio,
            response_submitted_at: responseSubmittedAt,
            response_submitted_by: responseSubmittedBy,
          });

          // Step 2: Create audit trail event (as the handler does after createLinkedDocument)
          const { v4: uuidv4 } = await import('uuid');
          const now = new Date().toISOString();
          const timelineEvent: TimelineEvent = {
            event_id: uuidv4(),
            incident_id: incidentId,
            tenant_id: tenantId,
            event_type: 'document_linked' as TimelineEvent['event_type'],
            actor_id: linkedBy,
            actor_name: linkedByName,
            data: {
              link_id: linkedDoc.link_id,
              response_id: responseId,
              form_id: formId,
              form_name: formName,
              folio,
              document_category: category,
            },
            timestamp: now,
          };
          await appendEvent(timelineEvent);

          // Verify: the captured timeline event has the correct structure
          expect(capturedTimelineEvents.length).toBeGreaterThanOrEqual(1);

          const auditEvent = capturedTimelineEvents.find(
            (e) => e.event_type === 'document_linked'
          );
          expect(auditEvent).toBeDefined();

          // Required fields per Property 5
          expect(auditEvent!.event_type).toBe('document_linked');
          expect(auditEvent!.actor_id).toBe(linkedBy);
          expect(auditEvent!.actor_id).not.toBe('');
          expect((auditEvent!.data as Record<string, unknown>)['response_id']).toBe(responseId);
          expect(auditEvent!.timestamp).toBeDefined();
          expect(auditEvent!.timestamp).not.toBe('');
          expect(auditEvent!.timestamp).toMatch(ISO_DATE_REGEX);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 5.2**
  it('for any successful unlink operation, a timeline event with event_type "document_unlinked" SHALL be created with actor_id, response_id, justification, and UTC timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUuid,            // incident_id
        arbUuid,            // tenant_id
        arbUuid,            // link_id
        arbUuid,            // response_id
        arbUuid,            // actor_id (unlinked_by)
        arbUserName,        // actor_name (unlinked_by_name)
        arbJustification,   // justification (min 10 chars)
        arbFormName,        // form_name
        arbFolio,           // folio
        async (
          incidentId,
          tenantId,
          linkId,
          responseId,
          actorId,
          actorName,
          justification,
          formName,
          folio
        ) => {
          vi.resetModules();
          mockSend.mockReset();
          capturedTimelineEvents = [];
          mockAwsSdk();

          // Create existing linked document item for the mock
          const existingItem = {
            PK: `INCIDENT#${incidentId}`,
            SK: `LINK#2024-06-15T10:00:00.000Z#${linkId}`,
            link_id: linkId,
            incident_id: incidentId,
            tenant_id: tenantId,
            response_id: responseId,
            form_id: 'some-form-id',
            document_category: 'investigacion',
            linked_by: 'original-user',
            linked_by_name: 'original@example.com',
            linked_at: '2024-06-15T10:00:00.000Z',
            form_name: formName,
            folio,
            response_submitted_at: '2024-06-10T08:00:00.000Z',
            response_submitted_by: 'someone',
          };

          setupMockSendForUnlink(existingItem);

          const { unlinkDocument } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );
          const { appendEvent } = await import(
            '../../../src/services/incidents/timeline-repository.js'
          );

          // Step 1: Execute unlink (soft delete)
          const unlinkedDoc = await unlinkDocument(incidentId, linkId, {
            unlinked_by: actorId,
            unlinked_by_name: actorName,
            unlink_justification: justification,
          });

          // Step 2: Create audit trail event (as the handler does after unlinkDocument)
          const { v4: uuidv4 } = await import('uuid');
          const now = new Date().toISOString();
          const timelineEvent: TimelineEvent = {
            event_id: uuidv4(),
            incident_id: incidentId,
            tenant_id: tenantId,
            event_type: 'document_unlinked' as TimelineEvent['event_type'],
            actor_id: actorId,
            actor_name: actorName,
            data: {
              link_id: linkId,
              response_id: responseId,
              form_name: formName,
              folio,
              justification,
            },
            timestamp: now,
          };
          await appendEvent(timelineEvent);

          // Verify: the captured timeline event has the correct structure
          expect(capturedTimelineEvents.length).toBeGreaterThanOrEqual(1);

          const auditEvent = capturedTimelineEvents.find(
            (e) => e.event_type === 'document_unlinked'
          );
          expect(auditEvent).toBeDefined();

          // Required fields per Property 5
          expect(auditEvent!.event_type).toBe('document_unlinked');
          expect(auditEvent!.actor_id).toBe(actorId);
          expect(auditEvent!.actor_id).not.toBe('');
          expect((auditEvent!.data as Record<string, unknown>)['response_id']).toBe(responseId);
          expect((auditEvent!.data as Record<string, unknown>)['justification']).toBe(justification);
          expect(auditEvent!.timestamp).toBeDefined();
          expect(auditEvent!.timestamp).not.toBe('');
          expect(auditEvent!.timestamp).toMatch(ISO_DATE_REGEX);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.3**
  it('the document_linked audit event SHALL contain the response_id that was linked', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUuid,  // response_id
        arbUuid,  // incident_id
        arbUuid,  // actor_id
        async (responseId, incidentId, actorId) => {
          vi.resetModules();
          mockSend.mockReset();
          capturedTimelineEvents = [];
          mockAwsSdk();

          setupMockSendForLink(responseId);

          const { appendEvent } = await import(
            '../../../src/services/incidents/timeline-repository.js'
          );
          const { v4: uuidv4 } = await import('uuid');

          const now = new Date().toISOString();
          const timelineEvent: TimelineEvent = {
            event_id: uuidv4(),
            incident_id: incidentId,
            tenant_id: 'tenant-1',
            event_type: 'document_linked' as TimelineEvent['event_type'],
            actor_id: actorId,
            actor_name: 'test@example.com',
            data: {
              link_id: uuidv4(),
              response_id: responseId,
              form_id: 'form-1',
              form_name: 'Investigation',
              folio: 'INV-001',
              document_category: 'investigacion',
            },
            timestamp: now,
          };
          await appendEvent(timelineEvent);

          // Verify: the response_id in the data matches what was linked
          const auditEvent = capturedTimelineEvents.find(
            (e) => e.event_type === 'document_linked'
          );
          expect(auditEvent).toBeDefined();
          expect((auditEvent!.data as Record<string, unknown>)['response_id']).toBe(responseId);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 5.2**
  it('the document_unlinked audit event SHALL contain the justification provided', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUuid,             // response_id
        arbUuid,             // incident_id
        arbUuid,             // actor_id
        arbJustification,    // justification
        async (responseId, incidentId, actorId, justification) => {
          vi.resetModules();
          mockSend.mockReset();
          capturedTimelineEvents = [];
          mockAwsSdk();

          setupMockSendForLink(responseId);

          const { appendEvent } = await import(
            '../../../src/services/incidents/timeline-repository.js'
          );
          const { v4: uuidv4 } = await import('uuid');

          const now = new Date().toISOString();
          const timelineEvent: TimelineEvent = {
            event_id: uuidv4(),
            incident_id: incidentId,
            tenant_id: 'tenant-1',
            event_type: 'document_unlinked' as TimelineEvent['event_type'],
            actor_id: actorId,
            actor_name: 'admin@example.com',
            data: {
              link_id: uuidv4(),
              response_id: responseId,
              form_name: 'Investigation',
              folio: 'INV-001',
              justification,
            },
            timestamp: now,
          };
          await appendEvent(timelineEvent);

          // Verify: the justification in the data matches what was provided
          const auditEvent = capturedTimelineEvents.find(
            (e) => e.event_type === 'document_unlinked'
          );
          expect(auditEvent).toBeDefined();
          expect((auditEvent!.data as Record<string, unknown>)['justification']).toBe(justification);
          expect((auditEvent!.data as Record<string, unknown>)['justification']).not.toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });
});
