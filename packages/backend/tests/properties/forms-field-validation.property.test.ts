// Feature: contractor-forms-qr, Property 5: Validación de configuración de campos
// Feature: contractor-forms-qr, Property 6: Orden de campos consecutivo sin duplicados

/**
 * Property-based tests for field configuration validation.
 *
 * Property 5: For any field configuration, the system must accept it if and only if:
 * the label has between 1 and 200 characters, the type is one of the 8 valid types,
 * selection fields have between 2 and 50 options with labels of 1-200 chars, and
 * numeric validation rules are in range [-999999999, 999999999]. The system must
 * reject invalid configurations indicating each field with error and the specific reason.
 *
 * Property 6: For any form after any field reordering operation, the display order
 * values must be consecutive integers from 1 to N (where N is the total number of
 * fields) without duplicates or gaps.
 *
 * Validates: Requirements 2.2, 2.5, 2.6, 2.7, 2.9
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateFields, normalizeFieldOrder } from '../../src/services/forms/form.js';
import { FieldType } from '../../src/services/forms/types.js';
import type { FieldConfig, FieldOption } from '../../src/services/forms/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_FIELD_TYPES = Object.values(FieldType);
const NUMERIC_LIMIT = 999999999;

const SELECTION_TYPES = [FieldType.SELECCION_SIMPLE, FieldType.SELECCION_MULTIPLE];
const NON_SELECTION_TYPES = VALID_FIELD_TYPES.filter((t) => !SELECTION_TYPES.includes(t));

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid labels (1-200 chars, at least one non-space) */
const arbValidLabel = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.length >= 1 && s.length <= 200);

/** Arbitrary for invalid labels: empty string */
const arbEmptyLabel = fc.constant('');

/** Arbitrary for invalid labels: too long (>200 chars) */
const arbTooLongLabel = fc.string({ minLength: 201, maxLength: 300 });

/** Arbitrary for valid field type */
const arbValidFieldType = fc.constantFrom(...VALID_FIELD_TYPES);

/** Arbitrary for invalid field type */
const arbInvalidFieldType = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !VALID_FIELD_TYPES.includes(s as FieldType))
  .map((s) => s as unknown as FieldType);

/** Arbitrary for a valid option (label 1-200 chars) */
const arbValidOption = fc.record({
  option_id: fc.uuid(),
  label: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.length >= 1),
}) as fc.Arbitrary<FieldOption>;

/** Arbitrary for valid options array (2-50 options) */
const arbValidOptions = fc.array(arbValidOption, { minLength: 2, maxLength: 50 });

/** Arbitrary for a valid non-selection field */
const arbValidNonSelectionField = fc.record({
  field_id: fc.uuid(),
  type: fc.constantFrom(...NON_SELECTION_TYPES),
  label: arbValidLabel,
  required: fc.boolean(),
  order: fc.integer({ min: 1, max: 50 }),
}) as fc.Arbitrary<FieldConfig>;

/** Arbitrary for a valid selection field */
const arbValidSelectionField = fc.record({
  field_id: fc.uuid(),
  type: fc.constantFrom(...SELECTION_TYPES),
  label: arbValidLabel,
  required: fc.boolean(),
  order: fc.integer({ min: 1, max: 50 }),
  options: arbValidOptions,
}) as fc.Arbitrary<FieldConfig>;

/** Arbitrary for a valid numeric field with valid validation rules */
const arbValidNumericFieldWithValidation = fc
  .tuple(
    fc.uuid(),
    arbValidLabel,
    fc.boolean(),
    fc.integer({ min: 1, max: 50 }),
    fc.integer({ min: -NUMERIC_LIMIT, max: NUMERIC_LIMIT }),
    fc.integer({ min: -NUMERIC_LIMIT, max: NUMERIC_LIMIT }),
  )
  .map(([field_id, label, required, order, val1, val2]) => ({
    field_id,
    type: FieldType.NUMERO,
    label,
    required,
    order,
    validation: {
      min_value: Math.min(val1, val2),
      max_value: Math.max(val1, val2),
    },
  })) as fc.Arbitrary<FieldConfig>;

/** Arbitrary for any valid field (non-selection, selection, or numeric with validation) */
const arbValidField = fc.oneof(
  arbValidNonSelectionField,
  arbValidSelectionField,
  arbValidNumericFieldWithValidation,
);

/** Arbitrary for a valid fields array (1-50 fields) */
const arbValidFieldsArray = fc.array(arbValidField, { minLength: 1, maxLength: 50 });

/** Arbitrary for field order values (possibly non-consecutive, with gaps/duplicates) */
const arbArbitraryOrder = fc.integer({ min: -100, max: 200 });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Forms Field Validation Property Tests', () => {
  // **Validates: Requirements 2.2, 2.5, 2.6, 2.9**
  describe('Property 5: Validación de configuración de campos', () => {
    it('accepts any field configuration where label is 1-200 chars, type is valid, selection fields have 2-50 options with valid labels, and numeric validation is in range', () => {
      fc.assert(
        fc.property(arbValidFieldsArray, (fields) => {
          const errors = validateFields(fields);
          expect(errors).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });

    it('rejects field configurations with empty labels, indicating the specific field and reason', () => {
      fc.assert(
        fc.property(
          arbValidFieldType.filter((t) => !SELECTION_TYPES.includes(t)),
          fc.integer({ min: 1, max: 50 }),
          (fieldType, order) => {
            const field: FieldConfig = {
              field_id: 'test-id',
              type: fieldType,
              label: '',
              required: false,
              order,
            };

            const errors = validateFields([field]);
            expect(errors.length).toBeGreaterThan(0);
            // Error must reference the specific field
            const fieldError = errors.find((e) => e.field.includes('fields[0]'));
            expect(fieldError).toBeDefined();
            expect(fieldError!.message).toContain('etiqueta');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects field configurations with labels exceeding 200 characters', () => {
      fc.assert(
        fc.property(
          arbTooLongLabel,
          fc.constantFrom(...NON_SELECTION_TYPES),
          (label, fieldType) => {
            const field: FieldConfig = {
              field_id: 'test-id',
              type: fieldType,
              label,
              required: false,
              order: 1,
            };

            const errors = validateFields([field]);
            expect(errors.length).toBeGreaterThan(0);
            const fieldError = errors.find((e) => e.field.includes('fields[0]'));
            expect(fieldError).toBeDefined();
            expect(fieldError!.message).toContain('200');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects field configurations with invalid field types', () => {
      fc.assert(
        fc.property(arbInvalidFieldType, arbValidLabel, (invalidType, label) => {
          const field: FieldConfig = {
            field_id: 'test-id',
            type: invalidType,
            label,
            required: false,
            order: 1,
          };

          const errors = validateFields([field]);
          expect(errors.length).toBeGreaterThan(0);
          const typeError = errors.find((e) => e.message.includes('Tipo de campo inválido'));
          expect(typeError).toBeDefined();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects selection fields with fewer than 2 options', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SELECTION_TYPES),
          arbValidLabel,
          fc.array(arbValidOption, { minLength: 0, maxLength: 1 }),
          (selectionType, label, options) => {
            const field: FieldConfig = {
              field_id: 'test-id',
              type: selectionType,
              label,
              required: false,
              order: 1,
              options,
            };

            const errors = validateFields([field]);
            expect(errors.length).toBeGreaterThan(0);
            const optionError = errors.find(
              (e) => e.message.includes('2') && e.message.includes('50'),
            );
            expect(optionError).toBeDefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects selection fields with more than 50 options', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SELECTION_TYPES),
          arbValidLabel,
          (selectionType, label) => {
            const options: FieldOption[] = Array.from({ length: 51 }, (_, i) => ({
              option_id: `opt-${i}`,
              label: `Option ${i}`,
            }));

            const field: FieldConfig = {
              field_id: 'test-id',
              type: selectionType,
              label,
              required: false,
              order: 1,
              options,
            };

            const errors = validateFields([field]);
            expect(errors.length).toBeGreaterThan(0);
            const optionError = errors.find((e) => e.message.includes('50'));
            expect(optionError).toBeDefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects selection fields with option labels outside 1-200 chars', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...SELECTION_TYPES),
          arbValidLabel,
          fc.constantFrom('', 'x'.repeat(201)),
          (selectionType, label, badOptionLabel) => {
            const options: FieldOption[] = [
              { option_id: 'opt-1', label: 'Valid option' },
              { option_id: 'opt-2', label: badOptionLabel },
            ];

            const field: FieldConfig = {
              field_id: 'test-id',
              type: selectionType,
              label,
              required: false,
              order: 1,
              options,
            };

            const errors = validateFields([field]);
            expect(errors.length).toBeGreaterThan(0);
            const optionLabelError = errors.find((e) => e.field.includes('options'));
            expect(optionLabelError).toBeDefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects numeric validation rules outside range [-999999999, 999999999]', () => {
      fc.assert(
        fc.property(
          arbValidLabel,
          fc.oneof(
            fc.integer({ min: NUMERIC_LIMIT + 1, max: NUMERIC_LIMIT * 2 }),
            fc.integer({ min: -NUMERIC_LIMIT * 2, max: -NUMERIC_LIMIT - 1 }),
          ),
          (label, outOfRangeValue) => {
            const field: FieldConfig = {
              field_id: 'test-id',
              type: FieldType.NUMERO,
              label,
              required: false,
              order: 1,
              validation: {
                min_value: outOfRangeValue,
              },
            };

            const errors = validateFields([field]);
            expect(errors.length).toBeGreaterThan(0);
            const rangeError = errors.find(
              (e) => e.field.includes('validation') && e.message.includes('999999999'),
            );
            expect(rangeError).toBeDefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('reports all validation errors simultaneously for multiple invalid fields', () => {
      fc.assert(
        fc.property(
          arbTooLongLabel,
          arbInvalidFieldType,
          (longLabel, invalidType) => {
            const fields: FieldConfig[] = [
              {
                field_id: 'field-1',
                type: FieldType.TEXTO_CORTO,
                label: longLabel, // Invalid: too long
                required: false,
                order: 1,
              },
              {
                field_id: 'field-2',
                type: invalidType, // Invalid: bad type
                label: 'Valid label',
                required: false,
                order: 2,
              },
            ];

            const errors = validateFields(fields);
            // Must have at least 2 errors (one per invalid field)
            expect(errors.length).toBeGreaterThanOrEqual(2);
            // Must reference both fields
            const field0Errors = errors.filter((e) => e.field.includes('fields[0]'));
            const field1Errors = errors.filter((e) => e.field.includes('fields[1]'));
            expect(field0Errors.length).toBeGreaterThan(0);
            expect(field1Errors.length).toBeGreaterThan(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 2.7**
  describe('Property 6: Orden de campos consecutivo sin duplicados', () => {
    it('after normalizeFieldOrder, order values are consecutive integers from 1 to N without duplicates or gaps', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              field_id: fc.uuid(),
              type: arbValidFieldType,
              label: arbValidLabel,
              required: fc.boolean(),
              order: arbArbitraryOrder,
            }),
            { minLength: 1, maxLength: 50 },
          ),
          (fields) => {
            const normalized = normalizeFieldOrder(fields as FieldConfig[]);

            // Must have same number of fields
            expect(normalized).toHaveLength(fields.length);

            const N = normalized.length;

            // Order values must be exactly 1..N
            const orderValues = normalized.map((f) => f.order).sort((a, b) => a - b);
            const expected = Array.from({ length: N }, (_, i) => i + 1);
            expect(orderValues).toEqual(expected);

            // No duplicates
            const uniqueOrders = new Set(normalized.map((f) => f.order));
            expect(uniqueOrders.size).toBe(N);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('normalizeFieldOrder preserves all field data except order values', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              field_id: fc.uuid(),
              type: arbValidFieldType,
              label: arbValidLabel,
              required: fc.boolean(),
              order: arbArbitraryOrder,
            }),
            { minLength: 1, maxLength: 50 },
          ),
          (fields) => {
            const normalized = normalizeFieldOrder(fields as FieldConfig[]);

            // All original field_ids must be present in the result
            const originalIds = new Set(fields.map((f) => f.field_id));
            const normalizedIds = new Set(normalized.map((f) => f.field_id));
            expect(normalizedIds).toEqual(originalIds);

            // For each normalized field, all properties except order must match the original
            for (const normField of normalized) {
              const original = fields.find((f) => f.field_id === normField.field_id);
              expect(original).toBeDefined();
              expect(normField.type).toBe(original!.type);
              expect(normField.label).toBe(original!.label);
              expect(normField.required).toBe(original!.required);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('normalizeFieldOrder maintains relative order of fields sorted by their original order values', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              field_id: fc.uuid(),
              type: arbValidFieldType,
              label: arbValidLabel,
              required: fc.boolean(),
              order: fc.integer({ min: 1, max: 1000 }),
            }),
            { minLength: 2, maxLength: 50 },
          ).filter((fields) => {
            // Ensure unique order values for deterministic sorting
            const orders = fields.map((f) => f.order);
            return new Set(orders).size === orders.length;
          }),
          (fields) => {
            const normalized = normalizeFieldOrder(fields as FieldConfig[]);

            // Fields sorted by original order should appear in the same relative order
            const sortedByOriginal = [...fields].sort((a, b) => a.order - b.order);
            const sortedByNormalized = [...normalized].sort((a, b) => a.order - b.order);

            for (let i = 0; i < sortedByOriginal.length; i++) {
              expect(sortedByNormalized[i]!.field_id).toBe(sortedByOriginal[i]!.field_id);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
