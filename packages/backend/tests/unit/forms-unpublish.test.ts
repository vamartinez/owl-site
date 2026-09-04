/**
 * Unit tests for form unpublish endpoint (POST /forms/{id}/unpublish).
 * Tests state validation, status transition, and audit logging.
 *
 * Requirements: 7.1, 7.2, 7.4, 7.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    GetCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    QueryCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    UpdateCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    DeleteCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

const tenantAdminClaims = {
  sub: 'user-admin-1',
  'custom:tenant_id': 'tenant-abc',
  'custom:role': 'tenant_admin',
};

const publishedForm = {
  PK: 'TENANT#tenant-abc',
  SK: 'FORM#form-123',
  form_id: 'form-123',
  tenant_id: 'tenant-abc',
  name: 'Formulario Publicado',
  description: 'Un formulario de prueba',
  status: 'publicado',
  fields: [
    {
      field_id: 'field-1',
      type: 'texto_corto',
      label: 'Nombre',
      required: true,
      order: 1,
    },
  ],
  token_publico: 'abc-token-uuid',
  current_version: 1,
  author_id: 'user-admin-1',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-02T00:00:00.000Z',
  published_at: '2024-01-02T00:00:00.000Z',
};

function createUnpublishEvent(formId: string) {
  return {
    httpMethod: 'POST',
    resource: '/forms/{id}/unpublish',
    pathParameters: { id: formId },
    queryStringParameters: null,
    headers: {},
    requestContext: {
      authorizer: { claims: tenantAdminClaims },
      identity: { sourceIp: '192.168.1.1' },
    },
    body: null,
  };
}

describe('forms: unpublish form (POST /forms/{id}/unpublish)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  // ─── Successful Unpublish ─────────────────────────────────────────────────

  it('unpublishes a published form and returns 200', async () => {
    // First call: GetCommand to retrieve the form
    // Second call: UpdateCommand to change status
    // Third call: PutCommand for audit entry
    mockSend
      .mockResolvedValueOnce({ Item: publishedForm }) // get form
      .mockResolvedValueOnce({
        Attributes: { ...publishedForm, status: 'despublicado', updated_at: '2024-01-03T00:00:00.000Z' },
      }) // update status
      .mockResolvedValueOnce({}); // audit put

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createUnpublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.form).toBeDefined();
    expect(body.form.status).toBe('despublicado');
  });

  it('changes status from publicado to despublicado', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: publishedForm })
      .mockResolvedValueOnce({
        Attributes: { ...publishedForm, status: 'despublicado' },
      })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createUnpublishEvent('form-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.status).toBe('despublicado');

    // Verify the UpdateCommand was called with correct status
    const updateCall = mockSend.mock.calls[1]![0];
    expect(updateCall.input.ExpressionAttributeValues[':status']).toBe('despublicado');
  });

  // ─── State Validation (Req 7.2) ──────────────────────────────────────────

  it('rejects unpublish for form in borrador state', async () => {
    const draftForm = { ...publishedForm, status: 'borrador' };
    mockSend.mockResolvedValueOnce({ Item: draftForm });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createUnpublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNPROCESSABLE_ENTITY');
    expect(body.message).toContain('Solo formularios publicados pueden ser despublicados');
    expect(body.message).toContain('borrador');
  });

  it('rejects unpublish for form already in despublicado state', async () => {
    const unpublishedForm = { ...publishedForm, status: 'despublicado' };
    mockSend.mockResolvedValueOnce({ Item: unpublishedForm });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createUnpublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNPROCESSABLE_ENTITY');
    expect(body.message).toContain('despublicado');
  });

  // ─── Form Not Found ───────────────────────────────────────────────────────

  it('returns 404 when form does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createUnpublishEvent('nonexistent-form');
    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toContain('Formulario no encontrado');
  });

  // ─── Audit Logging (Req 7.4) ─────────────────────────────────────────────

  it('logs audit entry with action formulario_despublicado', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: publishedForm })
      .mockResolvedValueOnce({
        Attributes: { ...publishedForm, status: 'despublicado' },
      })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createUnpublishEvent('form-123');
    await handler(event);

    // Third call should be the audit PutCommand
    expect(mockSend).toHaveBeenCalledTimes(3);
    const auditCall = mockSend.mock.calls[2]![0];
    const auditItem = auditCall.input.Item;
    expect(auditItem.action).toBe('formulario_despublicado');
    expect(auditItem.entity_type).toBe('formulario');
    expect(auditItem.entity_id).toBe('form-123');
    expect(auditItem.actor_id).toBe('user-admin-1');
    expect(auditItem.tenant_id).toBe('tenant-abc');
    expect(auditItem.ip_address).toBe('192.168.1.1');
  });

  it('audit entry includes UTC timestamp in ISO 8601 format', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: publishedForm })
      .mockResolvedValueOnce({
        Attributes: { ...publishedForm, status: 'despublicado' },
      })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createUnpublishEvent('form-123');
    await handler(event);

    const auditCall = mockSend.mock.calls[2]![0];
    const auditItem = auditCall.input.Item;
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
    expect(auditItem.timestamp).toMatch(isoRegex);
  });

  it('rejects unpublish if audit logging fails', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: publishedForm })
      .mockResolvedValueOnce({
        Attributes: { ...publishedForm, status: 'despublicado' },
      })
      .mockRejectedValueOnce(new Error('DynamoDB audit write failed'));

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createUnpublishEvent('form-123');
    const response = await handler(event);

    // Should return 500 because audit failure rejects the operation
    expect(response.statusCode).toBe(500);
  });

  // ─── Preserves Historical Responses (Req 7.5) ────────────────────────────

  it('does not delete any data when unpublishing (preserves responses)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: publishedForm })
      .mockResolvedValueOnce({
        Attributes: { ...publishedForm, status: 'despublicado' },
      })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createUnpublishEvent('form-123');
    await handler(event);

    // Verify only 3 DynamoDB calls: get, update status, audit log
    // No DeleteCommand calls should be made
    expect(mockSend).toHaveBeenCalledTimes(3);

    // Verify the update only changes status and updated_at (no deletion of token or responses)
    const updateCall = mockSend.mock.calls[1]![0];
    expect(updateCall.input.UpdateExpression).toContain('#status');
    expect(updateCall.input.UpdateExpression).toContain('#updated_at');
    // Should NOT contain any REMOVE expression
    expect(updateCall.input.UpdateExpression).not.toContain('REMOVE');
  });

  // ─── Missing Form ID ──────────────────────────────────────────────────────

  it('returns 400 when form ID is missing from path', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/forms/{id}/unpublish',
      pathParameters: {},
      queryStringParameters: null,
      headers: {},
      requestContext: {
        authorizer: { claims: tenantAdminClaims },
        identity: { sourceIp: '192.168.1.1' },
      },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });
});
