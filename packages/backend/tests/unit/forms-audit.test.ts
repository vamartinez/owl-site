/**
 * Unit tests for the Forms Audit Module.
 * Tests audit entry creation, TTL calculation, DynamoDB key structure, and error propagation.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => params),
    QueryCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

describe('forms: audit module', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  it('writes audit entry to FormAuditLog table with correct structure', async () => {
    mockSend.mockResolvedValueOnce({});

    const { logAuditEntry } = await import('../../src/services/forms/audit.js');
    const { AuditEntityType, AuditAction } = await import('../../src/services/forms/types.js');

    const params = {
      entity_type: AuditEntityType.FORMULARIO,
      entity_id: 'form-123',
      action: AuditAction.FORMULARIO_CREADO,
      actor_id: 'user-456',
      ip_address: '192.168.1.1',
      metadata: { source: 'admin-portal' },
      tenant_id: 'tenant-789',
      form_id: 'form-123',
    };

    const result = await logAuditEntry(params);

    expect(mockSend).toHaveBeenCalledOnce();
    expect(result.entity_type).toBe('formulario');
    expect(result.entity_id).toBe('form-123');
    expect(result.action).toBe('formulario_creado');
    expect(result.actor_id).toBe('user-456');
    expect(result.ip_address).toBe('192.168.1.1');
    expect(result.metadata).toEqual({ source: 'admin-portal' });
    expect(result.tenant_id).toBe('tenant-789');
  });

  it('generates ISO 8601 UTC timestamp', async () => {
    mockSend.mockResolvedValueOnce({});

    const { logAuditEntry } = await import('../../src/services/forms/audit.js');
    const { AuditEntityType, AuditAction } = await import('../../src/services/forms/types.js');

    const before = new Date().toISOString();

    const result = await logAuditEntry({
      entity_type: AuditEntityType.FORMULARIO,
      entity_id: 'form-123',
      action: AuditAction.FORMULARIO_CREADO,
      actor_id: 'user-456',
      ip_address: '10.0.0.1',
      metadata: {},
      tenant_id: 'tenant-789',
      form_id: 'form-123',
    });

    const after = new Date().toISOString();

    // Timestamp should be a valid ISO 8601 string
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result.timestamp >= before).toBe(true);
    expect(result.timestamp <= after).toBe(true);
  });

  it('sets TTL (expiresAt) to 365 days from creation', async () => {
    mockSend.mockResolvedValueOnce({});

    const { logAuditEntry } = await import('../../src/services/forms/audit.js');
    const { AuditEntityType, AuditAction, AUDIT_TTL_SECONDS } = await import('../../src/services/forms/types.js');

    const nowEpoch = Math.floor(Date.now() / 1000);

    const result = await logAuditEntry({
      entity_type: AuditEntityType.FORMULARIO,
      entity_id: 'form-123',
      action: AuditAction.FORMULARIO_EDITADO,
      actor_id: 'user-456',
      ip_address: '10.0.0.1',
      metadata: {},
      tenant_id: 'tenant-789',
      form_id: 'form-123',
    });

    // expiresAt should be approximately now + 365 days (within 5 seconds tolerance)
    const expectedMin = nowEpoch + AUDIT_TTL_SECONDS - 5;
    const expectedMax = nowEpoch + AUDIT_TTL_SECONDS + 5;
    expect(result.expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(result.expiresAt).toBeLessThanOrEqual(expectedMax);
  });

  it('constructs PK as FORM#{form_id} and SK as AUDIT#{timestamp}#{shortUuid}', async () => {
    mockSend.mockResolvedValueOnce({});

    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const { logAuditEntry } = await import('../../src/services/forms/audit.js');
    const { AuditEntityType, AuditAction } = await import('../../src/services/forms/types.js');

    await logAuditEntry({
      entity_type: AuditEntityType.FORMULARIO,
      entity_id: 'form-abc',
      action: AuditAction.FORMULARIO_PUBLICADO,
      actor_id: 'user-xyz',
      ip_address: '172.16.0.1',
      metadata: { version: 1 },
      tenant_id: 'tenant-001',
      form_id: 'form-abc',
    });

    // Verify PutCommand was called with correct key structure
    const putCall = (PutCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(putCall.TableName).toBe('dev-FormAuditLog');
    expect(putCall.Item.PK).toBe('FORM#form-abc');
    expect(putCall.Item.SK).toMatch(/^AUDIT#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[a-f0-9]{8}$/);
    expect(putCall.Item.GSI1PK).toBe('TENANT#tenant-001');
    expect(putCall.Item.GSI1SK).toMatch(/^AUDIT#\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('throws error when DynamoDB write fails (rejects parent operation)', async () => {
    const dbError = new Error('DynamoDB write failed: ConditionalCheckFailedException');
    mockSend.mockRejectedValueOnce(dbError);

    const { logAuditEntry } = await import('../../src/services/forms/audit.js');
    const { AuditEntityType, AuditAction } = await import('../../src/services/forms/types.js');

    await expect(
      logAuditEntry({
        entity_type: AuditEntityType.RESPUESTA,
        entity_id: 'response-999',
        action: AuditAction.RESPUESTA_ENVIADA,
        actor_id: 'response-999',
        ip_address: '203.0.113.50',
        metadata: { origin_type: 'qr' },
        tenant_id: 'tenant-001',
        form_id: 'form-abc',
      })
    ).rejects.toThrow('DynamoDB write failed');
  });

  it('supports all audit actions defined in the spec', async () => {
    const { AuditAction } = await import('../../src/services/forms/types.js');

    const expectedActions = [
      'formulario_creado',
      'formulario_editado',
      'formulario_publicado',
      'formulario_despublicado',
      'formulario_duplicado',
      'qr_descargado',
      'respuesta_enviada',
    ];

    const actualActions = Object.values(AuditAction);
    for (const action of expectedActions) {
      expect(actualActions).toContain(action);
    }
  });

  it('supports all entity types defined in the spec', async () => {
    const { AuditEntityType } = await import('../../src/services/forms/types.js');

    expect(Object.values(AuditEntityType)).toContain('formulario');
    expect(Object.values(AuditEntityType)).toContain('respuesta');
    expect(Object.values(AuditEntityType)).toContain('qr');
  });

  it('uses response_id as actor_id for contractor submissions (Req 16.3)', async () => {
    mockSend.mockResolvedValueOnce({});

    const { logAuditEntry } = await import('../../src/services/forms/audit.js');
    const { AuditEntityType, AuditAction } = await import('../../src/services/forms/types.js');

    const result = await logAuditEntry({
      entity_type: AuditEntityType.RESPUESTA,
      entity_id: 'response-abc123',
      action: AuditAction.RESPUESTA_ENVIADA,
      actor_id: 'response-abc123', // response_id used as actor for contractors
      ip_address: '198.51.100.42',
      metadata: { origin_type: 'qr', user_agent: 'Mozilla/5.0' },
      tenant_id: 'tenant-001',
      form_id: 'form-xyz',
    });

    expect(result.actor_id).toBe('response-abc123');
    expect(result.entity_type).toBe('respuesta');
    expect(result.action).toBe('respuesta_enviada');
  });
});


describe('forms: audit query (queryAuditLog)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  it('queries FormAuditLog table by PK=FORM#{form_id} with descending order', async () => {
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

    const { queryAuditLog } = await import('../../src/services/forms/audit.js');

    await queryAuditLog('form-123');

    const queryCall = (QueryCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(queryCall.TableName).toBe('dev-FormAuditLog');
    expect(queryCall.KeyConditionExpression).toBe('PK = :pk');
    expect(queryCall.ExpressionAttributeValues[':pk']).toBe('FORM#form-123');
    expect(queryCall.ScanIndexForward).toBe(false);
    expect(queryCall.Limit).toBe(50);
  });

  it('returns audit entries mapped to AuditEntry interface', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'FORM#form-123',
          SK: 'AUDIT#2024-01-15T10:30:00.000Z#abc12345',
          entity_type: 'formulario',
          entity_id: 'form-123',
          action: 'formulario_publicado',
          actor_id: 'user-456',
          timestamp: '2024-01-15T10:30:00.000Z',
          ip_address: '192.168.1.1',
          metadata: { version: 1 },
          tenant_id: 'tenant-789',
          expiresAt: 1737000000,
        },
        {
          PK: 'FORM#form-123',
          SK: 'AUDIT#2024-01-14T08:00:00.000Z#def67890',
          entity_type: 'formulario',
          entity_id: 'form-123',
          action: 'formulario_creado',
          actor_id: 'user-456',
          timestamp: '2024-01-14T08:00:00.000Z',
          ip_address: '192.168.1.1',
          metadata: {},
          tenant_id: 'tenant-789',
          expiresAt: 1736900000,
        },
      ],
      Count: 2,
    });

    const { queryAuditLog } = await import('../../src/services/forms/audit.js');

    const result = await queryAuditLog('form-123');

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].action).toBe('formulario_publicado');
    expect(result.entries[0].entity_type).toBe('formulario');
    expect(result.entries[0].entity_id).toBe('form-123');
    expect(result.entries[0].actor_id).toBe('user-456');
    expect(result.entries[0].timestamp).toBe('2024-01-15T10:30:00.000Z');
    expect(result.entries[0].ip_address).toBe('192.168.1.1');
    expect(result.entries[0].metadata).toEqual({ version: 1 });
    expect(result.entries[0].tenant_id).toBe('tenant-789');
    expect(result.entries[0].expiresAt).toBe(1737000000);
    expect(result.entries[1].action).toBe('formulario_creado');
    expect(result.cursor).toBeUndefined();
  });

  it('returns cursor when LastEvaluatedKey is present (pagination)', async () => {
    const lastKey = { PK: 'FORM#form-123', SK: 'AUDIT#2024-01-10T00:00:00.000Z#aaa11111' };
    mockSend.mockResolvedValueOnce({
      Items: Array(50).fill({
        entity_type: 'formulario',
        entity_id: 'form-123',
        action: 'formulario_editado',
        actor_id: 'user-456',
        timestamp: '2024-01-15T10:30:00.000Z',
        ip_address: '10.0.0.1',
        metadata: {},
        tenant_id: 'tenant-789',
        expiresAt: 1737000000,
      }),
      Count: 50,
      LastEvaluatedKey: lastKey,
    });

    const { queryAuditLog } = await import('../../src/services/forms/audit.js');

    const result = await queryAuditLog('form-123');

    expect(result.entries).toHaveLength(50);
    expect(result.cursor).toBeDefined();
    // Cursor should be base64 encoded LastEvaluatedKey
    const decoded = JSON.parse(Buffer.from(result.cursor!, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastKey);
  });

  it('passes ExclusiveStartKey when cursor is provided', async () => {
    const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
    const startKey = { PK: 'FORM#form-123', SK: 'AUDIT#2024-01-10T00:00:00.000Z#bbb22222' };
    const cursor = Buffer.from(JSON.stringify(startKey)).toString('base64');

    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

    const { queryAuditLog } = await import('../../src/services/forms/audit.js');

    await queryAuditLog('form-123', cursor);

    const queryCall = (QueryCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(queryCall.ExclusiveStartKey).toEqual(startKey);
  });

  it('returns empty entries array when no items found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 });

    const { queryAuditLog } = await import('../../src/services/forms/audit.js');

    const result = await queryAuditLog('form-nonexistent');

    expect(result.entries).toEqual([]);
    expect(result.cursor).toBeUndefined();
  });

  it('handles missing metadata gracefully (defaults to empty object)', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          entity_type: 'formulario',
          entity_id: 'form-123',
          action: 'formulario_creado',
          actor_id: 'user-456',
          timestamp: '2024-01-14T08:00:00.000Z',
          ip_address: '10.0.0.1',
          tenant_id: 'tenant-789',
          expiresAt: 1736900000,
          // metadata is missing
        },
      ],
      Count: 1,
    });

    const { queryAuditLog } = await import('../../src/services/forms/audit.js');

    const result = await queryAuditLog('form-123');

    expect(result.entries[0].metadata).toEqual({});
  });
});
