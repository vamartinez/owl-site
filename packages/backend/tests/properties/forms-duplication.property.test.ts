// Feature: contractor-forms-qr, Property 10: Duplicación preserva campos sin estado
// Feature: contractor-forms-qr, Property 11: Nombre de formulario duplicado

/**
 * Property-based tests for form duplication.
 *
 * Property 10: For any form (in any state), duplicating it must produce a new form with:
 * the same fields and properties (type, label, required, options, validations, order),
 * status "borrador", without token_publico, without versions, without responses,
 * with new dates and a new ID.
 *
 * Property 11: For any form name, the duplicate name must be the original name
 * concatenated with " (copia)", truncating the original name if necessary so the
 * result does not exceed 200 characters.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => params),
    GetCommand: vi.fn().mockImplementation((params) => params),
    QueryCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const VALID_FIELD_TYPES = [
  'texto_corto',
  'texto_largo',
  'numero',
  'fecha',
  'seleccion_simple',
  'seleccion_multiple',
  'checkbox_aceptacion',
  'carga_archivo',
] as const;

const SELECTION_TYPES = ['seleccion_simple', 'seleccion_multiple'] as const;

const FORM_STATUSES = ['borrador', 'publicado', 'despublicado'] as const;

/** Arbitrary for valid labels (1-200 chars) */
const arbValidLabel = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.length >= 1);

/** Arbitrary for a valid option */
const arbValidOption = fc.record({
  option_id: fc.uuid(),
  label: arbValidLabel,
});

/** Arbitrary for valid options array (2-50 options) */
const arbValidOptions = fc.array(arbValidOption, { minLength: 2, maxLength: 10 });

/** Arbitrary for field validation rules */
const arbFieldValidation = fc.record({
  min_value: fc.option(fc.integer({ min: -999999999, max: 999999999 }), { nil: undefined }),
  max_value: fc.option(fc.integer({ min: -999999999, max: 999999999 }), { nil: undefined }),
  min_length: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  max_length: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
});

/** Arbitrary for a valid non-selection field */
const arbNonSelectionField = fc
  .record({
    field_id: fc.uuid(),
    type: fc.constantFrom('texto_corto', 'texto_largo', 'numero', 'fecha', 'checkbox_aceptacion', 'carga_archivo'),
    label: arbValidLabel,
    required: fc.boolean(),
    order: fc.integer({ min: 1, max: 50 }),
    placeholder: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
    help_text: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
    validation: fc.option(arbFieldValidation, { nil: undefined }),
  })
  .map((f) => {
    const result: Record<string, unknown> = {
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
const arbSelectionField = fc
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
    const result: Record<string, unknown> = {
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
const arbField = fc.oneof(arbNonSelectionField, arbSelectionField);

/** Arbitrary for a valid fields array (1-10 fields for performance) */
const arbFields = fc.array(arbField, { minLength: 0, maxLength: 10 });

/** Arbitrary for valid form names (3-200 chars with at least one non-space) */
const arbValidFormName = fc
  .string({ minLength: 3, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for a complete form in any state */
const arbForm = fc
  .record({
    form_id: fc.uuid(),
    tenant_id: fc.uuid(),
    name: arbValidFormName,
    description: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: undefined }),
    status: fc.constantFrom(...FORM_STATUSES),
    fields: arbFields,
    token_publico: fc.option(fc.uuid(), { nil: undefined }),
    current_version: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    author_id: fc.uuid(),
    created_at: fc.constant('2024-01-01T00:00:00.000Z'),
    updated_at: fc.constant('2024-01-15T00:00:00.000Z'),
    published_at: fc.option(fc.constant('2024-01-10T00:00:00.000Z'), { nil: undefined }),
  })
  .map((f) => {
    const result: Record<string, unknown> = {
      form_id: f.form_id,
      tenant_id: f.tenant_id,
      name: f.name,
      status: f.status,
      fields: f.fields,
      author_id: f.author_id,
      created_at: f.created_at,
      updated_at: f.updated_at,
    };
    if (f.description !== undefined) result.description = f.description;
    if (f.token_publico !== undefined) result.token_publico = f.token_publico;
    if (f.current_version !== undefined) result.current_version = f.current_version;
    if (f.published_at !== undefined) result.published_at = f.published_at;
    return result;
  });

/** Arbitrary for any string (used for name testing in Property 11) */
const arbAnyName = fc.string({ minLength: 1, maxLength: 400 });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Forms Duplication Property Tests', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 5.1, 5.3**
  describe('Property 10: Duplicación preserva campos sin estado', () => {
    it('for any form in any state, duplicating it produces a new form with same field properties, status borrador, no token_publico, no versions, no responses, new dates and new ID', () => {
      fc.assert(
        fc.asyncProperty(
          arbForm,
          fc.uuid(), // actorId
          async (originalForm, actorId) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            // Mock: GetCommand returns the original form
            mockSend.mockResolvedValueOnce({
              Item: {
                PK: `TENANT#${originalForm.tenant_id}`,
                SK: `FORM#${originalForm.form_id}`,
                ...originalForm,
              },
            });
            // Mock: PutCommand for the new form
            mockSend.mockResolvedValueOnce({});
            // Mock: PutCommand for the audit entry
            mockSend.mockResolvedValueOnce({});

            const { duplicateForm } = await import('../../src/services/forms/form.js');

            const result = await duplicateForm(
              originalForm.tenant_id as string,
              originalForm.form_id as string,
              actorId,
              '192.168.1.1',
            );

            // Must succeed
            expect(result.success).toBe(true);
            if (!result.success) return;

            const duplicated = result.form;

            // 1. New ID (different from original)
            expect(duplicated.form_id).not.toBe(originalForm.form_id);
            expect(duplicated.form_id).toBeTruthy();

            // 2. Status must be "borrador"
            expect(duplicated.status).toBe('borrador');

            // 3. No token_publico
            expect(duplicated.token_publico).toBeUndefined();

            // 4. No versions (current_version not set)
            expect(duplicated.current_version).toBeUndefined();

            // 5. No published_at
            expect(duplicated.published_at).toBeUndefined();

            // 6. New dates (created_at and updated_at are fresh)
            expect(duplicated.created_at).not.toBe(originalForm.created_at);
            expect(duplicated.updated_at).not.toBe(originalForm.updated_at);

            // 7. Same number of fields
            const originalFields = originalForm.fields as Array<Record<string, unknown>>;
            expect(duplicated.fields).toHaveLength(originalFields.length);

            // 8. Each field preserves type, label, required, order, options, validations
            for (let i = 0; i < originalFields.length; i++) {
              const origField = originalFields[i];
              const dupField = duplicated.fields[i];

              // Type preserved
              expect(dupField.type).toBe(origField.type);
              // Label preserved
              expect(dupField.label).toBe(origField.label);
              // Required preserved
              expect(dupField.required).toBe(origField.required);
              // Order preserved
              expect(dupField.order).toBe(origField.order);

              // Options preserved (if present)
              if (origField.options) {
                expect(dupField.options).toBeDefined();
                const origOptions = origField.options as Array<{ label: string }>;
                expect(dupField.options!.length).toBe(origOptions.length);
                for (let j = 0; j < origOptions.length; j++) {
                  expect(dupField.options![j].label).toBe(origOptions[j].label);
                  // Option IDs should be NEW (not copied)
                  expect(dupField.options![j].option_id).not.toBe(
                    (origField.options as Array<{ option_id: string }>)[j].option_id,
                  );
                }
              }

              // Validation preserved (if present)
              if (origField.validation) {
                expect(dupField.validation).toEqual(origField.validation);
              }

              // Placeholder preserved (if present)
              if (origField.placeholder !== undefined) {
                expect(dupField.placeholder).toBe(origField.placeholder);
              }

              // Help text preserved (if present)
              if (origField.help_text !== undefined) {
                expect(dupField.help_text).toBe(origField.help_text);
              }

              // Field IDs should be NEW (not copied from original)
              expect(dupField.field_id).not.toBe(origField.field_id);
            }

            // 9. Same tenant
            expect(duplicated.tenant_id).toBe(originalForm.tenant_id);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('duplicated form fields have new unique field_ids (not shared with original)', () => {
      fc.assert(
        fc.asyncProperty(
          arbForm.filter((f) => (f.fields as unknown[]).length > 0),
          fc.uuid(),
          async (originalForm, actorId) => {
            vi.resetModules();
            mockSend.mockReset();
            mockAwsSdk();

            mockSend.mockResolvedValueOnce({
              Item: {
                PK: `TENANT#${originalForm.tenant_id}`,
                SK: `FORM#${originalForm.form_id}`,
                ...originalForm,
              },
            });
            mockSend.mockResolvedValueOnce({});
            mockSend.mockResolvedValueOnce({});

            const { duplicateForm } = await import('../../src/services/forms/form.js');

            const result = await duplicateForm(
              originalForm.tenant_id as string,
              originalForm.form_id as string,
              actorId,
              '10.0.0.1',
            );

            expect(result.success).toBe(true);
            if (!result.success) return;

            const originalFieldIds = (originalForm.fields as Array<{ field_id: string }>).map(
              (f) => f.field_id,
            );
            const duplicatedFieldIds = result.form.fields.map((f) => f.field_id);

            // No field_id from the original should appear in the duplicate
            for (const dupId of duplicatedFieldIds) {
              expect(originalFieldIds).not.toContain(dupId);
            }

            // All duplicated field_ids should be unique among themselves
            const uniqueIds = new Set(duplicatedFieldIds);
            expect(uniqueIds.size).toBe(duplicatedFieldIds.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 5.2**
  describe('Property 11: Nombre de formulario duplicado', () => {
    it('for any form name, the duplicate name is the original concatenated with " (copia)"', () => {
      fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 192 }).filter((s) => s.trim().length > 0),
          async (originalName) => {
            vi.resetModules();
            mockAwsSdk();
            const { generateDuplicateName } = await import('../../src/services/forms/form.js');
            const result = generateDuplicateName(originalName);
            expect(result).toBe(`${originalName} (copia)`);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('for any form name, the duplicate name never exceeds 200 characters', () => {
      fc.assert(
        fc.asyncProperty(arbAnyName, async (originalName) => {
          vi.resetModules();
          mockAwsSdk();
          const { generateDuplicateName } = await import('../../src/services/forms/form.js');
          const result = generateDuplicateName(originalName);
          expect(result.length).toBeLessThanOrEqual(200);
        }),
        { numRuns: 100 },
      );
    });

    it('for names that would exceed 200 chars with suffix, the original is truncated so result is exactly 200 chars', () => {
      fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 193, maxLength: 400 }),
          async (originalName) => {
            vi.resetModules();
            mockAwsSdk();
            const { generateDuplicateName } = await import('../../src/services/forms/form.js');
            const result = generateDuplicateName(originalName);
            // When original > 192 chars, result should be exactly 200
            expect(result.length).toBe(200);
            // Must end with " (copia)"
            expect(result.endsWith(' (copia)')).toBe(true);
            // The truncated original is the first 192 chars
            expect(result).toBe(`${originalName.substring(0, 192)} (copia)`);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('the duplicate name always ends with " (copia)" suffix', () => {
      fc.assert(
        fc.asyncProperty(arbAnyName, async (originalName) => {
          vi.resetModules();
          mockAwsSdk();
          const { generateDuplicateName } = await import('../../src/services/forms/form.js');
          const result = generateDuplicateName(originalName);
          expect(result.endsWith(' (copia)')).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('for names within 192 chars, the full original name is preserved in the duplicate', () => {
      fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 192 }),
          async (originalName) => {
            vi.resetModules();
            mockAwsSdk();
            const { generateDuplicateName } = await import('../../src/services/forms/form.js');
            const result = generateDuplicateName(originalName);
            // Full original name should be at the start
            expect(result.startsWith(originalName)).toBe(true);
            expect(result).toBe(`${originalName} (copia)`);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
