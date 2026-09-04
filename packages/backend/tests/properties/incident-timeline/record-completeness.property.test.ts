// Feature: incident-timeline, Property 4: Completitud del registro de vínculo

/**
 * Property-based test for linked document record completeness.
 *
 * Property 4: For any successful link operation with valid inputs, the resulting
 * LinkedDocumentRecord SHALL contain: link_id (UUID), incident_id, response_id,
 * form_id, document_category, linked_by (user_id), linked_by_name, and linked_at
 * (UTC timestamp). All fields SHALL be non-empty.
 *
 * **Validates: Requirements 1.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => params),
    QueryCommand: vi.fn().mockImplementation((params) => params),
    UpdateCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

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

/** Arbitrary for UUID-like strings */
const arbUuid = fc.uuid();

/** Arbitrary for non-empty user names/emails */
const arbUserName = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

/** Arbitrary for a valid document category */
const arbCategory = fc.constantFrom(...VALID_CATEGORIES);

/** Arbitrary for optional description (valid when category is "otro") */
const arbOptionalDescription = fc.option(
  fc.string({ minLength: 5, maxLength: 100 }).filter((s) => s.trim().length >= 5),
  { nil: undefined }
);

/** Arbitrary for optional context note */
const arbOptionalNote = fc.option(
  fc.string({ minLength: 1, maxLength: 500 }),
  { nil: undefined }
);

/** Arbitrary for form name */
const arbFormName = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

/** Arbitrary for folio */
const arbFolio = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

/** Arbitrary for ISO date string */
const arbIsoDate = fc
  .integer({ min: 1704067200000, max: 1735689600000 })
  .map((ms) => new Date(ms).toISOString());

// ─── UUID v4 regex ────────────────────────────────────────────────────────────

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Property 4: Record completeness of linked document', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 1.2**
  it('createLinkedDocument SHALL produce a record with all required fields non-empty', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUuid,       // incident_id
        arbUuid,       // tenant_id
        arbUuid,       // response_id
        arbUuid,       // form_id
        arbCategory,   // document_category
        arbUuid,       // linked_by (user_id)
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
          mockAwsSdk();

          // Mock DynamoDB PutCommand to succeed
          mockSend.mockResolvedValueOnce({});

          const { createLinkedDocument } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const result = await createLinkedDocument({
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

          // All required fields SHALL be present and non-empty
          expect(result.link_id).toBeDefined();
          expect(result.link_id).not.toBe('');
          expect(result.link_id).toMatch(UUID_V4_REGEX);

          expect(result.incident_id).toBe(incidentId);
          expect(result.incident_id).not.toBe('');

          expect(result.response_id).toBe(responseId);
          expect(result.response_id).not.toBe('');

          expect(result.form_id).toBe(formId);
          expect(result.form_id).not.toBe('');

          expect(result.document_category).toBe(category);
          expect(result.document_category).not.toBe('');

          expect(result.linked_by).toBe(linkedBy);
          expect(result.linked_by).not.toBe('');

          expect(result.linked_by_name).toBe(linkedByName);
          expect(result.linked_by_name).not.toBe('');

          expect(result.linked_at).toBeDefined();
          expect(result.linked_at).not.toBe('');
          expect(result.linked_at).toMatch(ISO_DATE_REGEX);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.2**
  it('createLinkedDocument SHALL generate a unique link_id (UUID v4) for each call', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUuid,
        arbUuid,
        arbUuid,
        arbUuid,
        arbCategory,
        arbUuid,
        arbUserName,
        arbFormName,
        arbFolio,
        arbIsoDate,
        arbUserName,
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
          mockAwsSdk();

          // Mock two PutCommand calls
          mockSend.mockResolvedValue({});

          const { createLinkedDocument } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const input = {
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
          };

          const result1 = await createLinkedDocument(input);
          const result2 = await createLinkedDocument(input);

          // Each call generates a unique UUID
          expect(result1.link_id).toMatch(UUID_V4_REGEX);
          expect(result2.link_id).toMatch(UUID_V4_REGEX);
          expect(result1.link_id).not.toBe(result2.link_id);
        }
      ),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 1.2**
  it('createLinkedDocument SHALL set linked_at to a valid UTC ISO 8601 timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUuid,
        arbUuid,
        arbUuid,
        arbUuid,
        arbCategory,
        arbUuid,
        arbUserName,
        arbFormName,
        arbFolio,
        arbIsoDate,
        arbUserName,
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
          mockAwsSdk();

          mockSend.mockResolvedValueOnce({});

          const { createLinkedDocument } = await import(
            '../../../src/services/incidents/linked-documents-repository.js'
          );

          const beforeCall = new Date().toISOString();

          const result = await createLinkedDocument({
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

          const afterCall = new Date().toISOString();

          // linked_at should be a valid ISO 8601 date between before and after the call
          const linkedAtDate = new Date(result.linked_at);
          expect(linkedAtDate.toISOString()).toBe(result.linked_at);
          expect(result.linked_at >= beforeCall).toBe(true);
          expect(result.linked_at <= afterCall).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
