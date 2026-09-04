/**
 * Unit tests for GET /public/forms/{token} (task 5.1)
 *
 * Tests the getPublicForm function which:
 * - Queries Forms table GSI1 by token
 * - Returns 404 if token not found or form in "borrador" state
 * - Returns 410 if form is "despublicado"
 * - Returns form schema for "publicado" forms
 *
 * Requirements: 3.2, 7.3, 9.1, 9.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FormStatus, FieldType } from '../../src/services/forms/types.js';

// Mock DynamoDB
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: (name: string) => `dev-${name}`,
}));

import { docClient } from '../../src/shared/dynamo-client.js';
import { getPublicForm } from '../../src/services/forms/form-response.js';

const mockSend = docClient.send as ReturnType<typeof vi.fn>;

describe('getPublicForm (GET /public/forms/{token})', () => {
  beforeEach(() => {
    mockSend.mockReset();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // Req 9.4: Token not found → 404
  it('returns 404 when token is not found in GSI1', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await getPublicForm('non-existent-token');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.code).toBe('NOT_FOUND');
      expect(result.message).toBe('Formulario no encontrado');
    }
  });

  it('returns 404 when GSI1 query returns no items (null Items)', async () => {
    mockSend.mockResolvedValueOnce({ Items: undefined });

    const result = await getPublicForm('some-token');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  // Req 3.2: Borrador forms → 404 without revealing content
  it('returns 404 for forms in "borrador" state without revealing content', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          form_id: 'form-123',
          tenant_id: 'tenant-1',
          name: 'Secret Draft Form',
          description: 'This should not be visible',
          status: FormStatus.BORRADOR,
          fields: [
            {
              field_id: 'field-1',
              type: FieldType.TEXTO_CORTO,
              label: 'Name',
              required: true,
              order: 1,
            },
          ],
          token_publico: 'some-token',
          author_id: 'user-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await getPublicForm('some-token');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.code).toBe('NOT_FOUND');
      expect(result.message).toBe('Formulario no encontrado');
      // Should NOT contain any form data
      expect(result).not.toHaveProperty('form');
    }
  });

  // Req 7.3: Despublicado forms → 410 Gone
  it('returns 410 for forms in "despublicado" state with appropriate message', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          form_id: 'form-456',
          tenant_id: 'tenant-1',
          name: 'Unpublished Form',
          status: FormStatus.DESPUBLICADO,
          fields: [],
          token_publico: 'unpublished-token',
          author_id: 'user-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:00.000Z',
        },
      ],
    });

    const result = await getPublicForm('unpublished-token');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(410);
      expect(result.code).toBe('GONE');
      expect(result.message).toBe('Este formulario ya no está disponible');
    }
  });

  // Req 9.1: Published form → return schema with name, description, fields in order
  it('returns form schema for "publicado" forms with fields sorted by order', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          form_id: 'form-789',
          tenant_id: 'tenant-1',
          name: 'Registro de Contratista',
          description: 'Complete este formulario para registrarse',
          status: FormStatus.PUBLICADO,
          fields: [
            {
              field_id: 'field-3',
              type: FieldType.FECHA,
              label: 'Fecha de inicio',
              required: false,
              order: 3,
              help_text: 'Seleccione la fecha de inicio del contrato',
            },
            {
              field_id: 'field-1',
              type: FieldType.TEXTO_CORTO,
              label: 'Nombre completo',
              required: true,
              order: 1,
              placeholder: 'Ingrese su nombre',
            },
            {
              field_id: 'field-2',
              type: FieldType.SELECCION_SIMPLE,
              label: 'Tipo de contrato',
              required: true,
              order: 2,
              options: [
                { option_id: 'opt-1', label: 'Temporal' },
                { option_id: 'opt-2', label: 'Permanente' },
              ],
            },
          ],
          token_publico: 'published-token',
          current_version: 1,
          author_id: 'user-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
          published_at: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await getPublicForm('published-token');

    expect(result.success).toBe(true);
    if (result.success) {
      // Name and description
      expect(result.form.name).toBe('Registro de Contratista');
      expect(result.form.description).toBe('Complete este formulario para registrarse');

      // Fields sorted by order
      expect(result.form.fields).toHaveLength(3);
      expect(result.form.fields[0]!.order).toBe(1);
      expect(result.form.fields[0]!.label).toBe('Nombre completo');
      expect(result.form.fields[0]!.placeholder).toBe('Ingrese su nombre');
      expect(result.form.fields[1]!.order).toBe(2);
      expect(result.form.fields[1]!.label).toBe('Tipo de contrato');
      expect(result.form.fields[1]!.options).toHaveLength(2);
      expect(result.form.fields[2]!.order).toBe(3);
      expect(result.form.fields[2]!.label).toBe('Fecha de inicio');
      expect(result.form.fields[2]!.help_text).toBe('Seleccione la fecha de inicio del contrato');

      // Rendering properties present
      expect(result.form.fields[0]!.type).toBe(FieldType.TEXTO_CORTO);
      expect(result.form.fields[0]!.required).toBe(true);
      expect(result.form.fields[2]!.required).toBe(false);
    }
  });

  it('returns form schema without description when form has no description', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          form_id: 'form-no-desc',
          tenant_id: 'tenant-1',
          name: 'Simple Form',
          status: FormStatus.PUBLICADO,
          fields: [
            {
              field_id: 'field-1',
              type: FieldType.CHECKBOX_ACEPTACION,
              label: 'Acepto los términos',
              required: true,
              order: 1,
            },
          ],
          token_publico: 'no-desc-token',
          author_id: 'user-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await getPublicForm('no-desc-token');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.form.name).toBe('Simple Form');
      expect(result.form.description).toBeUndefined();
      expect(result.form.fields).toHaveLength(1);
    }
  });

  it('includes validation rules in the public schema', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          form_id: 'form-validation',
          tenant_id: 'tenant-1',
          name: 'Form with Validation',
          status: FormStatus.PUBLICADO,
          fields: [
            {
              field_id: 'field-num',
              type: FieldType.NUMERO,
              label: 'Edad',
              required: true,
              order: 1,
              validation: {
                min_value: 18,
                max_value: 120,
              },
            },
            {
              field_id: 'field-text',
              type: FieldType.TEXTO_LARGO,
              label: 'Comentarios',
              required: false,
              order: 2,
              validation: {
                max_length: 5000,
              },
            },
          ],
          token_publico: 'validation-token',
          author_id: 'user-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await getPublicForm('validation-token');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.form.fields[0]!.validation).toEqual({
        min_value: 18,
        max_value: 120,
      });
      expect(result.form.fields[1]!.validation).toEqual({
        max_length: 5000,
      });
    }
  });

  it('queries GSI1 with correct key format TOKEN#{token}', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await getPublicForm('my-test-token');

    // Verify the QueryCommand was called with correct GSI1 parameters
    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArg = mockSend.mock.calls[0]![0];
    const input = callArg.input;
    expect(input.TableName).toBe('dev-Forms');
    expect(input.IndexName).toBe('GSI1');
    expect(input.KeyConditionExpression).toBe('GSI1PK = :gsi1pk');
    expect(input.ExpressionAttributeValues[':gsi1pk']).toBe('TOKEN#my-test-token');
  });
});


// ─── Unit tests for POST /public/forms/{token}/responses (task 5.5) ───────────

import { submitFormResponse, generateFolio } from '../../src/services/forms/form-response.js';

// Mock the audit module
vi.mock('../../src/services/forms/audit.js', () => ({
  logAuditEntry: vi.fn().mockResolvedValue({
    entity_type: 'respuesta',
    entity_id: 'mock-id',
    action: 'respuesta_enviada',
    actor_id: 'mock-id',
    timestamp: '2024-01-01T00:00:00.000Z',
    ip_address: '192.168.1.1',
    metadata: {},
    tenant_id: 'tenant-1',
    expiresAt: 0,
  }),
}));

import { logAuditEntry } from '../../src/services/forms/audit.js';

const mockLogAuditEntry = logAuditEntry as ReturnType<typeof vi.fn>;

describe('submitFormResponse (POST /public/forms/{token}/responses)', () => {
  const publishedForm = {
    form_id: 'form-pub-1',
    tenant_id: 'tenant-1',
    name: 'Registro Contratista',
    status: FormStatus.PUBLICADO,
    fields: [
      {
        field_id: 'field-name',
        type: FieldType.TEXTO_CORTO,
        label: 'Nombre',
        required: true,
        order: 1,
      },
      {
        field_id: 'field-age',
        type: FieldType.NUMERO,
        label: 'Edad',
        required: false,
        order: 2,
        validation: { min_value: 18, max_value: 120 },
      },
    ],
    token_publico: 'pub-token-1',
    current_version: 2,
    author_id: 'user-1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    published_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockSend.mockReset();
    mockLogAuditEntry.mockClear();
  });

  // Req 11.8: Reject if form is despublicado
  it('returns 410 when form is despublicado', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...publishedForm, status: FormStatus.DESPUBLICADO }],
    });

    const result = await submitFormResponse(
      'pub-token-1',
      { answers: { 'field-name': 'Juan' } },
      '192.168.1.1',
      'Mozilla/5.0',
      'https://example.com/forms/pub-token-1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(410);
      expect(result.code).toBe('GONE');
      expect(result.message).toContain('ya no está disponible');
    }
  });

  // Token not found → 404
  it('returns 404 when token is not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await submitFormResponse(
      'non-existent',
      { answers: {} },
      '192.168.1.1',
      'Mozilla/5.0'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  // Form in borrador → 404
  it('returns 404 when form is in borrador state', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ ...publishedForm, status: FormStatus.BORRADOR }],
    });

    const result = await submitFormResponse(
      'pub-token-1',
      { answers: { 'field-name': 'Juan' } },
      '192.168.1.1',
      'Mozilla/5.0'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  // Req 11.9: Server-side validation rejects invalid data
  it('returns 400 with validation errors when required fields are missing', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });

    const result = await submitFormResponse(
      'pub-token-1',
      { answers: {} }, // Missing required 'field-name'
      '192.168.1.1',
      'Mozilla/5.0'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0]!.field_id).toBe('field-name');
    }
  });

  // Req 11.1, 11.3: Successful submission returns folio
  it('creates response and returns folio on valid submission', async () => {
    // First call: query form by token
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    // Second call: PutCommand for FormResponse
    mockSend.mockResolvedValueOnce({});

    const result = await submitFormResponse(
      'pub-token-1',
      { answers: { 'field-name': 'Juan Pérez', 'field-age': 30 } },
      '192.168.1.1',
      'Mozilla/5.0',
      'https://example.com/forms/pub-token-1'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      // Folio is 8 alphanumeric characters
      expect(result.folio).toMatch(/^[A-Z0-9]{8}$/);
      // Response ID is a UUID
      expect(result.response_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    }
  });

  // Req 11.6, 16.3: Audit entry logged with response_id as actor
  it('logs audit entry with response_id as actor_id', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    mockSend.mockResolvedValueOnce({});

    const result = await submitFormResponse(
      'pub-token-1',
      { answers: { 'field-name': 'María' } },
      '10.0.0.1',
      'Chrome/120'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(mockLogAuditEntry).toHaveBeenCalledTimes(1);
      const auditCall = mockLogAuditEntry.mock.calls[0]![0];
      expect(auditCall.action).toBe('respuesta_enviada');
      expect(auditCall.actor_id).toBe(result.response_id);
      expect(auditCall.entity_id).toBe(result.response_id);
      expect(auditCall.entity_type).toBe('respuesta');
      expect(auditCall.ip_address).toBe('10.0.0.1');
      expect(auditCall.form_id).toBe('form-pub-1');
      expect(auditCall.tenant_id).toBe('tenant-1');
    }
  });

  // Req 11.2: Metadata includes origin_type, user_agent, ip_address
  it('stores metadata with origin_type, user_agent, and ip_address', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    mockSend.mockResolvedValueOnce({});

    await submitFormResponse(
      'pub-token-1',
      { answers: { 'field-name': 'Carlos' } },
      '172.16.0.1',
      'Safari/17.0',
      'https://example.com/forms/pub-token-1'
    );

    // Verify PutCommand was called with correct metadata
    const putCall = mockSend.mock.calls[1]![0];
    const item = putCall.input.Item;
    expect(item.metadata.ip_address).toBe('172.16.0.1');
    expect(item.metadata.user_agent).toBe('Safari/17.0');
    expect(item.metadata.origin_type).toBe('url_directa');
  });

  // Req 11.2: user_agent truncated to 500 chars
  it('truncates user_agent to 500 characters', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    mockSend.mockResolvedValueOnce({});

    const longUserAgent = 'A'.repeat(600);

    await submitFormResponse(
      'pub-token-1',
      { answers: { 'field-name': 'Test' } },
      '192.168.1.1',
      longUserAgent
    );

    const putCall = mockSend.mock.calls[1]![0];
    const item = putCall.input.Item;
    expect(item.metadata.user_agent.length).toBe(500);
  });

  // Req 11.1: version_number from form's current_version
  it('uses form current_version as version_number in response', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    mockSend.mockResolvedValueOnce({});

    await submitFormResponse(
      'pub-token-1',
      { answers: { 'field-name': 'Test' } },
      '192.168.1.1',
      'Mozilla/5.0'
    );

    const putCall = mockSend.mock.calls[1]![0];
    const item = putCall.input.Item;
    expect(item.version_number).toBe(2); // publishedForm.current_version = 2
  });

  // DynamoDB key structure
  it('writes response with correct PK/SK and GSI1 keys', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    mockSend.mockResolvedValueOnce({});

    const result = await submitFormResponse(
      'pub-token-1',
      { answers: { 'field-name': 'Test' } },
      '192.168.1.1',
      'Mozilla/5.0'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      const putCall = mockSend.mock.calls[1]![0];
      const item = putCall.input.Item;
      expect(item.PK).toBe('FORM#form-pub-1');
      expect(item.SK).toBe(`RESPONSE#${result.response_id}`);
      expect(item.GSI1PK).toBe('FORM#form-pub-1');
      expect(item.GSI1SK).toMatch(/^DATE#\d{4}-\d{2}-\d{2}T/);
    }
  });

  // Origin type detection: no referer → QR
  it('detects origin_type as "qr" when no referer is provided', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    mockSend.mockResolvedValueOnce({});

    await submitFormResponse(
      'pub-token-1',
      { answers: { 'field-name': 'Test' } },
      '192.168.1.1',
      'Mozilla/5.0',
      '' // empty referer = QR scan
    );

    const putCall = mockSend.mock.calls[1]![0];
    const item = putCall.input.Item;
    expect(item.metadata.origin_type).toBe('qr');
  });
});

describe('generateFolio', () => {
  it('generates an 8-character alphanumeric string', () => {
    const folio = generateFolio();
    expect(folio).toHaveLength(8);
    expect(folio).toMatch(/^[A-Z0-9]{8}$/);
  });

  it('generates different folios on successive calls', () => {
    const folios = new Set<string>();
    for (let i = 0; i < 100; i++) {
      folios.add(generateFolio());
    }
    // With 36^8 possible values, 100 calls should produce 100 unique folios
    expect(folios.size).toBe(100);
  });
});
