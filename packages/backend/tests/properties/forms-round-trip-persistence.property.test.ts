// Feature: contractor-forms-qr, Property 8: Round-trip de persistencia de formulario

/**
 * Property-based test for round-trip form persistence.
 *
 * Property 8: For any draft form with valid name, description, and fields,
 * saving the changes and then reading the form must return exactly the same data
 * (name, description, fields with all properties) with an updated last modification date.
 *
 * **Validates: Requirements 3.1, 4.2, 4.5**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { FormStatus, FieldType } from '../../src/services/forms/types.js';
import type { Form, FieldConfig, FieldOption, FieldValidation } from '../../src/services/forms/types.js';

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => params),
    UpdateCommand: vi.fn().mockImplementation((params) => params),
    GetCommand: vi.fn().mockImplementation((params) => params),
    QueryCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid form names (3-200 chars with at least one non-space) */
const arbValidName = fc
  .string({ minLength: 3, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for valid descriptions (1-1000 chars) */
const arbValidDescription = fc.string({ minLength: 1, maxLength: 1000 });

/** Arbitrary for valid labels (1-200 chars) */
const arbValidLabel = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.length >= 1);

/** Arbitrary for a valid option */
const arbValidOption: fc.Arbitrary<FieldOption> = fc.record({
  option_id: fc.uuid(),
  label: arbValidLabel,
});

/** Arbitrary for valid options array (2-10 options for performance) */
const arbValidOptions = fc.array(arbValidOption, { minLength: 2, maxLength: 10 });

/** Arbitrary for field validation rules (numeric) */
const arbNumericValidation: fc.Arbitrary<FieldValidation> = fc
  .record({
    min_value: fc.option(fc.integer({ min: -999999999, max: 999999999 }), { nil: undefined }),
    max_value: fc.option(fc.integer({ min: -999999999, max: 999999999 }), { nil: undefined }),
  })
  .map((v) => {
    const result: FieldValidation = {};
    if (v.min_value !== undefined) result.min_value = v.min_value;
    if (v.max_value !== undefined) result.max_value = v.max_value;
    return result;
  });

/** Arbitrary for field validation rules (text) */
const arbTextValidation: fc.Arbitrary<FieldValidation> = fc
  .record({
    min_length: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    max_length: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
  })
  .map((v) => {
    const result: FieldValidation = {};
    if (v.min_length !== undefined) result.min_length = v.min_length;
    if (v.max_length !== undefined) result.max_length = v.max_length;
    return result;
  });

/** Non-selection field types */
const NON_SELECTION_TYPES = [
  FieldType.TEXTO_CORTO,
  FieldType.TEXTO_LARGO,
  FieldType.NUMERO,
  FieldType.FECHA,
  FieldType.CHECKBOX_ACEPTACION,
  FieldType.CARGA_ARCHIVO,
] as const;

/** Selection field types */
const SELECTION_TYPES = [
  FieldType.SELECCION_SIMPLE,
  FieldType.SELECCION_MULTIPLE,
] as const;

/** Arbitrary for a valid non-selection field */
const arbNonSelectionField: fc.Arbitrary<FieldConfig> = fc
  .record({
    field_id: fc.uuid(),
    type: fc.constantFrom(...NON_SELECTION_TYPES),
    label: arbValidLabel,
    required: fc.boolean(),
    order: fc.integer({ min: 1, max: 50 }),
    placeholder: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
    help_text: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
    validation: fc.option(
      fc.oneof(arbNumericValidation, arbTextValidation),
      { nil: undefined },
    ),
  })
  .map((f) => {
    const result: FieldConfig = {
      field_id: f.field_id,
      type: f.type,
      label: f.label,
      required: f.required,
      order: f.order,
    };
    if (f.placeholder !== undefined) result.placeholder = f.placeholder;
    if (f.help_text !== undefined) result.help_text = f.help_text;
    if (f.validation !== undefined) result.validation = f.validation;
    return result;
  });

/** Arbitrary for a valid selection field */
const arbSelectionField: fc.Arbitrary<FieldConfig> = fc
  .record({
    field_id: fc.uuid(),
    type: fc.constantFrom(...SELECTION_TYPES),
    label: arbValidLabel,
    required: fc.boolean(),
    order: fc.integer({ min: 1, max: 50 }),
    placeholder: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
    help_text: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
    options: arbValidOptions,
  })
  .map((f) => {
    const result: FieldConfig = {
      field_id: f.field_id,
      type: f.type,
      label: f.label,
      required: f.required,
      order: f.order,
      options: f.options,
    };
    if (f.placeholder !== undefined) result.placeholder = f.placeholder;
    if (f.help_text !== undefined) result.help_text = f.help_text;
    return result;
  });

/** Arbitrary for any valid field */
const arbValidField = fc.oneof(arbNonSelectionField, arbSelectionField);

/** Arbitrary for a valid fields array (1-10 fields for performance) */
const arbValidFieldsArray = fc.array(arbValidField, { minLength: 1, maxLength: 10 });

/** Arbitrary for valid IPv4 addresses */
const arbIpAddress = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Normalizes field order to consecutive values 1..N (same logic as the production code).
 * This is needed to compute the expected state after save.
 */
function expectedNormalizedFields(fields: FieldConfig[]): FieldConfig[] {
  const sorted = [...fields].sort((a, b) => a.order - b.order);
  return sorted.map((field, index) => ({
    ...field,
    order: index + 1,
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Forms Round-Trip Persistence Property Tests', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 3.1, 4.2, 4.5**
  describe('Property 8: Round-trip de persistencia de formulario', () => {
    it('for any draft form with valid name, description, and fields, saving and then reading returns exactly the same data with an updated last modification date', () => {
      fc.assert(
        fc.asyncProperty(
          fc.uuid(), // tenantId
          fc.uuid(), // formId
          fc.uuid(), // actorId
          arbIpAddress,
          arbValidName,
          arbValidDescription,
          arbValidFieldsArray,
          async (tenantId, formId, actorId, ipAddress, newName, newDescription, newFields) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            const originalCreatedAt = '2024-01-01T00:00:00.000Z';
            const originalUpdatedAt = '2024-01-05T00:00:00.000Z';

            // The existing form in "borrador" state
            const existingForm: Form = {
              form_id: formId,
              tenant_id: tenantId,
              name: 'Original Name',
              description: 'Original description',
              status: FormStatus.BORRADOR,
              fields: [],
              author_id: 'original-author',
              created_at: originalCreatedAt,
              updated_at: originalUpdatedAt,
            };

            // Compute expected normalized fields (what the system will persist)
            const normalizedFields = expectedNormalizedFields(newFields);

            // The form as it should look after the update
            // (UpdateCommand returns ALL_NEW, simulating DynamoDB behavior)
            const updatedForm: Form = {
              ...existingForm,
              name: newName,
              description: newDescription,
              fields: normalizedFields,
              updated_at: '2024-06-15T12:00:00.000Z', // Simulated new timestamp
            };

            // ─── Mock sequence for updateForm ───
            // 1. GetCommand: form lookup
            mockSend.mockResolvedValueOnce({ Item: existingForm });
            // 2. UpdateCommand: persist changes (returns ALL_NEW)
            mockSend.mockResolvedValueOnce({ Attributes: updatedForm });
            // 3. PutCommand: audit log
            mockSend.mockResolvedValueOnce({});

            // ─── Mock sequence for getForm ───
            // 4. GetCommand: read the form back
            mockSend.mockResolvedValueOnce({ Item: updatedForm });

            const { updateForm, getForm } = await import('../../src/services/forms/form.js');

            // ─── Step 1: Save the form ───
            const saveResult = await updateForm(
              tenantId,
              formId,
              { name: newName, description: newDescription, fields: newFields },
              actorId,
              ipAddress,
            );

            // Save must succeed
            expect(saveResult.success).toBe(true);
            if (!saveResult.success) return;

            // ─── Step 2: Read the form back ───
            const readResult = await getForm(tenantId, formId);

            // Read must return the form
            expect(readResult).not.toBeNull();
            if (!readResult) return;

            // ─── Step 3: Verify round-trip ───

            // Name must match exactly
            expect(readResult.name).toBe(newName);

            // Description must match exactly
            expect(readResult.description).toBe(newDescription);

            // Fields must match (with normalized order)
            expect(readResult.fields).toHaveLength(normalizedFields.length);
            for (let i = 0; i < normalizedFields.length; i++) {
              const expected = normalizedFields[i];
              const actual = readResult.fields[i];

              expect(actual.field_id).toBe(expected.field_id);
              expect(actual.type).toBe(expected.type);
              expect(actual.label).toBe(expected.label);
              expect(actual.required).toBe(expected.required);
              expect(actual.order).toBe(expected.order);

              // Optional properties
              if (expected.placeholder !== undefined) {
                expect(actual.placeholder).toBe(expected.placeholder);
              }
              if (expected.help_text !== undefined) {
                expect(actual.help_text).toBe(expected.help_text);
              }
              if (expected.options !== undefined) {
                expect(actual.options).toEqual(expected.options);
              }
              if (expected.validation !== undefined) {
                expect(actual.validation).toEqual(expected.validation);
              }
            }

            // updated_at must be different from the original (it was updated)
            expect(readResult.updated_at).not.toBe(originalUpdatedAt);

            // created_at must remain unchanged
            expect(readResult.created_at).toBe(originalCreatedAt);

            // The saved form and the read form must be identical
            expect(readResult).toEqual(saveResult.form);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('saving only name preserves existing description and fields unchanged', () => {
      fc.assert(
        fc.asyncProperty(
          fc.uuid(), // tenantId
          fc.uuid(), // formId
          fc.uuid(), // actorId
          arbIpAddress,
          arbValidName, // new name
          arbValidDescription, // existing description
          arbValidFieldsArray, // existing fields
          async (tenantId, formId, actorId, ipAddress, newName, existingDescription, existingFields) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            const normalizedExistingFields = expectedNormalizedFields(existingFields);

            const existingForm: Form = {
              form_id: formId,
              tenant_id: tenantId,
              name: 'Old Name',
              description: existingDescription,
              status: FormStatus.BORRADOR,
              fields: normalizedExistingFields,
              author_id: 'author-1',
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-01-05T00:00:00.000Z',
            };

            // UpdateCommand only updates name and updated_at, preserves rest
            const updatedForm: Form = {
              ...existingForm,
              name: newName,
              updated_at: '2024-06-15T12:00:00.000Z',
            };

            // Mock sequence for updateForm
            mockSend.mockResolvedValueOnce({ Item: existingForm }); // GetCommand
            mockSend.mockResolvedValueOnce({ Attributes: updatedForm }); // UpdateCommand
            mockSend.mockResolvedValueOnce({}); // PutCommand (audit)

            // Mock sequence for getForm
            mockSend.mockResolvedValueOnce({ Item: updatedForm }); // GetCommand

            const { updateForm, getForm } = await import('../../src/services/forms/form.js');

            const saveResult = await updateForm(
              tenantId,
              formId,
              { name: newName },
              actorId,
              ipAddress,
            );

            expect(saveResult.success).toBe(true);
            if (!saveResult.success) return;

            const readResult = await getForm(tenantId, formId);
            expect(readResult).not.toBeNull();
            if (!readResult) return;

            // Name updated
            expect(readResult.name).toBe(newName);

            // Description preserved
            expect(readResult.description).toBe(existingDescription);

            // Fields preserved (unchanged)
            expect(readResult.fields).toEqual(normalizedExistingFields);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('saving only fields preserves existing name and description unchanged', () => {
      fc.assert(
        fc.asyncProperty(
          fc.uuid(), // tenantId
          fc.uuid(), // formId
          fc.uuid(), // actorId
          arbIpAddress,
          arbValidName, // existing name
          arbValidDescription, // existing description
          arbValidFieldsArray, // new fields
          async (tenantId, formId, actorId, ipAddress, existingName, existingDescription, newFields) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            const existingForm: Form = {
              form_id: formId,
              tenant_id: tenantId,
              name: existingName,
              description: existingDescription,
              status: FormStatus.BORRADOR,
              fields: [{ field_id: 'old-f1', type: FieldType.TEXTO_CORTO, label: 'Old', required: false, order: 1 }],
              author_id: 'author-1',
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-01-05T00:00:00.000Z',
            };

            const normalizedNewFields = expectedNormalizedFields(newFields);

            const updatedForm: Form = {
              ...existingForm,
              fields: normalizedNewFields,
              updated_at: '2024-06-15T12:00:00.000Z',
            };

            // Mock sequence for updateForm
            mockSend.mockResolvedValueOnce({ Item: existingForm }); // GetCommand
            mockSend.mockResolvedValueOnce({ Attributes: updatedForm }); // UpdateCommand
            mockSend.mockResolvedValueOnce({}); // PutCommand (audit)

            // Mock sequence for getForm
            mockSend.mockResolvedValueOnce({ Item: updatedForm }); // GetCommand

            const { updateForm, getForm } = await import('../../src/services/forms/form.js');

            const saveResult = await updateForm(
              tenantId,
              formId,
              { fields: newFields },
              actorId,
              ipAddress,
            );

            expect(saveResult.success).toBe(true);
            if (!saveResult.success) return;

            const readResult = await getForm(tenantId, formId);
            expect(readResult).not.toBeNull();
            if (!readResult) return;

            // Name preserved
            expect(readResult.name).toBe(existingName);

            // Description preserved
            expect(readResult.description).toBe(existingDescription);

            // Fields updated with normalized order
            expect(readResult.fields).toEqual(normalizedNewFields);

            // updated_at changed
            expect(readResult.updated_at).not.toBe('2024-01-05T00:00:00.000Z');
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
