// Feature: contractor-forms-qr, Property 9: Acceso público denegado para formularios no publicados
// Feature: contractor-forms-qr, Property 13: Acceso público retorna esquema completo
// Feature: contractor-forms-qr, Property 14: Endpoints públicos no requieren autenticación

/**
 * Property-based tests for public form access.
 *
 * Property 9: For any form in "borrador" or "despublicado" state, public URL access
 * must be denied without revealing the form content.
 *
 * Property 13: For any published form, accessing via GET /public/forms/{token} must
 * return: name, description (if exists), and all fields in display order with their
 * rendering properties (type, label, required, placeholder, help_text, options).
 *
 * Property 14: For any request to /public/forms/{token} and /public/forms/{token}/responses,
 * the system must process the request without requiring an Authorization header.
 *
 * **Validates: Requirements 3.2, 7.3, 9.1, 9.6**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { FormStatus, FieldType } from '../../src/services/forms/types.js';
import type { Form, FieldConfig, FieldOption } from '../../src/services/forms/types.js';

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid UUID v4 tokens */
const arbToken = fc.uuid();

/** Arbitrary for valid form names (3-200 chars with at least one non-space) */
const arbValidName = fc
  .string({ minLength: 3, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for optional descriptions (max 1000 chars) */
const arbDescription = fc.option(
  fc.string({ minLength: 1, maxLength: 200 }),
  { nil: undefined },
);

/** Arbitrary for valid labels (1-200 chars) */
const arbValidLabel = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.length >= 1);

/** Arbitrary for valid option */
const arbValidOption: fc.Arbitrary<FieldOption> = fc.record({
  option_id: fc.uuid(),
  label: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.length >= 1),
});

/** Arbitrary for valid options array (2-10 options) */
const arbValidOptions = fc.array(arbValidOption, { minLength: 2, maxLength: 10 });

/** Non-selection field types */
const NON_SELECTION_TYPES = [
  FieldType.TEXTO_CORTO,
  FieldType.TEXTO_LARGO,
  FieldType.NUMERO,
  FieldType.FECHA,
  FieldType.CHECKBOX_ACEPTACION,
  FieldType.CARGA_ARCHIVO,
];

/** Arbitrary for optional placeholder (max 200 chars) */
const arbPlaceholder = fc.option(
  fc.string({ minLength: 1, maxLength: 100 }),
  { nil: undefined },
);

/** Arbitrary for optional help_text (max 500 chars) */
const arbHelpText = fc.option(
  fc.string({ minLength: 1, maxLength: 100 }),
  { nil: undefined },
);

/** Arbitrary for a valid non-selection field with optional properties */
const arbValidNonSelectionField: fc.Arbitrary<FieldConfig> = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom(...NON_SELECTION_TYPES),
    arbValidLabel,
    fc.boolean(),
    fc.integer({ min: 1, max: 50 }),
    arbPlaceholder,
    arbHelpText,
  )
  .map(([field_id, type, label, required, order, placeholder, help_text]) => {
    const field: FieldConfig = { field_id, type, label, required, order };
    if (placeholder !== undefined) field.placeholder = placeholder;
    if (help_text !== undefined) field.help_text = help_text;
    return field;
  });

/** Arbitrary for a valid selection field with options */
const arbValidSelectionField: fc.Arbitrary<FieldConfig> = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom(FieldType.SELECCION_SIMPLE, FieldType.SELECCION_MULTIPLE),
    arbValidLabel,
    fc.boolean(),
    fc.integer({ min: 1, max: 50 }),
    arbValidOptions,
    arbPlaceholder,
    arbHelpText,
  )
  .map(([field_id, type, label, required, order, options, placeholder, help_text]) => {
    const field: FieldConfig = { field_id, type, label, required, order, options };
    if (placeholder !== undefined) field.placeholder = placeholder;
    if (help_text !== undefined) field.help_text = help_text;
    return field;
  });

/** Arbitrary for any valid field */
const arbValidField = fc.oneof(arbValidNonSelectionField, arbValidSelectionField);

/** Arbitrary for a valid fields array (1-10 fields) with unique consecutive orders */
const arbValidFieldsArray = fc
  .array(arbValidField, { minLength: 1, maxLength: 10 })
  .map((fields) =>
    fields.map((f, i) => ({ ...f, order: i + 1 })),
  );

/** Arbitrary for form IDs */
const arbFormId = fc.uuid();

/** Arbitrary for tenant IDs */
const arbTenantId = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 3, maxLength: 36 },
).map((id) => `tenant-${id}`);

/** Helper to build a Form object */
function buildForm(overrides: Partial<Form>): Form {
  return {
    form_id: 'form-123',
    tenant_id: 'tenant-1',
    name: 'Test Form',
    status: FormStatus.BORRADOR,
    fields: [],
    author_id: 'user-1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Forms Public Access Property Tests', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 3.2, 7.3**
  describe('Property 9: Acceso público denegado para formularios no publicados', () => {
    it('returns 404 for forms in "borrador" state without revealing content', () => {
      fc.assert(
        fc.asyncProperty(
          arbToken,
          arbFormId,
          arbTenantId,
          arbValidName,
          arbValidFieldsArray,
          async (token, formId, tenantId, name, fields) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Mock: GSI1 query returns a form in borrador state
            const borradorForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              name,
              status: FormStatus.BORRADOR,
              fields,
              token_publico: token,
            });

            mockSend.mockResolvedValueOnce({ Items: [borradorForm] });

            const { getPublicForm } = await import('../../src/services/forms/form-response.js');

            const result = await getPublicForm(token);

            // Must be denied
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(404);
              expect(result.code).toBe('NOT_FOUND');
              // Must NOT reveal form content (name, fields, etc.)
              expect(result.message).not.toContain(name);
              expect(JSON.stringify(result)).not.toContain('"fields"');
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns 410 for forms in "despublicado" state without revealing content', () => {
      fc.assert(
        fc.asyncProperty(
          arbToken,
          arbFormId,
          arbTenantId,
          arbValidName,
          arbValidFieldsArray,
          async (token, formId, tenantId, name, fields) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Mock: GSI1 query returns a form in despublicado state
            const despublicadoForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              name,
              status: FormStatus.DESPUBLICADO,
              fields,
              token_publico: token,
            });

            mockSend.mockResolvedValueOnce({ Items: [despublicadoForm] });

            const { getPublicForm } = await import('../../src/services/forms/form-response.js');

            const result = await getPublicForm(token);

            // Must be denied with 410 Gone
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(410);
              expect(result.code).toBe('GONE');
              // Must NOT reveal form content
              expect(result.message).not.toContain(name);
              expect(JSON.stringify(result)).not.toContain('"fields"');
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns 404 for non-existent tokens', () => {
      fc.assert(
        fc.asyncProperty(
          arbToken,
          async (token) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Mock: GSI1 query returns no items
            mockSend.mockResolvedValueOnce({ Items: [] });

            const { getPublicForm } = await import('../../src/services/forms/form-response.js');

            const result = await getPublicForm(token);

            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(404);
              expect(result.code).toBe('NOT_FOUND');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 9.1**
  describe('Property 13: Acceso público retorna esquema completo', () => {
    it('returns name, description, and all fields in display order with rendering properties', () => {
      fc.assert(
        fc.asyncProperty(
          arbToken,
          arbFormId,
          arbTenantId,
          arbValidName,
          arbDescription,
          arbValidFieldsArray,
          async (token, formId, tenantId, name, description, fields) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Mock: GSI1 query returns a published form
            const publishedForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              name,
              description,
              status: FormStatus.PUBLICADO,
              fields,
              token_publico: token,
              published_at: '2024-06-01T00:00:00.000Z',
              current_version: 1,
            });

            mockSend.mockResolvedValueOnce({ Items: [publishedForm] });

            const { getPublicForm } = await import('../../src/services/forms/form-response.js');

            const result = await getPublicForm(token);

            // Must succeed
            expect(result.success).toBe(true);
            if (result.success) {
              const schema = result.form;

              // Must return name
              expect(schema.name).toBe(name);

              // Must return description if it exists
              if (description) {
                expect(schema.description).toBe(description);
              } else {
                expect(schema.description).toBeUndefined();
              }

              // Must return all fields
              expect(schema.fields).toHaveLength(fields.length);

              // Fields must be sorted by order
              for (let i = 1; i < schema.fields.length; i++) {
                expect(schema.fields[i].order).toBeGreaterThanOrEqual(schema.fields[i - 1].order);
              }

              // Each field must have rendering properties
              for (const field of schema.fields) {
                expect(field.field_id).toBeDefined();
                expect(field.type).toBeDefined();
                expect(field.label).toBeDefined();
                expect(typeof field.required).toBe('boolean');
                expect(typeof field.order).toBe('number');
              }

              // Verify field properties match the original
              const sortedOriginalFields = [...fields].sort((a, b) => a.order - b.order);
              for (let i = 0; i < schema.fields.length; i++) {
                const returnedField = schema.fields[i];
                const originalField = sortedOriginalFields[i];

                expect(returnedField.field_id).toBe(originalField.field_id);
                expect(returnedField.type).toBe(originalField.type);
                expect(returnedField.label).toBe(originalField.label);
                expect(returnedField.required).toBe(originalField.required);
                expect(returnedField.order).toBe(originalField.order);

                // Optional rendering properties
                if (originalField.placeholder) {
                  expect(returnedField.placeholder).toBe(originalField.placeholder);
                }
                if (originalField.help_text) {
                  expect(returnedField.help_text).toBe(originalField.help_text);
                }
                if (originalField.options && originalField.options.length > 0) {
                  expect(returnedField.options).toBeDefined();
                  expect(returnedField.options).toHaveLength(originalField.options.length);
                  for (let j = 0; j < originalField.options.length; j++) {
                    expect(returnedField.options![j].option_id).toBe(originalField.options[j].option_id);
                    expect(returnedField.options![j].label).toBe(originalField.options[j].label);
                  }
                }
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns fields with validation rules when configured', () => {
      fc.assert(
        fc.asyncProperty(
          arbToken,
          arbFormId,
          arbTenantId,
          arbValidName,
          fc.integer({ min: 1, max: 100 }),
          fc.integer({ min: 101, max: 999 }),
          async (token, formId, tenantId, name, minVal, maxVal) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Create a form with a numeric field that has validation
            const fields: FieldConfig[] = [
              {
                field_id: 'field-num-1',
                type: FieldType.NUMERO,
                label: 'Numeric Field',
                required: true,
                order: 1,
                validation: {
                  min_value: minVal,
                  max_value: maxVal,
                },
              },
            ];

            const publishedForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              name,
              status: FormStatus.PUBLICADO,
              fields,
              token_publico: token,
              published_at: '2024-06-01T00:00:00.000Z',
              current_version: 1,
            });

            mockSend.mockResolvedValueOnce({ Items: [publishedForm] });

            const { getPublicForm } = await import('../../src/services/forms/form-response.js');

            const result = await getPublicForm(token);

            expect(result.success).toBe(true);
            if (result.success) {
              const field = result.form.fields[0];
              expect(field.validation).toBeDefined();
              expect(field.validation!.min_value).toBe(minVal);
              expect(field.validation!.max_value).toBe(maxVal);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 9.6**
  describe('Property 14: Endpoints públicos no requieren autenticación', () => {
    it('getPublicForm processes requests without any auth context', () => {
      fc.assert(
        fc.asyncProperty(
          arbToken,
          arbFormId,
          arbTenantId,
          arbValidName,
          arbValidFieldsArray,
          async (token, formId, tenantId, name, fields) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Mock: published form exists
            const publishedForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              name,
              status: FormStatus.PUBLICADO,
              fields,
              token_publico: token,
              published_at: '2024-06-01T00:00:00.000Z',
              current_version: 1,
            });

            mockSend.mockResolvedValueOnce({ Items: [publishedForm] });

            const { getPublicForm } = await import('../../src/services/forms/form-response.js');

            // Call getPublicForm with ONLY a token — no user, no auth header, no session
            const result = await getPublicForm(token);

            // Must succeed without any auth context
            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.form.name).toBe(name);
              expect(result.form.fields).toHaveLength(fields.length);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('handler routes public endpoints without calling authenticateRequest', () => {
      fc.assert(
        fc.asyncProperty(
          arbToken,
          arbFormId,
          arbTenantId,
          arbValidName,
          arbValidFieldsArray,
          async (token, formId, tenantId, name, fields) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Mock authenticateRequest to track if it's called
            const mockAuthenticateRequest = vi.fn();
            vi.doMock('../../src/shared/auth-middleware.js', () => ({
              authenticateRequest: mockAuthenticateRequest,
            }));

            // Mock enforcePermission
            vi.doMock('../../src/shared/rbac.js', () => ({
              enforcePermission: vi.fn(),
            }));

            // Mock error-handler
            vi.doMock('../../src/shared/error-handler.js', () => ({
              createSuccessResponse: vi.fn((status: number, body: unknown) => ({
                statusCode: status,
                body: JSON.stringify(body),
                headers: {},
              })),
              createErrorResponse: vi.fn((status: number, code: string, message: string) => ({
                statusCode: status,
                body: JSON.stringify({ code, message }),
                headers: {},
              })),
              badRequest: vi.fn((msg: string) => ({
                statusCode: 400,
                body: JSON.stringify({ message: msg }),
                headers: {},
              })),
              notFound: vi.fn((msg: string) => ({
                statusCode: 404,
                body: JSON.stringify({ message: msg }),
                headers: {},
              })),
              conflict: vi.fn((msg: string) => ({
                statusCode: 409,
                body: JSON.stringify({ message: msg }),
                headers: {},
              })),
              internalError: vi.fn((msg: string) => ({
                statusCode: 500,
                body: JSON.stringify({ message: msg }),
                headers: {},
              })),
            }));

            // Mock form-response module
            vi.doMock('../../src/services/forms/form-response.js', () => ({
              getPublicForm: vi.fn().mockResolvedValue({
                success: true,
                form: { name, fields: fields.map((f) => ({ ...f })) },
              }),
            }));

            // Mock form module
            vi.doMock('../../src/services/forms/form.js', () => ({
              createForm: vi.fn(),
              createFormSchema: { safeParse: vi.fn() },
              getForm: vi.fn(),
              listForms: vi.fn(),
              updateForm: vi.fn(),
              duplicateForm: vi.fn(),
              unpublishForm: vi.fn(),
              publishForm: vi.fn(),
            }));

            const { handler } = await import('../../src/services/forms/handler.js');

            // Simulate a public GET request with NO Authorization header
            const event = {
              httpMethod: 'GET',
              resource: '/public/forms/{token}',
              pathParameters: { token },
              headers: {}, // No Authorization header
              body: null,
            };

            const response = await handler(event as any);

            // authenticateRequest must NOT have been called for public routes
            expect(mockAuthenticateRequest).not.toHaveBeenCalled();

            // The request must be processed successfully
            expect(response.statusCode).toBe(200);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
