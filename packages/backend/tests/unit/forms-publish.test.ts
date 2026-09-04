/**
 * Unit tests for form publish endpoint (POST /forms/{id}/publish).
 * Tests state validation, publish requirements, version creation, and audit logging.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
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

function createPublishEvent(formId: string) {
  return {
    httpMethod: 'POST',
    resource: '/forms/{id}/publish',
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

/**
 * Creates a valid draft form with at least one field for publish tests.
 */
function createValidDraftForm(overrides: Record<string, unknown> = {}) {
  return {
    form_id: 'form-123',
    tenant_id: 'tenant-abc',
    name: 'Formulario de Seguridad',
    description: 'Formulario para contratistas',
    status: 'borrador',
    fields: [
      {
        field_id: 'field-1',
        type: 'texto_corto',
        label: 'Nombre completo',
        required: true,
        order: 1,
      },
    ],
    author_id: 'user-admin-1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('forms: publish form (POST /forms/{id}/publish)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  // ─── Successful Publication ─────────────────────────────────────────────────

  it('publishes a valid draft form and returns 200 with token and version', async () => {
    const form = createValidDraftForm();

    mockSend
      .mockResolvedValueOnce({ Item: form }) // GetCommand: fetch form
      .mockResolvedValueOnce({ Items: [] }) // QueryCommand: get current version (none)
      .mockResolvedValueOnce({}) // PutCommand: create FormVersion
      .mockResolvedValueOnce({ Attributes: { ...form, status: 'publicado', token_publico: 'mock-token' } }) // UpdateCommand: update form
      .mockResolvedValueOnce({}); // PutCommand: audit entry

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.form).toBeDefined();
    expect(body.token_publico).toBeDefined();
    expect(body.url_publica).toContain('/forms/');
    expect(body.version_number).toBe(1);
  });

  it('generates a valid UUID v4 as token_publico', async () => {
    const form = createValidDraftForm();

    mockSend
      .mockResolvedValueOnce({ Item: form })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...form, status: 'publicado' } })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(body.token_publico).toMatch(uuidV4Regex);
  });

  it('creates a FormVersion with version_number 1 for first publish', async () => {
    const form = createValidDraftForm();

    mockSend
      .mockResolvedValueOnce({ Item: form })
      .mockResolvedValueOnce({ Items: [] }) // No existing versions
      .mockResolvedValueOnce({}) // PutCommand: create version
      .mockResolvedValueOnce({ Attributes: { ...form, status: 'publicado' } })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.version_number).toBe(1);

    // Verify the PutCommand for FormVersion was called with correct SK
    const versionPutCall = mockSend.mock.calls[2]![0];
    expect(versionPutCall.input.Item.PK).toBe('FORM#form-123');
    expect(versionPutCall.input.Item.SK).toBe('VERSION#0001');
    expect(versionPutCall.input.Item.version_number).toBe(1);
    expect(versionPutCall.input.Item.fields_snapshot).toEqual(form.fields);
  });

  it('increments version number when previous versions exist', async () => {
    const form = createValidDraftForm();

    mockSend
      .mockResolvedValueOnce({ Item: form })
      .mockResolvedValueOnce({ Items: [{ version_number: 2 }] }) // Existing version 2
      .mockResolvedValueOnce({}) // PutCommand: create version 3
      .mockResolvedValueOnce({ Attributes: { ...form, status: 'publicado' } })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.version_number).toBe(3);
  });

  it('logs audit entry "formulario_publicado" on successful publish', async () => {
    const form = createValidDraftForm();

    mockSend
      .mockResolvedValueOnce({ Item: form })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...form, status: 'publicado' } })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    await handler(event);

    // Last call should be the audit PutCommand
    const auditCall = mockSend.mock.calls[4]![0];
    expect(auditCall.input.Item.action).toBe('formulario_publicado');
    expect(auditCall.input.Item.entity_type).toBe('formulario');
    expect(auditCall.input.Item.entity_id).toBe('form-123');
    expect(auditCall.input.Item.actor_id).toBe('user-admin-1');
    expect(auditCall.input.Item.tenant_id).toBe('tenant-abc');
  });

  // ─── State Validation ───────────────────────────────────────────────────────

  it('rejects publish if form is not in "borrador" state (publicado)', async () => {
    const form = createValidDraftForm({ status: 'publicado' });

    mockSend.mockResolvedValueOnce({ Item: form });

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNPROCESSABLE_ENTITY');
    expect(body.message).toContain('borrador');
  });

  it('rejects publish if form is in "despublicado" state', async () => {
    const form = createValidDraftForm({ status: 'despublicado' });

    mockSend.mockResolvedValueOnce({ Item: form });

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNPROCESSABLE_ENTITY');
  });

  it('returns 404 if form does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('nonexistent-form');
    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });

  // ─── Publish Requirements Validation ────────────────────────────────────────

  it('rejects publish if form has no fields', async () => {
    const form = createValidDraftForm({ fields: [] });

    mockSend.mockResolvedValueOnce({ Item: form });

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.errors).toBeDefined();
    expect(body.details.errors.some((e: { message: string }) => e.message.includes('al menos un campo'))).toBe(true);
  });

  it('rejects publish if name is too short', async () => {
    const form = createValidDraftForm({ name: 'AB' });

    mockSend.mockResolvedValueOnce({ Item: form });

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.errors.some((e: { field: string }) => e.field === 'name')).toBe(true);
  });

  it('rejects publish if a field has empty label', async () => {
    const form = createValidDraftForm({
      fields: [
        {
          field_id: 'field-1',
          type: 'texto_corto',
          label: '',
          required: true,
          order: 1,
        },
      ],
    });

    mockSend.mockResolvedValueOnce({ Item: form });

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.errors.some((e: { message: string }) => e.message.includes('etiqueta'))).toBe(true);
  });

  it('rejects publish if selection field has fewer than 2 options', async () => {
    const form = createValidDraftForm({
      fields: [
        {
          field_id: 'field-1',
          type: 'seleccion_simple',
          label: 'Tipo de trabajo',
          required: true,
          order: 1,
          options: [{ option_id: 'opt-1', label: 'Solo una opción' }],
        },
      ],
    });

    mockSend.mockResolvedValueOnce({ Item: form });

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.errors.some((e: { message: string }) => e.message.includes('al menos 2 opciones'))).toBe(true);
  });

  it('rejects publish if seleccion_multiple field has no options', async () => {
    const form = createValidDraftForm({
      fields: [
        {
          field_id: 'field-1',
          type: 'seleccion_multiple',
          label: 'Certificaciones',
          required: false,
          order: 1,
          options: [],
        },
      ],
    });

    mockSend.mockResolvedValueOnce({ Item: form });

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns all validation errors simultaneously', async () => {
    const form = createValidDraftForm({
      name: 'AB', // too short
      fields: [
        {
          field_id: 'field-1',
          type: 'seleccion_simple',
          label: '', // empty label
          required: true,
          order: 1,
          options: [{ option_id: 'opt-1', label: 'Solo una' }], // < 2 options
        },
      ],
    });

    mockSend.mockResolvedValueOnce({ Item: form });

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    // Should have multiple errors: name + label + options
    expect(body.details.errors.length).toBeGreaterThanOrEqual(2);
  });

  // ─── Successful publish with selection fields ───────────────────────────────

  it('publishes form with valid selection fields (≥2 options)', async () => {
    const form = createValidDraftForm({
      fields: [
        {
          field_id: 'field-1',
          type: 'seleccion_simple',
          label: 'Tipo de trabajo',
          required: true,
          order: 1,
          options: [
            { option_id: 'opt-1', label: 'Electricidad' },
            { option_id: 'opt-2', label: 'Plomería' },
          ],
        },
      ],
    });

    mockSend
      .mockResolvedValueOnce({ Item: form })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...form, status: 'publicado' } })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
  });

  // ─── GSI1 Update ────────────────────────────────────────────────────────────

  it('sets GSI1PK and GSI1SK for token-based lookup on publish', async () => {
    const form = createValidDraftForm();

    mockSend
      .mockResolvedValueOnce({ Item: form })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { ...form, status: 'publicado' } })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');
    const event = createPublishEvent('form-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);

    // Verify the UpdateCommand sets GSI1PK and GSI1SK
    const updateCall = mockSend.mock.calls[3]![0];
    expect(updateCall.input.ExpressionAttributeValues[':gsi1pk']).toBe(`TOKEN#${body.token_publico}`);
    expect(updateCall.input.ExpressionAttributeValues[':gsi1sk']).toBe('FORM#form-123');
  });
});
