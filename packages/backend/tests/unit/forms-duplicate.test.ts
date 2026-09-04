/**
 * Unit tests for form duplication endpoint (POST /forms/{id}/duplicate).
 * Tests field copying, name generation, state handling, and audit logging.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6
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

const existingForm = {
  form_id: 'form-original-123',
  tenant_id: 'tenant-abc',
  name: 'Formulario de Seguridad',
  description: 'Descripción del formulario original',
  status: 'publicado',
  fields: [
    {
      field_id: 'field-1',
      type: 'texto_corto',
      label: 'Nombre completo',
      required: true,
      order: 1,
      placeholder: 'Ingrese su nombre',
      help_text: 'Nombre y apellido',
    },
    {
      field_id: 'field-2',
      type: 'seleccion_simple',
      label: 'Área de trabajo',
      required: true,
      order: 2,
      options: [
        { option_id: 'opt-1', label: 'Construcción' },
        { option_id: 'opt-2', label: 'Electricidad' },
        { option_id: 'opt-3', label: 'Plomería' },
      ],
    },
    {
      field_id: 'field-3',
      type: 'numero',
      label: 'Años de experiencia',
      required: false,
      order: 3,
      validation: { min_value: 0, max_value: 50 },
    },
  ],
  token_publico: 'abc-token-123',
  current_version: 2,
  author_id: 'user-original',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-06-15T10:30:00.000Z',
  published_at: '2024-03-01T08:00:00.000Z',
};

function createDuplicateEvent(formId: string) {
  return {
    httpMethod: 'POST',
    resource: '/forms/{id}/duplicate',
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

describe('forms: duplicate form (POST /forms/{id}/duplicate)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  // ─── Successful Duplication ─────────────────────────────────────────────────

  it('duplicates a form and returns 201 with new form', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm }) // GetCommand: fetch original
      .mockResolvedValueOnce({}) // PutCommand: save duplicate
      .mockResolvedValueOnce({}); // PutCommand: audit entry

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.form).toBeDefined();
  });

  it('sets status to "borrador" regardless of original status', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm }) // original is "publicado"
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.status).toBe('borrador');
  });

  it('assigns a new UUID as form_id', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(body.form.form_id).toMatch(uuidV4Regex);
    expect(body.form.form_id).not.toBe('form-original-123');
  });

  // ─── Name Generation ────────────────────────────────────────────────────────

  it('sets name to "{original} (copia)"', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.name).toBe('Formulario de Seguridad (copia)');
  });

  it('truncates original name so result does not exceed 200 chars', async () => {
    const longNameForm = {
      ...existingForm,
      name: 'A'.repeat(200), // 200 chars original
    };

    mockSend
      .mockResolvedValueOnce({ Item: longNameForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.name.length).toBeLessThanOrEqual(200);
    expect(body.form.name.endsWith(' (copia)')).toBe(true);
  });

  it('handles name at exactly the truncation boundary', async () => {
    // 192 chars + " (copia)" (8 chars) = 200 chars exactly
    const boundaryForm = {
      ...existingForm,
      name: 'B'.repeat(192),
    };

    mockSend
      .mockResolvedValueOnce({ Item: boundaryForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.name).toBe('B'.repeat(192) + ' (copia)');
    expect(body.form.name.length).toBe(200);
  });

  // ─── Field Copying ──────────────────────────────────────────────────────────

  it('copies all fields with their properties', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.fields).toHaveLength(3);

    // Check first field properties are copied
    const field1 = body.form.fields[0];
    expect(field1.type).toBe('texto_corto');
    expect(field1.label).toBe('Nombre completo');
    expect(field1.required).toBe(true);
    expect(field1.order).toBe(1);
    expect(field1.placeholder).toBe('Ingrese su nombre');
    expect(field1.help_text).toBe('Nombre y apellido');

    // Check selection field options are copied
    const field2 = body.form.fields[1];
    expect(field2.type).toBe('seleccion_simple');
    expect(field2.options).toHaveLength(3);
    expect(field2.options[0].label).toBe('Construcción');
    expect(field2.options[1].label).toBe('Electricidad');
    expect(field2.options[2].label).toBe('Plomería');

    // Check validation rules are copied
    const field3 = body.form.fields[2];
    expect(field3.validation).toEqual({ min_value: 0, max_value: 50 });
  });

  it('assigns new field IDs (not copies of original)', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    const originalFieldIds = existingForm.fields.map((f) => f.field_id);
    const duplicateFieldIds = body.form.fields.map((f: { field_id: string }) => f.field_id);

    // No field ID should match the original
    for (const id of duplicateFieldIds) {
      expect(originalFieldIds).not.toContain(id);
    }
  });

  // ─── Excluded Properties ────────────────────────────────────────────────────

  it('does NOT copy token_publico', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.token_publico).toBeUndefined();
  });

  it('does NOT copy current_version', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.current_version).toBeUndefined();
  });

  it('does NOT copy published_at', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.published_at).toBeUndefined();
  });

  it('assigns new created_at and updated_at dates', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.created_at).not.toBe(existingForm.created_at);
    expect(body.form.updated_at).not.toBe(existingForm.updated_at);
    // Should be recent ISO timestamps
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
    expect(body.form.created_at).toMatch(isoRegex);
    expect(body.form.updated_at).toMatch(isoRegex);
  });

  // ─── Audit Logging ──────────────────────────────────────────────────────────

  it('logs audit entry "formulario_duplicado" with original form ID', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    await handler(event);

    // Third call should be the audit PutCommand
    expect(mockSend).toHaveBeenCalledTimes(3);
    const auditCall = mockSend.mock.calls[2]![0];
    const auditItem = auditCall.input.Item;
    expect(auditItem.action).toBe('formulario_duplicado');
    expect(auditItem.entity_type).toBe('formulario');
    expect(auditItem.actor_id).toBe('user-admin-1');
    expect(auditItem.tenant_id).toBe('tenant-abc');
    expect(auditItem.metadata.original_form_id).toBe('form-original-123');
  });

  // ─── Error Cases ────────────────────────────────────────────────────────────

  it('returns 404 when form does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // form not found

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('nonexistent-form');
    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toContain('Formulario no encontrado');
  });

  it('rejects creation if audit logging fails', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('DynamoDB audit write failed'));

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(500);
  });

  // ─── Copies description ─────────────────────────────────────────────────────

  it('copies the description from the original form', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: existingForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    const body = JSON.parse(response.body);
    expect(body.form.description).toBe('Descripción del formulario original');
  });

  // ─── Duplicates form in borrador state ──────────────────────────────────────

  it('can duplicate a form that is in borrador state', async () => {
    const borradorForm = { ...existingForm, status: 'borrador', token_publico: undefined };

    mockSend
      .mockResolvedValueOnce({ Item: borradorForm })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createDuplicateEvent('form-original-123');
    const response = await handler(event);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.form.status).toBe('borrador');
  });
});
