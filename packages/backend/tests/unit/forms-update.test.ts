/**
 * Unit tests for the Form Update (PATCH /forms/{id}) endpoint.
 * Tests validation, state checks, field constraints, persistence, and audit logging.
 *
 * Requirements: 2.1-2.9, 3.1, 3.3-3.5, 4.2-4.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FieldType, FormStatus } from '../../src/services/forms/types.js';
import type { FieldConfig, Form } from '../../src/services/forms/types.js';

// ─── Mock DynamoDB ────────────────────────────────────────────────────────────

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => params),
    GetCommand: vi.fn().mockImplementation((params) => params),
    UpdateCommand: vi.fn().mockImplementation((params) => params),
    QueryCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

// ─── Helper: Create a valid draft form ────────────────────────────────────────

function createDraftForm(overrides: Partial<Form> = {}): Form {
  return {
    form_id: 'form-123',
    tenant_id: 'tenant-abc',
    name: 'Test Form',
    description: 'A test form',
    status: FormStatus.BORRADOR,
    fields: [],
    author_id: 'user-001',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createValidField(overrides: Partial<FieldConfig> = {}): FieldConfig {
  return {
    field_id: 'field-1',
    type: FieldType.TEXTO_CORTO,
    label: 'Nombre completo',
    required: true,
    order: 1,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('forms: updateForm', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  it('returns 404 when form does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: null }); // GetCommand returns nothing

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'nonexistent-form',
      { name: 'New Name' },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.code).toBe('NOT_FOUND');
    }
  });

  it('returns 422 when form is not in borrador state', async () => {
    const publishedForm = createDraftForm({ status: FormStatus.PUBLICADO });
    mockSend.mockResolvedValueOnce({ Item: publishedForm });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { name: 'New Name' },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(422);
      expect(result.code).toBe('UNPROCESSABLE_ENTITY');
      expect(result.message).toContain('borrador');
    }
  });

  it('validates name: rejects names shorter than 3 characters', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { name: 'ab' },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some((e) => e.field === 'name')).toBe(true);
    }
  });

  it('validates name: rejects names longer than 200 characters', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { name: 'a'.repeat(201) },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.field === 'name')).toBe(true);
    }
  });

  it('validates name: rejects names with only spaces', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { name: '     ' },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.message.includes('no-espacio'))).toBe(true);
    }
  });

  it('validates description: rejects descriptions longer than 1000 characters', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { description: 'x'.repeat(1001) },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.field === 'description')).toBe(true);
    }
  });

  it('validates fields: rejects more than 50 fields', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields: FieldConfig[] = Array.from({ length: 51 }, (_, i) =>
      createValidField({ field_id: `field-${i}`, order: i + 1, label: `Field ${i}` })
    );

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.field === 'fields' && e.message.includes('50'))).toBe(true);
    }
  });

  it('validates fields: rejects empty label', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields = [createValidField({ label: '' })];

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.message.includes('etiqueta'))).toBe(true);
    }
  });

  it('validates fields: rejects label longer than 200 chars', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields = [createValidField({ label: 'x'.repeat(201) })];

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.message.includes('200'))).toBe(true);
    }
  });

  it('validates fields: rejects invalid field type', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields = [createValidField({ type: 'invalid_type' as FieldType })];

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.message.includes('Tipo de campo inválido'))).toBe(true);
    }
  });

  it('validates fields: selection fields require 2-50 options', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields = [
      createValidField({
        type: FieldType.SELECCION_SIMPLE,
        options: [{ option_id: 'opt-1', label: 'Only one' }],
      }),
    ];

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.message.includes('2 y 50'))).toBe(true);
    }
  });

  it('validates fields: selection option labels must be 1-200 chars', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields = [
      createValidField({
        type: FieldType.SELECCION_MULTIPLE,
        options: [
          { option_id: 'opt-1', label: 'Valid' },
          { option_id: 'opt-2', label: 'x'.repeat(201) },
        ],
      }),
    ];

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.message.includes('opción') && e.message.includes('200'))).toBe(true);
    }
  });

  it('validates fields: numeric validation range [-999999999, 999999999]', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields = [
      createValidField({
        type: FieldType.NUMERO,
        validation: { min_value: -1000000000 },
      }),
    ];

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.field.includes('min_value'))).toBe(true);
    }
  });

  it('validates fields: text validation max_length cannot exceed 10000', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields = [
      createValidField({
        type: FieldType.TEXTO_LARGO,
        validation: { max_length: 10001 },
      }),
    ];

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.field.includes('max_length'))).toBe(true);
    }
  });

  it('validates fields: text validation min_length must be >= 0', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields = [
      createValidField({
        type: FieldType.TEXTO_CORTO,
        validation: { min_length: -1 },
      }),
    ];

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.errors!.some((e) => e.field.includes('min_length'))).toBe(true);
    }
  });

  it('returns all validation errors simultaneously (not fail-fast)', async () => {
    const form = createDraftForm();
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      {
        name: 'ab', // too short
        description: 'x'.repeat(1001), // too long
        fields: [
          createValidField({ label: '' }), // empty label
        ],
      },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      // Should have errors for name, description, AND field label
      expect(result.errors!.length).toBeGreaterThanOrEqual(3);
      expect(result.errors!.some((e) => e.field === 'name')).toBe(true);
      expect(result.errors!.some((e) => e.field === 'description')).toBe(true);
      expect(result.errors!.some((e) => e.field.startsWith('fields'))).toBe(true);
    }
  });

  it('normalizes field order to consecutive values 1..N', async () => {
    const form = createDraftForm();
    mockSend
      .mockResolvedValueOnce({ Item: form }) // GetCommand
      .mockResolvedValueOnce({ Attributes: { ...form, fields: [], updated_at: '2024-06-01T00:00:00.000Z' } }) // UpdateCommand
      .mockResolvedValueOnce({}); // PutCommand (audit)

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields = [
      createValidField({ field_id: 'f1', order: 5, label: 'Field A' }),
      createValidField({ field_id: 'f2', order: 2, label: 'Field B' }),
      createValidField({ field_id: 'f3', order: 10, label: 'Field C' }),
    ];

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(true);

    // Verify the UpdateCommand was called with normalized order
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const updateCall = (UpdateCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const updatedFields = updateCall.ExpressionAttributeValues[':fields'];

    expect(updatedFields[0].order).toBe(1);
    expect(updatedFields[1].order).toBe(2);
    expect(updatedFields[2].order).toBe(3);

    // Fields should be sorted by original order
    expect(updatedFields[0].field_id).toBe('f2'); // was order 2
    expect(updatedFields[1].field_id).toBe('f1'); // was order 5
    expect(updatedFields[2].field_id).toBe('f3'); // was order 10
  });

  it('persists changes and updates updated_at', async () => {
    const form = createDraftForm();
    const updatedForm = { ...form, name: 'Updated Name', updated_at: '2024-06-01T12:00:00.000Z' };
    mockSend
      .mockResolvedValueOnce({ Item: form }) // GetCommand
      .mockResolvedValueOnce({ Attributes: updatedForm }) // UpdateCommand
      .mockResolvedValueOnce({}); // PutCommand (audit)

    const { updateForm } = await import('../../src/services/forms/form.js');

    const before = new Date().toISOString();
    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { name: 'Updated Name' },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.form.name).toBe('Updated Name');
    }

    // Verify UpdateCommand was called with updated_at
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
    const updateCall = (UpdateCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const updatedAt = updateCall.ExpressionAttributeValues[':updated_at'];
    expect(updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(updatedAt >= before).toBe(true);
  });

  it('logs audit entry "formulario_editado" on success', async () => {
    const form = createDraftForm();
    const updatedForm = { ...form, name: 'New Name', updated_at: '2024-06-01T12:00:00.000Z' };
    mockSend
      .mockResolvedValueOnce({ Item: form }) // GetCommand
      .mockResolvedValueOnce({ Attributes: updatedForm }) // UpdateCommand
      .mockResolvedValueOnce({}); // PutCommand (audit)

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { name: 'New Name' },
      'user-001',
      '10.0.0.1'
    );

    expect(result.success).toBe(true);

    // Verify audit PutCommand was called
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const putCalls = (PutCommand as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const auditCall = putCalls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>).TableName === 'dev-FormAuditLog'
    );
    expect(auditCall).toBeDefined();
    const auditItem = (auditCall![0] as Record<string, unknown>).Item as Record<string, unknown>;
    expect(auditItem['action']).toBe('formulario_editado');
    expect(auditItem['actor_id']).toBe('user-001');
    expect(auditItem['entity_id']).toBe('form-123');
    expect(auditItem['ip_address']).toBe('10.0.0.1');
  });

  it('allows saving a form with no fields (empty array)', async () => {
    const form = createDraftForm();
    const updatedForm = { ...form, fields: [], updated_at: '2024-06-01T12:00:00.000Z' };
    mockSend
      .mockResolvedValueOnce({ Item: form }) // GetCommand
      .mockResolvedValueOnce({ Attributes: updatedForm }) // UpdateCommand
      .mockResolvedValueOnce({}); // PutCommand (audit)

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields: [] },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(true);
  });

  it('accepts valid name at boundary (3 chars)', async () => {
    const form = createDraftForm();
    const updatedForm = { ...form, name: 'abc', updated_at: '2024-06-01T12:00:00.000Z' };
    mockSend
      .mockResolvedValueOnce({ Item: form }) // GetCommand
      .mockResolvedValueOnce({ Attributes: updatedForm }) // UpdateCommand
      .mockResolvedValueOnce({}); // PutCommand (audit)

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { name: 'abc' },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(true);
  });

  it('accepts valid name at boundary (200 chars)', async () => {
    const form = createDraftForm();
    const longName = 'a'.repeat(200);
    const updatedForm = { ...form, name: longName, updated_at: '2024-06-01T12:00:00.000Z' };
    mockSend
      .mockResolvedValueOnce({ Item: form }) // GetCommand
      .mockResolvedValueOnce({ Attributes: updatedForm }) // UpdateCommand
      .mockResolvedValueOnce({}); // PutCommand (audit)

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { name: longName },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(true);
  });

  it('accepts exactly 50 fields', async () => {
    const form = createDraftForm();
    mockSend
      .mockResolvedValueOnce({ Item: form }) // GetCommand
      .mockResolvedValueOnce({ Attributes: { ...form, updated_at: '2024-06-01T12:00:00.000Z' } }) // UpdateCommand
      .mockResolvedValueOnce({}); // PutCommand (audit)

    const { updateForm } = await import('../../src/services/forms/form.js');

    const fields: FieldConfig[] = Array.from({ length: 50 }, (_, i) =>
      createValidField({ field_id: `field-${i}`, order: i + 1, label: `Field ${i + 1}` })
    );

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { fields },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(true);
  });

  it('rejects despublicado form state', async () => {
    const form = createDraftForm({ status: FormStatus.DESPUBLICADO });
    mockSend.mockResolvedValueOnce({ Item: form });

    const { updateForm } = await import('../../src/services/forms/form.js');

    const result = await updateForm(
      'tenant-abc',
      'form-123',
      { name: 'New Name' },
      'user-001',
      '192.168.1.1'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(422);
    }
  });
});

// ─── Validation Function Unit Tests ───────────────────────────────────────────

describe('forms: validateName', () => {
  beforeEach(() => {
    vi.resetModules();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  it('returns no errors for valid name', async () => {
    const { validateName } = await import('../../src/services/forms/form.js');
    expect(validateName('Valid Form Name')).toEqual([]);
  });

  it('returns error for name with only spaces', async () => {
    const { validateName } = await import('../../src/services/forms/form.js');
    const errors = validateName('      ');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes('no-espacio'))).toBe(true);
  });
});

describe('forms: validateFields', () => {
  beforeEach(() => {
    vi.resetModules();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  it('returns no errors for valid fields', async () => {
    const { validateFields } = await import('../../src/services/forms/form.js');
    const fields: FieldConfig[] = [
      createValidField(),
      createValidField({
        field_id: 'f2',
        type: FieldType.SELECCION_SIMPLE,
        label: 'Selección',
        order: 2,
        options: [
          { option_id: 'o1', label: 'Opción 1' },
          { option_id: 'o2', label: 'Opción 2' },
        ],
      }),
    ];
    expect(validateFields(fields)).toEqual([]);
  });

  it('validates all fields and returns all errors', async () => {
    const { validateFields } = await import('../../src/services/forms/form.js');
    const fields: FieldConfig[] = [
      createValidField({ label: '' }), // invalid label
      createValidField({
        field_id: 'f2',
        type: FieldType.SELECCION_SIMPLE,
        label: 'Select',
        order: 2,
        options: [], // too few options
      }),
    ];
    const errors = validateFields(fields);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('forms: normalizeFieldOrder', () => {
  beforeEach(() => {
    vi.resetModules();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  it('normalizes non-consecutive order values to 1..N', async () => {
    const { normalizeFieldOrder } = await import('../../src/services/forms/form.js');
    const fields: FieldConfig[] = [
      createValidField({ field_id: 'a', order: 10 }),
      createValidField({ field_id: 'b', order: 3 }),
      createValidField({ field_id: 'c', order: 7 }),
    ];
    const result = normalizeFieldOrder(fields);
    expect(result[0]!.field_id).toBe('b');
    expect(result[0]!.order).toBe(1);
    expect(result[1]!.field_id).toBe('c');
    expect(result[1]!.order).toBe(2);
    expect(result[2]!.field_id).toBe('a');
    expect(result[2]!.order).toBe(3);
  });

  it('handles empty array', async () => {
    const { normalizeFieldOrder } = await import('../../src/services/forms/form.js');
    expect(normalizeFieldOrder([])).toEqual([]);
  });

  it('handles single field', async () => {
    const { normalizeFieldOrder } = await import('../../src/services/forms/form.js');
    const fields = [createValidField({ order: 5 })];
    const result = normalizeFieldOrder(fields);
    expect(result[0]!.order).toBe(1);
  });
});
