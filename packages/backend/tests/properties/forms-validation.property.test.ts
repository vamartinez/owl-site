// Feature: contractor-forms-qr, Property 15: Validación muestra todos los errores simultáneamente
// Feature: contractor-forms-qr, Property 16: Validación numérica reporta límites
// Feature: contractor-forms-qr, Property 17: Validación de texto reporta longitud
// Feature: contractor-forms-qr, Property 18: Validación servidor consistente con cliente

/**
 * Property-based tests for the form-validation module.
 *
 * Property 15: For any form with N required fields and a submission where all are empty,
 * the response must contain exactly N errors, one per required field.
 *
 * Property 16: For any numeric field with min/max configured and a value out of range,
 * the error must include both min and max values.
 *
 * Property 17: For any text field with max_length configured and a string exceeding it,
 * the error must include the max length allowed.
 *
 * Property 18: Server validation must be consistent with client validation
 * (same module, same results).
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateFormResponse, validateField } from '../../src/services/forms/form-validation.js';
import { FieldType } from '../../src/services/forms/types.js';
import type { FieldConfig, FieldOption } from '../../src/services/forms/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_FIELD_TYPES = Object.values(FieldType);
const NON_FILE_TYPES = VALID_FIELD_TYPES.filter((t) => t !== FieldType.CARGA_ARCHIVO);
const TEXT_TYPES = [FieldType.TEXTO_CORTO, FieldType.TEXTO_LARGO];

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid labels (1-200 chars) */
const arbValidLabel = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.length >= 1);

/** Arbitrary for valid options (2-50 options for selection fields) */
const arbValidOptions = fc.array(
  fc.record({
    option_id: fc.uuid(),
    label: fc.string({ minLength: 1, maxLength: 50 }),
  }),
  { minLength: 2, maxLength: 10 },
) as fc.Arbitrary<FieldOption[]>;

/** Arbitrary for a required field of any non-file type */
const arbRequiredNonFileField = fc
  .tuple(fc.uuid(), fc.constantFrom(...NON_FILE_TYPES), arbValidLabel, arbValidOptions)
  .map(([field_id, type, label, options]) => {
    const field: FieldConfig = {
      field_id,
      type,
      label,
      required: true,
      order: 1,
    };
    // Add options for selection types
    if (
      type === FieldType.SELECCION_SIMPLE ||
      type === FieldType.SELECCION_MULTIPLE
    ) {
      field.options = options;
    }
    return field;
  });

/** Arbitrary for a required file field */
const arbRequiredFileField = fc.tuple(fc.uuid(), arbValidLabel).map(([field_id, label]) => ({
  field_id,
  type: FieldType.CARGA_ARCHIVO,
  label,
  required: true,
  order: 1,
})) as fc.Arbitrary<FieldConfig>;

/** Arbitrary for any required field */
const arbRequiredField = fc.oneof(arbRequiredNonFileField, arbRequiredFileField);

/** Arbitrary for an array of required fields (1-20 fields) with unique IDs and consecutive order */
const arbRequiredFieldsArray = fc
  .array(arbRequiredField, { minLength: 1, maxLength: 20 })
  .map((fields) =>
    fields.map((f, i) => ({
      ...f,
      field_id: `field-${i}`,
      order: i + 1,
    })),
  );

/** Arbitrary for a numeric field with both min and max configured */
const arbNumericFieldWithRange = fc
  .tuple(
    fc.uuid(),
    arbValidLabel,
    fc.integer({ min: -999999999, max: 999999998 }),
    fc.integer({ min: 1, max: 100 }),
  )
  .map(([field_id, label, minVal, spread]) => ({
    field_id,
    type: FieldType.NUMERO,
    label,
    required: false,
    order: 1,
    validation: {
      min_value: minVal,
      max_value: minVal + spread, // Ensure max > min
    },
  })) as fc.Arbitrary<FieldConfig>;

/** Arbitrary for a text field with max_length configured */
const arbTextFieldWithMaxLength = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom(...TEXT_TYPES),
    arbValidLabel,
    fc.integer({ min: 1, max: 5000 }),
  )
  .map(([field_id, type, label, maxLength]) => ({
    field_id,
    type,
    label,
    required: false,
    order: 1,
    validation: {
      max_length: maxLength,
    },
  })) as fc.Arbitrary<FieldConfig>;

/** Arbitrary for a valid form field with valid answers */
const arbFieldWithValidAnswer = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom(...NON_FILE_TYPES),
    arbValidLabel,
    fc.boolean(),
    arbValidOptions,
  )
  .chain(([field_id, type, label, required, options]) => {
    const field: FieldConfig = {
      field_id,
      type,
      label,
      required,
      order: 1,
    };

    // Generate a valid answer for this field type
    let answerArb: fc.Arbitrary<unknown>;

    switch (type) {
      case FieldType.TEXTO_CORTO:
      case FieldType.TEXTO_LARGO:
        answerArb = fc.string({ minLength: 1, maxLength: 100 });
        break;
      case FieldType.NUMERO:
        answerArb = fc.integer({ min: -1000, max: 1000 });
        break;
      case FieldType.FECHA:
        answerArb = fc
          .date({
            min: new Date('2000-01-01'),
            max: new Date('2099-12-31'),
          })
          .map((d) => d.toISOString().split('T')[0]);
        break;
      case FieldType.SELECCION_SIMPLE:
        field.options = options;
        answerArb = fc.constant(options[0]!.option_id);
        break;
      case FieldType.SELECCION_MULTIPLE:
        field.options = options;
        answerArb = fc.constant([options[0]!.option_id]);
        break;
      case FieldType.CHECKBOX_ACEPTACION:
        answerArb = fc.constant(true);
        break;
      default:
        answerArb = fc.string({ minLength: 1, maxLength: 50 });
    }

    return answerArb.map((answer) => ({ field, answer }));
  });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Forms Validation Property Tests', () => {
  // **Validates: Requirements 10.1**
  describe('Property 15: Validación muestra todos los errores simultáneamente', () => {
    it('for any form with N required fields and all-empty submission, returns exactly N errors', () => {
      fc.assert(
        fc.property(arbRequiredFieldsArray, (fields) => {
          // Submit with all fields empty (empty answers object)
          const answers: Record<string, unknown> = {};
          const result = validateFormResponse(fields, answers);

          // Must have exactly N errors (one per required field)
          expect(result.valid).toBe(false);
          expect(result.errors).toHaveLength(fields.length);

          // Each error must reference a unique field_id from the form
          const errorFieldIds = new Set(result.errors.map((e) => e.field_id));
          expect(errorFieldIds.size).toBe(fields.length);

          // Each required field must have exactly one error
          for (const field of fields) {
            const fieldError = result.errors.find((e) => e.field_id === field.field_id);
            expect(fieldError).toBeDefined();
            expect(fieldError!.message).toContain('obligatorio');
          }
        }),
        { numRuns: 100 },
      );
    });

    it('errors are returned simultaneously, not fail-fast (all fields checked)', () => {
      fc.assert(
        fc.property(arbRequiredFieldsArray, (fields) => {
          // Provide null values for all fields
          const answers: Record<string, unknown> = {};
          for (const field of fields) {
            answers[field.field_id] = null;
          }

          const result = validateFormResponse(fields, answers);

          // All required fields must produce errors simultaneously
          expect(result.errors.length).toBe(fields.length);

          // Verify the last field in the array also has an error
          // (proves we didn't stop at the first error)
          const lastField = fields[fields.length - 1]!;
          const lastFieldError = result.errors.find((e) => e.field_id === lastField.field_id);
          expect(lastFieldError).toBeDefined();
        }),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 10.2**
  describe('Property 16: Validación numérica reporta límites', () => {
    it('for any numeric field with min/max and value below min, error includes both min and max', () => {
      fc.assert(
        fc.property(
          arbNumericFieldWithRange,
          fc.integer({ min: 1, max: 1000 }),
          (field, offset) => {
            const belowMin = field.validation!.min_value! - offset;
            const errors = validateField(field, belowMin);

            expect(errors.length).toBeGreaterThan(0);
            const rangeError = errors[0]!;
            // Error must include both min and max values
            expect(rangeError.message).toContain(String(field.validation!.min_value));
            expect(rangeError.message).toContain(String(field.validation!.max_value));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('for any numeric field with min/max and value above max, error includes both min and max', () => {
      fc.assert(
        fc.property(
          arbNumericFieldWithRange,
          fc.integer({ min: 1, max: 1000 }),
          (field, offset) => {
            const aboveMax = field.validation!.max_value! + offset;
            const errors = validateField(field, aboveMax);

            expect(errors.length).toBeGreaterThan(0);
            const rangeError = errors[0]!;
            // Error must include both min and max values
            expect(rangeError.message).toContain(String(field.validation!.min_value));
            expect(rangeError.message).toContain(String(field.validation!.max_value));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('for any numeric field with min/max and value within range, no errors', () => {
      fc.assert(
        fc.property(arbNumericFieldWithRange, (field) => {
          const minVal = field.validation!.min_value!;
          const maxVal = field.validation!.max_value!;
          // Pick a value within range
          const validValue = minVal + Math.floor((maxVal - minVal) / 2);
          const errors = validateField(field, validValue);

          expect(errors).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 10.3**
  describe('Property 17: Validación de texto reporta longitud', () => {
    it('for any text field with max_length and a string exceeding it, error includes max length', () => {
      fc.assert(
        fc.property(
          arbTextFieldWithMaxLength,
          fc.integer({ min: 1, max: 500 }),
          (field, excess) => {
            const maxLen = field.validation!.max_length!;
            // Generate a string that exceeds max_length
            const tooLong = 'a'.repeat(maxLen + excess);
            const errors = validateField(field, tooLong);

            expect(errors.length).toBeGreaterThan(0);
            const lengthError = errors[0]!;
            // Error must include the max length allowed
            expect(lengthError.message).toContain(String(maxLen));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('for any text field with max_length and a string within limit, no errors', () => {
      fc.assert(
        fc.property(arbTextFieldWithMaxLength, (field) => {
          const maxLen = field.validation!.max_length!;
          // Generate a string within the limit
          const validText = 'a'.repeat(Math.min(maxLen, 100));
          const errors = validateField(field, validText);

          expect(errors).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });

    it('error message includes the actual length of the input', () => {
      fc.assert(
        fc.property(
          arbTextFieldWithMaxLength,
          fc.integer({ min: 1, max: 200 }),
          (field, excess) => {
            const maxLen = field.validation!.max_length!;
            const tooLong = 'a'.repeat(maxLen + excess);
            const errors = validateField(field, tooLong);

            expect(errors.length).toBeGreaterThan(0);
            const lengthError = errors[0]!;
            // Error should include the actual length
            expect(lengthError.message).toContain(String(tooLong.length));
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 10.7**
  describe('Property 18: Validación servidor consistente con cliente', () => {
    it('validateFormResponse and validateField produce the same results for the same inputs', () => {
      fc.assert(
        fc.property(arbFieldWithValidAnswer, ({ field, answer }) => {
          // Validate using validateFormResponse (server-style)
          const answers: Record<string, unknown> = { [field.field_id]: answer };
          const formResult = validateFormResponse([field], answers);

          // Validate using validateField directly (client-style)
          const fieldErrors = validateField(field, answer);

          // Both must produce the same validation decision
          expect(formResult.valid).toBe(fieldErrors.length === 0);
          expect(formResult.errors.length).toBe(fieldErrors.length);

          // If there are errors, they must be the same
          for (let i = 0; i < fieldErrors.length; i++) {
            expect(formResult.errors[i]!.field_id).toBe(fieldErrors[i]!.field_id);
            expect(formResult.errors[i]!.message).toBe(fieldErrors[i]!.message);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('consistency holds for invalid inputs (required fields with empty values)', () => {
      fc.assert(
        fc.property(arbRequiredField, (field) => {
          // Empty value for a required field
          const emptyValue = undefined;

          // Server-style validation
          const answers: Record<string, unknown> = {};
          const formResult = validateFormResponse([{ ...field, order: 1 }], answers);

          // Client-style validation
          const fieldErrors = validateField({ ...field, order: 1 }, emptyValue);

          // Both must reject and produce the same errors
          expect(formResult.valid).toBe(false);
          expect(fieldErrors.length).toBeGreaterThan(0);
          expect(formResult.errors.length).toBe(fieldErrors.length);
          expect(formResult.errors[0]!.message).toBe(fieldErrors[0]!.message);
        }),
        { numRuns: 100 },
      );
    });

    it('consistency holds for numeric out-of-range values', () => {
      fc.assert(
        fc.property(
          arbNumericFieldWithRange,
          fc.integer({ min: 1, max: 1000 }),
          (field, offset) => {
            const outOfRange = field.validation!.max_value! + offset;

            // Server-style
            const answers: Record<string, unknown> = { [field.field_id]: outOfRange };
            const formResult = validateFormResponse([field], answers);

            // Client-style
            const fieldErrors = validateField(field, outOfRange);

            // Same decision and same errors
            expect(formResult.valid).toBe(fieldErrors.length === 0);
            expect(formResult.errors.length).toBe(fieldErrors.length);
            if (fieldErrors.length > 0) {
              expect(formResult.errors[0]!.message).toBe(fieldErrors[0]!.message);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('consistency holds for text exceeding max_length', () => {
      fc.assert(
        fc.property(
          arbTextFieldWithMaxLength,
          fc.integer({ min: 1, max: 200 }),
          (field, excess) => {
            const tooLong = 'x'.repeat(field.validation!.max_length! + excess);

            // Server-style
            const answers: Record<string, unknown> = { [field.field_id]: tooLong };
            const formResult = validateFormResponse([field], answers);

            // Client-style
            const fieldErrors = validateField(field, tooLong);

            // Same decision and same errors
            expect(formResult.valid).toBe(fieldErrors.length === 0);
            expect(formResult.errors.length).toBe(fieldErrors.length);
            if (fieldErrors.length > 0) {
              expect(formResult.errors[0]!.message).toBe(fieldErrors[0]!.message);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
