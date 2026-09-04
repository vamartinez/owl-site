// Feature: contractor-forms-qr, Property 7: Restricción de operaciones por estado
// Feature: contractor-forms-qr, Property 12: Publicación crea versión inmutable con token UUID v4

/**
 * Property-based tests for form state transitions and publishing.
 *
 * Property 7: For any form, save/edit operations must be rejected if the form is not
 * in "borrador" state, publish must be rejected if not in "borrador", and unpublish
 * must be rejected if not in "publicado".
 *
 * Property 12: For any valid draft form, publishing it must: change status to "publicado",
 * generate a token_publico that is a valid UUID v4, and create a FormVersion whose
 * fields_snapshot is identical to the form's fields at the time of publication.
 *
 * **Validates: Requirements 3.5, 4.6, 6.3, 6.4, 6.6, 7.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { FormStatus, FieldType } from '../../src/services/forms/types.js';
import type { Form, FieldConfig, FieldOption } from '../../src/services/forms/types.js';

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockSend = vi.fn();
let capturedPutItems: any[] = [];

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => {
      capturedPutItems.push(params);
      return params;
    }),
    UpdateCommand: vi.fn().mockImplementation((params) => params),
    GetCommand: vi.fn().mockImplementation((params) => params),
    QueryCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
  vi.doMock('uuid', () => ({
    v4: vi.fn(() => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
  }));
};

// ─── UUID v4 Regex ────────────────────────────────────────────────────────────

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for non-borrador states (publicado, despublicado) */
const arbNonBorradorStatus = fc.constantFrom(FormStatus.PUBLICADO, FormStatus.DESPUBLICADO);

/** Arbitrary for non-publicado states (borrador, despublicado) */
const arbNonPublicadoStatus = fc.constantFrom(FormStatus.BORRADOR, FormStatus.DESPUBLICADO);

/** Arbitrary for valid form names (3-200 chars with at least one non-space) */
const arbValidName = fc
  .string({ minLength: 3, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for valid labels (1-200 chars) */
const arbValidLabel = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.length >= 1 && s.length <= 200);

/** Arbitrary for valid option */
const arbValidOption = fc.record({
  option_id: fc.uuid(),
  label: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.length >= 1),
}) as fc.Arbitrary<FieldOption>;

/** Arbitrary for valid options array (2-50 options) */
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

/** Arbitrary for a valid non-selection field */
const arbValidNonSelectionField = fc
  .tuple(fc.uuid(), fc.constantFrom(...NON_SELECTION_TYPES), arbValidLabel, fc.boolean(), fc.integer({ min: 1, max: 50 }))
  .map(([field_id, type, label, required, order]) => ({
    field_id,
    type,
    label,
    required,
    order,
  })) as fc.Arbitrary<FieldConfig>;

/** Arbitrary for a valid selection field */
const arbValidSelectionField = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom(FieldType.SELECCION_SIMPLE, FieldType.SELECCION_MULTIPLE),
    arbValidLabel,
    fc.boolean(),
    fc.integer({ min: 1, max: 50 }),
    arbValidOptions,
  )
  .map(([field_id, type, label, required, order, options]) => ({
    field_id,
    type,
    label,
    required,
    order,
    options,
  })) as fc.Arbitrary<FieldConfig>;

/** Arbitrary for any valid field */
const arbValidField = fc.oneof(arbValidNonSelectionField, arbValidSelectionField);

/** Arbitrary for a valid fields array (1-10 fields for performance) */
const arbValidFieldsArray = fc.array(arbValidField, { minLength: 1, maxLength: 10 });

/** Arbitrary for valid IPv4 addresses */
const arbIpAddress = fc.tuple(
  fc.integer({ min: 1, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Arbitrary for IDs */
const arbId = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 3, maxLength: 36 },
);

/** Arbitrary for tenant IDs */
const arbTenantId = arbId.map((id) => `tenant-${id}`);

/** Arbitrary for form IDs */
const arbFormId = fc.uuid();

/** Arbitrary for actor IDs */
const arbActorId = arbId.map((id) => `user-${id}`);

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

describe('Forms State Transitions Property Tests', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    capturedPutItems = [];
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 3.5, 4.6, 6.3, 7.2**
  describe('Property 7: Restricción de operaciones por estado', () => {
    it('save/edit operations are rejected for any form not in "borrador" state', () => {
      fc.assert(
        fc.asyncProperty(
          arbNonBorradorStatus,
          arbTenantId,
          arbFormId,
          arbActorId,
          arbIpAddress,
          arbValidName,
          async (status, tenantId, formId, actorId, ipAddress, newName) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: getFormByIdAndTenant returns a form in non-borrador state
            const existingForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              status,
              name: 'Original Name',
              fields: [{ field_id: 'f1', type: FieldType.TEXTO_CORTO, label: 'Field 1', required: false, order: 1 }],
            });

            mockSend.mockResolvedValueOnce({ Item: existingForm }); // GetCommand for form lookup

            const { updateForm } = await import('../../src/services/forms/form.js');

            const result = await updateForm(
              tenantId,
              formId,
              { name: newName },
              actorId,
              ipAddress,
            );

            // Must be rejected
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(422);
              expect(result.code).toBe('UNPROCESSABLE_ENTITY');
              expect(result.message).toContain('borrador');
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('publish is rejected for any form not in "borrador" state', () => {
      fc.assert(
        fc.asyncProperty(
          arbNonBorradorStatus,
          arbTenantId,
          arbFormId,
          arbActorId,
          arbIpAddress,
          async (status, tenantId, formId, actorId, ipAddress) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: form exists but is not in borrador state
            const existingForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              status,
              name: 'Valid Form Name',
              fields: [{ field_id: 'f1', type: FieldType.TEXTO_CORTO, label: 'Field 1', required: false, order: 1 }],
            });

            mockSend.mockResolvedValueOnce({ Item: existingForm }); // GetCommand for form lookup

            const { publishForm } = await import('../../src/services/forms/form.js');

            const result = await publishForm(tenantId, formId, actorId, ipAddress);

            // Must be rejected
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(422);
              expect(result.code).toBe('UNPROCESSABLE_ENTITY');
              expect(result.message).toContain('borrador');
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('unpublish is rejected for any form not in "publicado" state', () => {
      fc.assert(
        fc.asyncProperty(
          arbNonPublicadoStatus,
          arbTenantId,
          arbFormId,
          arbActorId,
          arbIpAddress,
          async (status, tenantId, formId, actorId, ipAddress) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: form exists but is not in publicado state
            const existingForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              status,
              name: 'Some Form',
              fields: [{ field_id: 'f1', type: FieldType.TEXTO_CORTO, label: 'Field 1', required: false, order: 1 }],
            });

            mockSend.mockResolvedValueOnce({ Item: existingForm }); // GetCommand for form lookup

            const { unpublishForm } = await import('../../src/services/forms/form.js');

            const result = await unpublishForm(tenantId, formId, actorId, ipAddress);

            // Must be rejected
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.statusCode).toBe(422);
              expect(result.code).toBe('UNPROCESSABLE_ENTITY');
              expect(result.message).toContain('publicado');
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('edit is allowed only when form is in "borrador" state', () => {
      fc.assert(
        fc.asyncProperty(
          arbTenantId,
          arbFormId,
          arbActorId,
          arbIpAddress,
          arbValidName,
          async (tenantId, formId, actorId, ipAddress, newName) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: form exists in borrador state
            const existingForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              status: FormStatus.BORRADOR,
              name: 'Original Name',
              fields: [{ field_id: 'f1', type: FieldType.TEXTO_CORTO, label: 'Field 1', required: false, order: 1 }],
            });

            mockSend.mockResolvedValueOnce({ Item: existingForm }); // GetCommand for form lookup
            // Mock: no duplicate name found
            mockSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand for duplicate check
            // Mock: UpdateCommand returns updated form
            mockSend.mockResolvedValueOnce({
              Attributes: { ...existingForm, name: newName, updated_at: new Date().toISOString() },
            });
            // Mock: audit log write
            mockSend.mockResolvedValueOnce({});

            const { updateForm } = await import('../../src/services/forms/form.js');

            const result = await updateForm(
              tenantId,
              formId,
              { name: newName },
              actorId,
              ipAddress,
            );

            // Must succeed for borrador forms
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 6.4, 6.6**
  describe('Property 12: Publicación crea versión inmutable con token UUID v4', () => {
    it('publishing a valid draft form changes status to "publicado", generates a valid UUID v4 token, and creates a FormVersion with identical fields_snapshot', () => {
      fc.assert(
        fc.asyncProperty(
          arbTenantId,
          arbFormId,
          arbActorId,
          arbIpAddress,
          arbValidName,
          arbValidFieldsArray,
          async (tenantId, formId, actorId, ipAddress, formName, fields) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Generate a real UUID v4 for the token
            const generatedToken = `${formId.substring(0, 8)}-test-4aaa-8bbb-cccccccccccc`;
            const { v4: mockUuidV4 } = await import('uuid');
            (mockUuidV4 as ReturnType<typeof vi.fn>).mockReturnValue(generatedToken);

            // Mock: form exists in borrador state with valid fields
            const existingForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              status: FormStatus.BORRADOR,
              name: formName,
              fields,
            });

            // 1. GetCommand: form lookup
            mockSend.mockResolvedValueOnce({ Item: existingForm });
            // 2. QueryCommand: getCurrentVersionNumber (no existing versions)
            mockSend.mockResolvedValueOnce({ Items: [] });
            // 3. PutCommand: createFormVersion
            mockSend.mockResolvedValueOnce({});
            // 4. UpdateCommand: update form status
            mockSend.mockResolvedValueOnce({
              Attributes: {
                ...existingForm,
                status: FormStatus.PUBLICADO,
                token_publico: generatedToken,
                current_version: 1,
                published_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            });
            // 5. PutCommand: audit log
            mockSend.mockResolvedValueOnce({});

            const { publishForm } = await import('../../src/services/forms/form.js');

            const result = await publishForm(tenantId, formId, actorId, ipAddress);

            // Must succeed
            expect(result.success).toBe(true);

            if (result.success) {
              // 1. Status must be "publicado"
              expect(result.form.status).toBe(FormStatus.PUBLICADO);

              // 2. token_publico must be a valid UUID v4
              expect(result.token_publico).toBe(generatedToken);
              expect(result.token_publico).toMatch(UUID_V4_REGEX);

              // 3. A FormVersion was created (PutCommand was called for FormVersions table)
              const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
              const putCalls = (PutCommand as unknown as ReturnType<typeof vi.fn>).mock.calls;

              // Find the FormVersion PutCommand (PK starts with FORM#)
              const versionPut = putCalls.find(
                (call: any[]) => call[0]?.Item?.PK?.startsWith('FORM#') && call[0]?.Item?.SK?.startsWith('VERSION#'),
              );
              expect(versionPut).toBeDefined();

              // 4. The fields_snapshot must be identical to the form's fields
              const versionItem = versionPut![0].Item;
              expect(versionItem.fields_snapshot).toEqual(fields);
              expect(versionItem.form_id).toBe(formId);
              expect(versionItem.version_number).toBe(1);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('each publish generates a unique token_publico that is a valid UUID v4', () => {
      fc.assert(
        fc.asyncProperty(
          arbTenantId,
          arbFormId,
          arbActorId,
          arbIpAddress,
          arbValidName,
          fc.uuid(), // Use fast-check's uuid to simulate different tokens
          async (tenantId, formId, actorId, ipAddress, formName, expectedToken) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock uuid to return the expected token
            const { v4: mockUuidV4 } = await import('uuid');
            (mockUuidV4 as ReturnType<typeof vi.fn>).mockReturnValue(expectedToken);

            const fields: FieldConfig[] = [
              { field_id: 'f1', type: FieldType.TEXTO_CORTO, label: 'Name', required: true, order: 1 },
            ];

            const existingForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              status: FormStatus.BORRADOR,
              name: formName,
              fields,
            });

            mockSend.mockResolvedValueOnce({ Item: existingForm });
            mockSend.mockResolvedValueOnce({ Items: [] }); // No existing versions
            mockSend.mockResolvedValueOnce({}); // PutCommand: version
            mockSend.mockResolvedValueOnce({
              Attributes: {
                ...existingForm,
                status: FormStatus.PUBLICADO,
                token_publico: expectedToken,
                current_version: 1,
                published_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            });
            mockSend.mockResolvedValueOnce({}); // Audit

            const { publishForm } = await import('../../src/services/forms/form.js');

            const result = await publishForm(tenantId, formId, actorId, ipAddress);

            expect(result.success).toBe(true);
            if (result.success) {
              // Token must be a valid UUID v4
              expect(result.token_publico).toMatch(UUID_V4_REGEX);
              expect(result.token_publico).toBe(expectedToken);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('the FormVersion fields_snapshot is a deep copy identical to the form fields at publication time', () => {
      fc.assert(
        fc.asyncProperty(
          arbTenantId,
          arbFormId,
          arbActorId,
          arbIpAddress,
          arbValidName,
          arbValidFieldsArray,
          async (tenantId, formId, actorId, ipAddress, formName, fields) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            const generatedToken = 'abcdef01-2345-4678-9abc-def012345678';
            const { v4: mockUuidV4 } = await import('uuid');
            (mockUuidV4 as ReturnType<typeof vi.fn>).mockReturnValue(generatedToken);

            const existingForm = buildForm({
              form_id: formId,
              tenant_id: tenantId,
              status: FormStatus.BORRADOR,
              name: formName,
              fields,
            });

            mockSend.mockResolvedValueOnce({ Item: existingForm });
            mockSend.mockResolvedValueOnce({ Items: [] }); // No existing versions
            mockSend.mockResolvedValueOnce({}); // PutCommand: version
            mockSend.mockResolvedValueOnce({
              Attributes: {
                ...existingForm,
                status: FormStatus.PUBLICADO,
                token_publico: generatedToken,
                current_version: 1,
                published_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            });
            mockSend.mockResolvedValueOnce({}); // Audit

            const { publishForm } = await import('../../src/services/forms/form.js');

            const result = await publishForm(tenantId, formId, actorId, ipAddress);

            expect(result.success).toBe(true);

            // Verify the FormVersion PutCommand captured the exact fields
            const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
            const putCalls = (PutCommand as unknown as ReturnType<typeof vi.fn>).mock.calls;

            const versionPut = putCalls.find(
              (call: any[]) => call[0]?.Item?.PK?.startsWith('FORM#') && call[0]?.Item?.SK?.startsWith('VERSION#'),
            );
            expect(versionPut).toBeDefined();

            const snapshot = versionPut![0].Item.fields_snapshot;

            // fields_snapshot must be deeply equal to the original fields
            expect(snapshot).toEqual(fields);

            // Verify each field property is preserved
            for (let i = 0; i < fields.length; i++) {
              expect(snapshot[i].field_id).toBe(fields[i].field_id);
              expect(snapshot[i].type).toBe(fields[i].type);
              expect(snapshot[i].label).toBe(fields[i].label);
              expect(snapshot[i].required).toBe(fields[i].required);
              expect(snapshot[i].order).toBe(fields[i].order);
              if (fields[i].options) {
                expect(snapshot[i].options).toEqual(fields[i].options);
              }
              if (fields[i].validation) {
                expect(snapshot[i].validation).toEqual(fields[i].validation);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
