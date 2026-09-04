/**
 * Unit tests for GET /forms/{id}/responses and GET /forms/{id}/responses/{responseId} (task 6.5)
 *
 * Tests the listFormResponses and getFormResponseDetail functions which:
 * - List responses paginated (25 per page) using GSI1 for date ordering
 * - Filter by date range (max 365 days), status, contractor
 * - Return full response detail with field values and version schema
 *
 * Requirements: 12.1, 12.2, 12.3, 12.5, 12.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FieldType } from '../../src/services/forms/types.js';

// Mock DynamoDB
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: (name: string) => `dev-${name}`,
}));

// Mock form-validation (needed by form-response.ts imports)
vi.mock('../../src/services/forms/form-validation.js', () => ({
  validateFormResponse: vi.fn(),
}));

// Mock audit (needed by form-response.ts imports)
vi.mock('../../src/services/forms/audit.js', () => ({
  logAuditEntry: vi.fn(),
}));

// Mock form-version
vi.mock('../../src/services/forms/form-version.js', () => ({
  getFormVersion: vi.fn(),
}));

import { docClient } from '../../src/shared/dynamo-client.js';
import { getFormVersion } from '../../src/services/forms/form-version.js';
import { listFormResponses, getFormResponseDetail } from '../../src/services/forms/form-response.js';

const mockSend = docClient.send as ReturnType<typeof vi.fn>;
const mockGetFormVersion = getFormVersion as ReturnType<typeof vi.fn>;

describe('listFormResponses (GET /forms/{id}/responses)', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetFormVersion.mockReset();
  });

  // Req 12.5: Paginated, 25 per page
  it('returns paginated responses using GSI1 for date ordering', async () => {
    const mockResponses = Array.from({ length: 3 }, (_, i) => ({
      response_id: `resp-${i}`,
      form_id: 'form-123',
      folio: `FOLIO${i}AB`,
      submitted_at: `2024-03-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`,
      version_number: 1,
      metadata: { origin_type: 'qr', user_agent: 'Mozilla/5.0', ip_address: '192.168.1.1' },
      tenant_id: 'tenant-1',
      answers: { 'field-1': 'value' },
    }));

    mockSend.mockResolvedValueOnce({
      Items: mockResponses,
      LastEvaluatedKey: undefined,
    });

    const result = await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.responses).toHaveLength(3);
      expect(result.responses[0]!.response_id).toBe('resp-0');
      expect(result.responses[0]!.folio).toBe('FOLIO0AB');
      expect(result.nextToken).toBeUndefined();
    }
  });

  it('returns nextToken when there are more results', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          response_id: 'resp-1',
          form_id: 'form-123',
          folio: 'ABC12345',
          submitted_at: '2024-03-10T10:00:00.000Z',
          version_number: 1,
          metadata: { origin_type: 'url_directa', user_agent: 'Chrome', ip_address: '10.0.0.1' },
          tenant_id: 'tenant-1',
        },
      ],
      LastEvaluatedKey: {
        PK: 'FORM#form-123',
        SK: 'RESPONSE#resp-1',
        GSI1PK: 'FORM#form-123',
        GSI1SK: 'DATE#2024-03-10T10:00:00.000Z',
      },
    });

    const result = await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.nextToken).toBeDefined();
      expect(result.nextToken).not.toBe('');
    }
  });

  it('passes nextToken as ExclusiveStartKey for pagination', async () => {
    const lastKey = {
      PK: 'FORM#form-123',
      SK: 'RESPONSE#resp-25',
      GSI1PK: 'FORM#form-123',
      GSI1SK: 'DATE#2024-03-01T10:00:00.000Z',
    };
    const encodedToken = Buffer.from(JSON.stringify(lastKey)).toString('base64');

    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      nextToken: encodedToken,
    });

    const callArg = mockSend.mock.calls[0]![0];
    const input = callArg.input;
    expect(input.ExclusiveStartKey).toEqual(lastKey);
  });

  // Req 12.2: Filter by date range (max 365 days)
  it('filters by date range using GSI1SK key condition', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      startDate: '2024-01-01',
      endDate: '2024-03-31',
    });

    const callArg = mockSend.mock.calls[0]![0];
    const input = callArg.input;
    expect(input.KeyConditionExpression).toContain('BETWEEN');
    expect(input.ExpressionAttributeValues[':startKey']).toBe('DATE#2024-01-01');
    expect(input.ExpressionAttributeValues[':endKey']).toContain('DATE#2024-03-31');
  });

  it('rejects date range exceeding 365 days', async () => {
    const result = await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      startDate: '2023-01-01',
      endDate: '2024-06-01',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.message).toContain('365');
    }
  });

  it('rejects invalid start_date format', async () => {
    const result = await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      startDate: 'not-a-date',
      endDate: '2024-03-31',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.message).toContain('start_date');
    }
  });

  it('rejects start_date after end_date', async () => {
    const result = await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      startDate: '2024-06-01',
      endDate: '2024-03-01',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.message).toContain('anterior');
    }
  });

  // Req 12.2: Filter by status
  it('filters by status using FilterExpression', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      status: 'completed',
    });

    const callArg = mockSend.mock.calls[0]![0];
    const input = callArg.input;
    expect(input.FilterExpression).toContain('#responseStatus = :status');
    expect(input.ExpressionAttributeValues[':status']).toBe('completed');
  });

  // Req 12.2: Filter by contractor
  it('filters by contractor using FilterExpression', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      contractor: '192.168.1.1',
    });

    const callArg = mockSend.mock.calls[0]![0];
    const input = callArg.input;
    expect(input.FilterExpression).toContain(':contractor');
    expect(input.ExpressionAttributeValues[':contractor']).toBe('192.168.1.1');
  });

  it('returns error for invalid pagination token', async () => {
    const result = await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      nextToken: 'invalid-base64!!!',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.message).toContain('paginación');
    }
  });

  it('queries GSI1 with correct table and index', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listFormResponses({
      formId: 'form-456',
      tenantId: 'tenant-1',
    });

    const callArg = mockSend.mock.calls[0]![0];
    const input = callArg.input;
    expect(input.TableName).toBe('dev-FormResponses');
    expect(input.IndexName).toBe('GSI1');
    expect(input.KeyConditionExpression).toContain('GSI1PK = :gsi1pk');
    expect(input.ExpressionAttributeValues[':gsi1pk']).toBe('FORM#form-456');
    expect(input.ScanIndexForward).toBe(false); // Most recent first
    expect(input.Limit).toBe(25);
  });

  // Req 12.6: Empty results message
  it('returns empty array when no responses match filters', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      status: 'nonexistent',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.responses).toHaveLength(0);
      expect(result.total).toBe(0);
    }
  });

  it('filters by start_date only (no end_date)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      startDate: '2024-01-01',
    });

    const callArg = mockSend.mock.calls[0]![0];
    const input = callArg.input;
    expect(input.KeyConditionExpression).toContain('>= :startKey');
  });

  it('filters by end_date only (no start_date)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await listFormResponses({
      formId: 'form-123',
      tenantId: 'tenant-1',
      endDate: '2024-12-31',
    });

    const callArg = mockSend.mock.calls[0]![0];
    const input = callArg.input;
    expect(input.KeyConditionExpression).toContain('<= :endKey');
  });
});

describe('getFormResponseDetail (GET /forms/{id}/responses/{responseId})', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetFormVersion.mockReset();
  });

  // Req 12.3: Return full response detail with field values and version schema
  it('returns full response detail with version schema', async () => {
    const mockResponse = {
      PK: 'FORM#form-123',
      SK: 'RESPONSE#resp-1',
      response_id: 'resp-1',
      form_id: 'form-123',
      version_number: 2,
      folio: 'ABC12345',
      submitted_at: '2024-03-10T10:00:00.000Z',
      answers: { 'field-1': 'John Doe', 'field-2': 42 },
      file_keys: { 'field-3': 'forms/tenant-1/form-123/responses/resp-1/field-3/doc.pdf' },
      metadata: { origin_type: 'qr', user_agent: 'Mozilla/5.0', ip_address: '192.168.1.1' },
      tenant_id: 'tenant-1',
    };

    const mockVersion = {
      form_id: 'form-123',
      version_number: 2,
      fields_snapshot: [
        {
          field_id: 'field-1',
          type: FieldType.TEXTO_CORTO,
          label: 'Nombre',
          required: true,
          order: 1,
        },
        {
          field_id: 'field-2',
          type: FieldType.NUMERO,
          label: 'Edad',
          required: true,
          order: 2,
          validation: { min_value: 18, max_value: 120 },
        },
        {
          field_id: 'field-3',
          type: FieldType.CARGA_ARCHIVO,
          label: 'Documento',
          required: false,
          order: 3,
        },
      ],
      created_at: '2024-02-01T00:00:00.000Z',
      created_by: 'admin-1',
    };

    mockSend.mockResolvedValueOnce({ Item: mockResponse });
    mockGetFormVersion.mockResolvedValueOnce(mockVersion);

    const result = await getFormResponseDetail('form-123', 'resp-1', 'tenant-1');

    expect(result.success).toBe(true);
    if (result.success) {
      // Full response with field values
      expect(result.response.response_id).toBe('resp-1');
      expect(result.response.folio).toBe('ABC12345');
      expect(result.response.answers).toEqual({ 'field-1': 'John Doe', 'field-2': 42 });
      expect(result.response.file_keys).toEqual({
        'field-3': 'forms/tenant-1/form-123/responses/resp-1/field-3/doc.pdf',
      });
      expect(result.response.metadata.origin_type).toBe('qr');

      // Version schema
      expect(result.version_schema.version_number).toBe(2);
      expect(result.version_schema.fields_snapshot).toHaveLength(3);
      expect(result.version_schema.fields_snapshot[0]!.label).toBe('Nombre');
    }
  });

  it('returns 404 when response is not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await getFormResponseDetail('form-123', 'nonexistent', 'tenant-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.code).toBe('NOT_FOUND');
      expect(result.message).toBe('Respuesta no encontrada');
    }
  });

  it('returns 404 when tenant_id does not match (tenant isolation)', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        response_id: 'resp-1',
        form_id: 'form-123',
        version_number: 1,
        folio: 'XYZ98765',
        submitted_at: '2024-03-10T10:00:00.000Z',
        answers: {},
        metadata: { origin_type: 'qr', user_agent: 'Chrome', ip_address: '10.0.0.1' },
        tenant_id: 'other-tenant',
      },
    });

    const result = await getFormResponseDetail('form-123', 'resp-1', 'tenant-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('returns 500 when version schema is not found', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        response_id: 'resp-1',
        form_id: 'form-123',
        version_number: 99,
        folio: 'ABC12345',
        submitted_at: '2024-03-10T10:00:00.000Z',
        answers: {},
        metadata: { origin_type: 'qr', user_agent: 'Chrome', ip_address: '10.0.0.1' },
        tenant_id: 'tenant-1',
      },
    });
    mockGetFormVersion.mockResolvedValueOnce(null);

    const result = await getFormResponseDetail('form-123', 'resp-1', 'tenant-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(500);
      expect(result.code).toBe('INTERNAL_ERROR');
    }
  });

  it('queries FormResponses table with correct key format', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    await getFormResponseDetail('form-abc', 'resp-xyz', 'tenant-1');

    const callArg = mockSend.mock.calls[0]![0];
    const input = callArg.input;
    expect(input.TableName).toBe('dev-FormResponses');
    expect(input.Key).toEqual({
      PK: 'FORM#form-abc',
      SK: 'RESPONSE#resp-xyz',
    });
  });

  it('calls getFormVersion with correct form_id and version_number', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        response_id: 'resp-1',
        form_id: 'form-123',
        version_number: 3,
        folio: 'ABC12345',
        submitted_at: '2024-03-10T10:00:00.000Z',
        answers: { 'field-1': 'test' },
        metadata: { origin_type: 'url_directa', user_agent: 'Firefox', ip_address: '10.0.0.2' },
        tenant_id: 'tenant-1',
      },
    });
    mockGetFormVersion.mockResolvedValueOnce({
      form_id: 'form-123',
      version_number: 3,
      fields_snapshot: [],
      created_at: '2024-01-01T00:00:00.000Z',
      created_by: 'admin-1',
    });

    await getFormResponseDetail('form-123', 'resp-1', 'tenant-1');

    expect(mockGetFormVersion).toHaveBeenCalledWith('form-123', 3);
  });
});
