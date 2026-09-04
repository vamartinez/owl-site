/**
 * Forms CRUD Lifecycle Tests.
 * Tests the complete form lifecycle: Create → Read → Update → List → Publish → Unpublish → Duplicate.
 * Ensures the API handler correctly processes each operation and returns expected data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn(),
    GetCommand: vi.fn(),
    QueryCommand: vi.fn(),
    DeleteCommand: vi.fn(),
    UpdateCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
  vi.doMock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn(() => ({})),
    PutObjectCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/bucket/presigned-url'),
  }));
};

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const tenantAdminClaims = {
  sub: 'user-admin-1',
  'custom:tenant_id': 'tenant-abc',
  'custom:role': 'tenant_admin',
};

const supervisorClaims = {
  sub: 'user-super-1',
  'custom:tenant_id': 'tenant-abc',
  'custom:role': 'supervisor',
};

function makeEvent(overrides: Record<string, unknown>) {
  return {
    httpMethod: 'GET',
    resource: '/forms',
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    requestContext: {
      authorizer: { claims: tenantAdminClaims },
      identity: { sourceIp: '10.0.0.1' },
    },
    body: null,
    ...overrides,
  };
}

const sampleForm = {
  form_id: 'form-001',
  tenant_id: 'tenant-abc',
  name: 'Inspección de Seguridad',
  description: 'Formulario para inspecciones diarias',
  status: 'borrador',
  fields: [],
  author_id: 'user-admin-1',
  created_at: '2025-01-15T10:00:00.000Z',
  updated_at: '2025-01-15T10:00:00.000Z',
};

const sampleFormWithFields = {
  ...sampleForm,
  fields: [
    { field_id: 'f1', type: 'texto_corto', label: 'Nombre del inspector', required: true, order: 1 },
    { field_id: 'f2', type: 'seleccion_simple', label: 'Área', required: true, order: 2, options: [{ option_id: 'o1', label: 'Zona A' }, { option_id: 'o2', label: 'Zona B' }] },
    { field_id: 'f3', type: 'texto_largo', label: 'Observaciones', required: false, order: 3 },
  ],
};

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('forms: CRUD lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /forms — Create', () => {
    it('creates a form with name and description, returns 201 with form data', async () => {
      // Mock: duplicate check (no duplicates), form put, audit put
      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms',
        body: JSON.stringify({ name: 'Nuevo Formulario', description: 'Descripción de prueba' }),
      }));

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.form).toBeDefined();
      expect(body.form.name).toBe('Nuevo Formulario');
      expect(body.form.description).toBe('Descripción de prueba');
      expect(body.form.status).toBe('borrador');
      expect(body.form.fields).toEqual([]);
      expect(body.form.form_id).toBeDefined();
      expect(body.form.tenant_id).toBe('tenant-abc');
      expect(body.form.author_id).toBe('user-admin-1');
    });

    it('creates a form with only name (description optional)', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms',
        body: JSON.stringify({ name: 'Solo Nombre' }),
      }));

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.form.name).toBe('Solo Nombre');
      expect(body.form.description).toBeUndefined();
    });

    it('rejects creation with name shorter than 3 chars', async () => {
      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms',
        body: JSON.stringify({ name: 'AB' }),
      }));

      expect(response.statusCode).toBe(400);
    });

    it('rejects creation with empty body', async () => {
      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms',
        body: null,
      }));

      expect(response.statusCode).toBe(400);
    });

    it('rejects duplicate form name within same tenant', async () => {
      // Mock: duplicate check returns existing form
      mockSend.mockResolvedValueOnce({ Items: [{ form_id: 'existing' }] });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms',
        body: JSON.stringify({ name: 'Formulario Existente' }),
      }));

      expect(response.statusCode).toBe(409);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // READ (Get by ID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /forms/{id} — Read', () => {
    it('returns form data when form exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: sampleFormWithFields });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'GET',
        resource: '/forms/{id}',
        pathParameters: { id: 'form-001' },
      }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.form.form_id).toBe('form-001');
      expect(body.form.name).toBe('Inspección de Seguridad');
      expect(body.form.fields).toHaveLength(3);
      expect(body.form.fields[0].label).toBe('Nombre del inspector');
      expect(body.form.fields[1].type).toBe('seleccion_simple');
      expect(body.form.fields[1].options).toHaveLength(2);
    });

    it('returns 404 when form does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'GET',
        resource: '/forms/{id}',
        pathParameters: { id: 'nonexistent-form' },
      }));

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when form ID is missing', async () => {
      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'GET',
        resource: '/forms/{id}',
        pathParameters: null,
      }));

      expect(response.statusCode).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE (PATCH)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('PATCH /forms/{id} — Update', () => {
    it('updates form name successfully', async () => {
      const updatedForm = { ...sampleForm, name: 'Nombre Actualizado', updated_at: '2025-01-16T10:00:00.000Z' };
      mockSend
        .mockResolvedValueOnce({ Item: sampleForm }) // GetCommand
        .mockResolvedValueOnce({ Attributes: updatedForm }) // UpdateCommand
        .mockResolvedValueOnce({}); // audit

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'PATCH',
        resource: '/forms/{id}',
        pathParameters: { id: 'form-001' },
        body: JSON.stringify({ name: 'Nombre Actualizado' }),
      }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.form.name).toBe('Nombre Actualizado');
    });

    it('updates form description', async () => {
      const updatedForm = { ...sampleForm, description: 'Nueva descripción' };
      mockSend
        .mockResolvedValueOnce({ Item: sampleForm })
        .mockResolvedValueOnce({ Attributes: updatedForm })
        .mockResolvedValueOnce({});

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'PATCH',
        resource: '/forms/{id}',
        pathParameters: { id: 'form-001' },
        body: JSON.stringify({ description: 'Nueva descripción' }),
      }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.form.description).toBe('Nueva descripción');
    });

    it('updates form fields with valid configuration', async () => {
      const newFields = [
        { field_id: 'f1', type: 'texto_corto', label: 'Campo 1', required: true, order: 1 },
        { field_id: 'f2', type: 'numero', label: 'Campo 2', required: false, order: 2 },
      ];
      const updatedForm = { ...sampleForm, fields: newFields };
      mockSend
        .mockResolvedValueOnce({ Item: sampleForm })
        .mockResolvedValueOnce({ Attributes: updatedForm })
        .mockResolvedValueOnce({});

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'PATCH',
        resource: '/forms/{id}',
        pathParameters: { id: 'form-001' },
        body: JSON.stringify({ fields: newFields }),
      }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.form.fields).toHaveLength(2);
    });

    it('rejects update on published form (only borrador can be edited)', async () => {
      const publishedForm = { ...sampleForm, status: 'publicado' };
      mockSend.mockResolvedValueOnce({ Item: publishedForm });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'PATCH',
        resource: '/forms/{id}',
        pathParameters: { id: 'form-001' },
        body: JSON.stringify({ name: 'Intento de edición' }),
      }));

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('borrador');
    });

    it('rejects update with invalid name (too short)', async () => {
      mockSend.mockResolvedValueOnce({ Item: sampleForm });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'PATCH',
        resource: '/forms/{id}',
        pathParameters: { id: 'form-001' },
        body: JSON.stringify({ name: 'AB' }),
      }));

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects update with too many fields (>50)', async () => {
      mockSend.mockResolvedValueOnce({ Item: sampleForm });

      const tooManyFields = Array.from({ length: 51 }, (_, i) => ({
        field_id: `f${i}`, type: 'texto_corto', label: `Campo ${i}`, required: false, order: i + 1,
      }));

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'PATCH',
        resource: '/forms/{id}',
        pathParameters: { id: 'form-001' },
        body: JSON.stringify({ fields: tooManyFields }),
      }));

      expect(response.statusCode).toBe(400);
    });

    it('rejects update on nonexistent form', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'PATCH',
        resource: '/forms/{id}',
        pathParameters: { id: 'nonexistent' },
        body: JSON.stringify({ name: 'Test' }),
      }));

      expect(response.statusCode).toBe(404);
    });

    it('rejects selection field without minimum 2 options', async () => {
      mockSend.mockResolvedValueOnce({ Item: sampleForm });

      const invalidFields = [
        { field_id: 'f1', type: 'seleccion_simple', label: 'Opciones', required: true, order: 1, options: [{ option_id: 'o1', label: 'Solo una' }] },
      ];

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'PATCH',
        resource: '/forms/{id}',
        pathParameters: { id: 'form-001' },
        body: JSON.stringify({ fields: invalidFields }),
      }));

      expect(response.statusCode).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /forms — List', () => {
    it('returns empty list when no forms exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'GET',
        resource: '/forms',
      }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.forms).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns all forms for the tenant', async () => {
      const forms = [
        { ...sampleForm, form_id: 'form-001', name: 'Form A' },
        { ...sampleForm, form_id: 'form-002', name: 'Form B', status: 'publicado' },
        { ...sampleForm, form_id: 'form-003', name: 'Form C', status: 'despublicado' },
      ];
      mockSend.mockResolvedValueOnce({ Items: forms });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'GET',
        resource: '/forms',
      }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.forms).toHaveLength(3);
      expect(body.total).toBe(3);
      expect(body.forms[0].name).toBe('Form A');
      expect(body.forms[1].status).toBe('publicado');
    });

    it('supervisor can also list forms', async () => {
      mockSend.mockResolvedValueOnce({ Items: [sampleForm] });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'GET',
        resource: '/forms',
        requestContext: {
          authorizer: { claims: supervisorClaims },
          identity: { sourceIp: '10.0.0.1' },
        },
      }));

      expect(response.statusCode).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLISH
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /forms/{id}/publish — Publish', () => {
    it('publishes a valid draft form', async () => {
      const publishedForm = { ...sampleFormWithFields, status: 'publicado', token_publico: 'tok-123', current_version: 1 };
      mockSend
        .mockResolvedValueOnce({ Item: sampleFormWithFields }) // GetCommand
        .mockResolvedValueOnce({ Items: [] }) // QueryCommand: version check
        .mockResolvedValueOnce({}) // PutCommand: create version
        .mockResolvedValueOnce({ Attributes: publishedForm }) // UpdateCommand: update form
        .mockResolvedValueOnce({}); // PutCommand: audit

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms/{id}/publish',
        pathParameters: { id: 'form-001' },
      }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.form.status).toBe('publicado');
      expect(body.token_publico).toBeDefined();
      expect(body.version_number).toBeDefined();
    });

    it('rejects publishing a form without fields', async () => {
      mockSend.mockResolvedValueOnce({ Item: sampleForm }); // form with empty fields

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms/{id}/publish',
        pathParameters: { id: 'form-001' },
      }));

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects publishing an already published form', async () => {
      const publishedForm = { ...sampleFormWithFields, status: 'publicado' };
      mockSend.mockResolvedValueOnce({ Item: publishedForm });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms/{id}/publish',
        pathParameters: { id: 'form-001' },
      }));

      expect(response.statusCode).toBe(422);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNPUBLISH
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /forms/{id}/unpublish — Unpublish', () => {
    it('unpublishes a published form', async () => {
      const publishedForm = { ...sampleFormWithFields, status: 'publicado', token_publico: 'tok-123' };
      const unpublishedForm = { ...publishedForm, status: 'despublicado' };
      mockSend
        .mockResolvedValueOnce({ Item: publishedForm }) // GetCommand
        .mockResolvedValueOnce({ Attributes: unpublishedForm }) // UpdateCommand
        .mockResolvedValueOnce({}); // audit

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms/{id}/unpublish',
        pathParameters: { id: 'form-001' },
      }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.form.status).toBe('despublicado');
    });

    it('rejects unpublishing a draft form', async () => {
      mockSend.mockResolvedValueOnce({ Item: sampleForm }); // status: borrador

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms/{id}/unpublish',
        pathParameters: { id: 'form-001' },
      }));

      expect(response.statusCode).toBe(422);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DUPLICATE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /forms/{id}/duplicate — Duplicate', () => {
    it('duplicates a form with all fields', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: sampleFormWithFields }) // GetCommand
        .mockResolvedValueOnce({}) // PutCommand: new form
        .mockResolvedValueOnce({}); // PutCommand: audit

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms/{id}/duplicate',
        pathParameters: { id: 'form-001' },
      }));

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.form.name).toContain('(copia)');
      expect(body.form.status).toBe('borrador');
      expect(body.form.fields).toHaveLength(3);
      expect(body.form.form_id).not.toBe('form-001'); // new ID
    });

    it('returns 404 when duplicating nonexistent form', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const { handler } = await import('../../src/services/forms/handler.js');

      const response = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms/{id}/duplicate',
        pathParameters: { id: 'nonexistent' },
      }));

      expect(response.statusCode).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL LIFECYCLE (end-to-end sequence)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full lifecycle: Create → Update → Publish → Unpublish', () => {
    it('completes the full form lifecycle', async () => {
      const { handler } = await import('../../src/services/forms/handler.js');

      // Step 1: CREATE
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // duplicate check
        .mockResolvedValueOnce({}) // put form
        .mockResolvedValueOnce({}); // audit

      const createResponse = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms',
        body: JSON.stringify({ name: 'Lifecycle Test Form' }),
      }));
      expect(createResponse.statusCode).toBe(201);
      const createdForm = JSON.parse(createResponse.body).form;
      expect(createdForm.status).toBe('borrador');

      // Step 2: UPDATE (add fields)
      const fields = [
        { field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: true, order: 1 },
        { field_id: 'f2', type: 'seleccion_simple', label: 'Tipo', required: true, order: 2, options: [{ option_id: 'o1', label: 'A' }, { option_id: 'o2', label: 'B' }] },
      ];
      const formWithFields = { ...createdForm, fields };
      mockSend
        .mockResolvedValueOnce({ Item: createdForm }) // get form
        .mockResolvedValueOnce({ Attributes: formWithFields }) // update
        .mockResolvedValueOnce({}); // audit

      const updateResponse = await handler(makeEvent({
        httpMethod: 'PATCH',
        resource: '/forms/{id}',
        pathParameters: { id: createdForm.form_id },
        body: JSON.stringify({ fields }),
      }));
      expect(updateResponse.statusCode).toBe(200);
      const updatedForm = JSON.parse(updateResponse.body).form;
      expect(updatedForm.fields).toHaveLength(2);

      // Step 3: PUBLISH
      const publishedForm = { ...formWithFields, status: 'publicado', token_publico: 'pub-token', current_version: 1 };
      mockSend
        .mockResolvedValueOnce({ Item: formWithFields }) // get form
        .mockResolvedValueOnce({ Items: [] }) // version check
        .mockResolvedValueOnce({}) // create version
        .mockResolvedValueOnce({ Attributes: publishedForm }) // update form
        .mockResolvedValueOnce({}); // audit

      const publishResponse = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms/{id}/publish',
        pathParameters: { id: createdForm.form_id },
      }));
      expect(publishResponse.statusCode).toBe(200);
      const published = JSON.parse(publishResponse.body);
      expect(published.form.status).toBe('publicado');
      expect(published.token_publico).toBeDefined();

      // Step 4: UNPUBLISH
      const unpublishedForm = { ...publishedForm, status: 'despublicado' };
      mockSend
        .mockResolvedValueOnce({ Item: publishedForm }) // get form
        .mockResolvedValueOnce({ Attributes: unpublishedForm }) // update
        .mockResolvedValueOnce({}); // audit

      const unpublishResponse = await handler(makeEvent({
        httpMethod: 'POST',
        resource: '/forms/{id}/unpublish',
        pathParameters: { id: createdForm.form_id },
      }));
      expect(unpublishResponse.statusCode).toBe(200);
      expect(JSON.parse(unpublishResponse.body).form.status).toBe('despublicado');
    });
  });
});
