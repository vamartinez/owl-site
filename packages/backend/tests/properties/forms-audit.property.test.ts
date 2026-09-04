// Feature: contractor-forms-qr, Property 2: Registro de auditoría completo
// Feature: contractor-forms-qr, Property 3: Actor de auditoría para contratistas

/**
 * Property-based tests for the Forms Audit Module.
 *
 * Property 2: For any successful action from the set {formulario_creado, formulario_editado,
 * formulario_publicado, formulario_despublicado, qr_descargado, respuesta_enviada,
 * formulario_duplicado}, the system must create an audit record containing: entity type,
 * entity ID, action performed, actor ID, timestamp ISO 8601 UTC, IP address of origin,
 * and form ID affected.
 *
 * Property 3: For any response submission by a contractor, the audit record must register
 * as actor_id the response ID created (not an authenticated user).
 *
 * Validates: Requirements 16.1, 16.2, 16.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => params),
    QueryCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid IPv4 addresses */
const arbIpAddress = fc.tuple(
  fc.integer({ min: 1, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Arbitrary for non-empty alphanumeric IDs */
const arbId = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 3, maxLength: 36 },
);

/** Arbitrary for tenant IDs */
const arbTenantId = arbId.map((id) => `tenant-${id}`);

/** Arbitrary for form IDs */
const arbFormId = arbId.map((id) => `form-${id}`);

/** Arbitrary for actor IDs (user or response) */
const arbActorId = arbId.map((id) => `user-${id}`);

/** Arbitrary for response IDs (used as actor for contractors) */
const arbResponseId = arbId.map((id) => `response-${id}`);

/** All valid audit actions */
const ALL_AUDIT_ACTIONS = [
  'formulario_creado',
  'formulario_editado',
  'formulario_publicado',
  'formulario_despublicado',
  'qr_descargado',
  'respuesta_enviada',
  'formulario_duplicado',
] as const;

/** Arbitrary for any valid audit action */
const arbAuditAction = fc.constantFrom(...ALL_AUDIT_ACTIONS);

/** All valid entity types */
const ALL_ENTITY_TYPES = ['formulario', 'respuesta', 'qr'] as const;

/** Arbitrary for any valid entity type */
const arbEntityType = fc.constantFrom(...ALL_ENTITY_TYPES);

/** Arbitrary for metadata objects */
const arbMetadata = fc.dictionary(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')), { minLength: 1, maxLength: 20 }),
  fc.oneof(fc.string({ maxLength: 100 }), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 },
);

// ─── ISO 8601 UTC regex ───────────────────────────────────────────────────────

const ISO_8601_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('Forms Audit Property Tests', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 16.1, 16.2**
  describe('Property 2: Registro de auditoría completo', () => {
    it('for any successful action, the audit record contains all required fields: entity_type, entity_id, action, actor_id, timestamp ISO 8601 UTC, ip_address, and form_id in metadata', () => {
      fc.assert(
        fc.asyncProperty(
          arbEntityType,
          arbId,
          arbAuditAction,
          arbActorId,
          arbIpAddress,
          arbMetadata,
          arbTenantId,
          arbFormId,
          async (entityType, entityId, action, actorId, ipAddress, metadata, tenantId, formId) => {
            // Reset mocks for each iteration
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();
            mockSend.mockResolvedValueOnce({});

            const { logAuditEntry } = await import('../../src/services/forms/audit.js');

            const result = await logAuditEntry({
              entity_type: entityType as any,
              entity_id: entityId,
              action: action as any,
              actor_id: actorId,
              ip_address: ipAddress,
              metadata,
              tenant_id: tenantId,
              form_id: formId,
            });

            // 1. entity_type must be present and match input
            expect(result.entity_type).toBe(entityType);

            // 2. entity_id must be present and match input
            expect(result.entity_id).toBe(entityId);

            // 3. action must be present and match input
            expect(result.action).toBe(action);

            // 4. actor_id must be present and match input
            expect(result.actor_id).toBe(actorId);

            // 5. timestamp must be ISO 8601 UTC format
            expect(result.timestamp).toMatch(ISO_8601_UTC_REGEX);
            // Verify it's a valid date
            const parsedDate = new Date(result.timestamp);
            expect(parsedDate.toISOString()).toBe(result.timestamp);

            // 6. ip_address must be present and match input
            expect(result.ip_address).toBe(ipAddress);

            // 7. The DynamoDB item must include form_id in the PK (FORM#{form_id})
            const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
            const putCall = (PutCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(putCall.Item.PK).toBe(`FORM#${formId}`);

            // 8. metadata must be present
            expect(result.metadata).toEqual(metadata);

            // 9. tenant_id must be present
            expect(result.tenant_id).toBe(tenantId);

            // 10. expiresAt must be set (TTL)
            expect(result.expiresAt).toBeGreaterThan(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('timestamp is always in UTC (ends with Z) and represents a valid point in time', () => {
      fc.assert(
        fc.asyncProperty(
          arbAuditAction,
          arbEntityType,
          arbFormId,
          async (action, entityType, formId) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();
            mockSend.mockResolvedValueOnce({});

            const { logAuditEntry } = await import('../../src/services/forms/audit.js');

            const beforeMs = Date.now();

            const result = await logAuditEntry({
              entity_type: entityType as any,
              entity_id: 'entity-1',
              action: action as any,
              actor_id: 'actor-1',
              ip_address: '10.0.0.1',
              metadata: {},
              tenant_id: 'tenant-1',
              form_id: formId,
            });

            const afterMs = Date.now();

            // Timestamp ends with Z (UTC)
            expect(result.timestamp.endsWith('Z')).toBe(true);

            // Timestamp is within the execution window
            const timestampMs = new Date(result.timestamp).getTime();
            expect(timestampMs).toBeGreaterThanOrEqual(beforeMs);
            expect(timestampMs).toBeLessThanOrEqual(afterMs);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 16.3**
  describe('Property 3: Actor de auditoría para contratistas', () => {
    it('for any response submission by a contractor, the audit record registers the response_id as actor_id', () => {
      fc.assert(
        fc.asyncProperty(
          arbResponseId,
          arbIpAddress,
          arbFormId,
          arbTenantId,
          fc.constantFrom('qr', 'url_directa'),
          fc.string({ minLength: 1, maxLength: 500 }),
          async (responseId, ipAddress, formId, tenantId, originType, userAgent) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();
            mockSend.mockResolvedValueOnce({});

            const { logAuditEntry } = await import('../../src/services/forms/audit.js');
            const { AuditEntityType, AuditAction } = await import('../../src/services/forms/types.js');

            // Simulate contractor response submission audit
            const result = await logAuditEntry({
              entity_type: AuditEntityType.RESPUESTA,
              entity_id: responseId,
              action: AuditAction.RESPUESTA_ENVIADA,
              actor_id: responseId, // For contractors, actor_id IS the response_id
              ip_address: ipAddress,
              metadata: { origin_type: originType, user_agent: userAgent },
              tenant_id: tenantId,
              form_id: formId,
            });

            // The actor_id must be the response_id (not an authenticated user)
            expect(result.actor_id).toBe(responseId);

            // The entity_type must be 'respuesta'
            expect(result.entity_type).toBe(AuditEntityType.RESPUESTA);

            // The action must be 'respuesta_enviada'
            expect(result.action).toBe(AuditAction.RESPUESTA_ENVIADA);

            // The entity_id must also be the response_id
            expect(result.entity_id).toBe(responseId);

            // Verify the DynamoDB write was called with the response_id as actor
            const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
            const putCall = (PutCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(putCall.Item.actor_id).toBe(responseId);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('actor_id for contractor submissions is never an authenticated user ID pattern', () => {
      fc.assert(
        fc.asyncProperty(
          arbResponseId,
          arbIpAddress,
          arbFormId,
          arbTenantId,
          async (responseId, ipAddress, formId, tenantId) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();
            mockSend.mockResolvedValueOnce({});

            const { logAuditEntry } = await import('../../src/services/forms/audit.js');
            const { AuditEntityType, AuditAction } = await import('../../src/services/forms/types.js');

            const result = await logAuditEntry({
              entity_type: AuditEntityType.RESPUESTA,
              entity_id: responseId,
              action: AuditAction.RESPUESTA_ENVIADA,
              actor_id: responseId,
              ip_address: ipAddress,
              metadata: { origin_type: 'qr' },
              tenant_id: tenantId,
              form_id: formId,
            });

            // actor_id must start with 'response-' prefix (not 'user-')
            expect(result.actor_id).toMatch(/^response-/);
            expect(result.actor_id).not.toMatch(/^user-/);

            // actor_id must equal the response_id exactly
            expect(result.actor_id).toBe(responseId);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
