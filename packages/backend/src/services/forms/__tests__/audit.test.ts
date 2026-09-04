/**
 * Unit tests for the Forms Audit Module.
 * Verifies that audit log entries include actor, action, timestamp, and entity reference.
 *
 * Requirements: 7.9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  PutCommand: vi.fn().mockImplementation((params) => ({ ...params, constructor: { name: 'PutCommand' } })),
  QueryCommand: vi.fn().mockImplementation((params) => ({ ...params, constructor: { name: 'QueryCommand' } })),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

describe('forms audit module — log entries include actor, action, timestamp, entity reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    process.env['ENVIRONMENT'] = 'dev';
  });

  describe('logAuditEntry — field completeness', () => {
    it('includes actor_id (actor) in the audit entry', async () => {
      const { logAuditEntry } = await import('../audit.js');
      const { AuditEntityType, AuditAction } = await import('../types.js');

      const result = await logAuditEntry({
        entity_type: AuditEntityType.FORMULARIO,
        entity_id: 'form-001',
        action: AuditAction.FORMULARIO_CREADO,
        actor_id: 'user-abc-123',
        ip_address: '10.0.0.1',
        metadata: {},
        tenant_id: 'tenant-t1',
        form_id: 'form-001',
      });

      expect(result.actor_id).toBe('user-abc-123');
      expect(result.actor_id).toBeDefined();
      expect(typeof result.actor_id).toBe('string');
      expect(result.actor_id.length).toBeGreaterThan(0);
    });

    it('includes action type in the audit entry', async () => {
      const { logAuditEntry } = await import('../audit.js');
      const { AuditEntityType, AuditAction } = await import('../types.js');

      const result = await logAuditEntry({
        entity_type: AuditEntityType.FORMULARIO,
        entity_id: 'form-002',
        action: AuditAction.FORMULARIO_PUBLICADO,
        actor_id: 'user-xyz',
        ip_address: '192.168.1.10',
        metadata: {},
        tenant_id: 'tenant-t2',
        form_id: 'form-002',
      });

      expect(result.action).toBe('formulario_publicado');
      expect(result.action).toBeDefined();
      expect(typeof result.action).toBe('string');
      expect(Object.values(AuditAction)).toContain(result.action);
    });

    it('includes ISO-8601 timestamp in the audit entry', async () => {
      const { logAuditEntry } = await import('../audit.js');
      const { AuditEntityType, AuditAction } = await import('../types.js');

      const beforeCall = new Date().toISOString();

      const result = await logAuditEntry({
        entity_type: AuditEntityType.FORMULARIO,
        entity_id: 'form-003',
        action: AuditAction.FORMULARIO_EDITADO,
        actor_id: 'user-editor',
        ip_address: '172.16.0.5',
        metadata: {},
        tenant_id: 'tenant-t3',
        form_id: 'form-003',
      });

      const afterCall = new Date().toISOString();

      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
      // Matches ISO-8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // Timestamp should be between before and after call
      expect(result.timestamp >= beforeCall).toBe(true);
      expect(result.timestamp <= afterCall).toBe(true);
    });

    it('includes entity reference (entity_id) in the audit entry', async () => {
      const { logAuditEntry } = await import('../audit.js');
      const { AuditEntityType, AuditAction } = await import('../types.js');

      const result = await logAuditEntry({
        entity_type: AuditEntityType.RESPUESTA,
        entity_id: 'response-r456',
        action: AuditAction.RESPUESTA_ENVIADA,
        actor_id: 'user-submitter',
        ip_address: '203.0.113.1',
        metadata: { origin_type: 'url_directa' },
        tenant_id: 'tenant-t4',
        form_id: 'form-004',
      });

      expect(result.entity_id).toBe('response-r456');
      expect(result.entity_id).toBeDefined();
      expect(typeof result.entity_id).toBe('string');
      expect(result.entity_id.length).toBeGreaterThan(0);
    });

    it('includes all four required fields (actor, action, timestamp, entity reference) together', async () => {
      const { logAuditEntry } = await import('../audit.js');
      const { AuditEntityType, AuditAction } = await import('../types.js');

      const result = await logAuditEntry({
        entity_type: AuditEntityType.FORMULARIO,
        entity_id: 'form-complete-test',
        action: AuditAction.FORMULARIO_DUPLICADO,
        actor_id: 'user-duplicator-99',
        ip_address: '10.10.10.10',
        metadata: { duplicated_from: 'form-original' },
        tenant_id: 'tenant-full',
        form_id: 'form-complete-test',
      });

      // Actor
      expect(result.actor_id).toBe('user-duplicator-99');
      // Action
      expect(result.action).toBe('formulario_duplicado');
      // Timestamp (ISO-8601)
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // Entity reference
      expect(result.entity_id).toBe('form-complete-test');
    });

    it('persists actor, action, timestamp, and entity reference to DynamoDB', async () => {
      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      const { logAuditEntry } = await import('../audit.js');
      const { AuditEntityType, AuditAction } = await import('../types.js');

      await logAuditEntry({
        entity_type: AuditEntityType.FORMULARIO,
        entity_id: 'form-persisted',
        action: AuditAction.FORMULARIO_DESPUBLICADO,
        actor_id: 'user-admin-77',
        ip_address: '192.168.0.100',
        metadata: {},
        tenant_id: 'tenant-persist',
        form_id: 'form-persisted',
      });

      expect(mockSend).toHaveBeenCalledOnce();
      const putCall = (PutCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // Verify the item written to DynamoDB contains all required fields
      expect(putCall.Item.actor_id).toBe('user-admin-77');
      expect(putCall.Item.action).toBe('formulario_despublicado');
      expect(putCall.Item.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(putCall.Item.entity_id).toBe('form-persisted');
    });

    it('includes entity_type alongside entity_id for full entity reference context', async () => {
      const { logAuditEntry } = await import('../audit.js');
      const { AuditEntityType, AuditAction } = await import('../types.js');

      const result = await logAuditEntry({
        entity_type: AuditEntityType.QR,
        entity_id: 'qr-token-xyz',
        action: AuditAction.QR_DESCARGADO,
        actor_id: 'user-qr-downloader',
        ip_address: '10.0.1.1',
        metadata: {},
        tenant_id: 'tenant-qr',
        form_id: 'form-with-qr',
      });

      expect(result.entity_type).toBe('qr');
      expect(result.entity_id).toBe('qr-token-xyz');
      expect(result.actor_id).toBe('user-qr-downloader');
      expect(result.action).toBe('qr_descargado');
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
