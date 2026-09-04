/**
 * Unit tests for the form-validation module.
 *
 * Tests validation of submitted form response values for all 8 field types:
 * texto_corto, texto_largo, numero, fecha, seleccion_simple,
 * seleccion_multiple, checkbox_aceptacion, carga_archivo.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7
 */

import { describe, it, expect } from 'vitest';
import {
  validateFormResponse,
  validateField,
} from '../../src/services/forms/form-validation.js';
import { FieldType } from '../../src/services/forms/types.js';
import type { FieldConfig } from '../../src/services/forms/types.js';
import type { FileMetadata } from '../../src/services/forms/form-validation.js';

// ─── Helper Factories ─────────────────────────────────────────────────────────

function makeField(overrides: Partial<FieldConfig> & { type: FieldType }): FieldConfig {
  return {
    field_id: 'field-1',
    label: 'Test Field',
    required: false,
    order: 1,
    ...overrides,
  };
}

// ─── Required Check (Req 10.1) ───────────────────────────────────────────────

describe('form-validation: Required check', () => {
  it('returns error for required text field with empty string', () => {
    const field = makeField({ type: FieldType.TEXTO_CORTO, required: true });
    const errors = validateField(field, '');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('obligatorio');
  });

  it('returns error for required text field with whitespace-only string', () => {
    const field = makeField({ type: FieldType.TEXTO_CORTO, required: true });
    const errors = validateField(field, '   ');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('obligatorio');
  });

  it('returns error for required text field with null', () => {
    const field = makeField({ type: FieldType.TEXTO_CORTO, required: true });
    const errors = validateField(field, null);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('obligatorio');
  });

  it('returns error for required text field with undefined', () => {
    const field = makeField({ type: FieldType.TEXTO_CORTO, required: true });
    const errors = validateField(field, undefined);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('obligatorio');
  });

  it('returns no error for non-required field with empty value', () => {
    const field = makeField({ type: FieldType.TEXTO_CORTO, required: false });
    const errors = validateField(field, '');
    expect(errors).toHaveLength(0);
  });

  it('returns error for required checkbox with false value', () => {
    const field = makeField({ type: FieldType.CHECKBOX_ACEPTACION, required: true });
    const errors = validateField(field, false);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('obligatorio');
  });

  it('returns no error for required checkbox with true value', () => {
    const field = makeField({ type: FieldType.CHECKBOX_ACEPTACION, required: true });
    const errors = validateField(field, true);
    expect(errors).toHaveLength(0);
  });

  it('returns error for required multiple selection with empty array', () => {
    const field = makeField({
      type: FieldType.SELECCION_MULTIPLE,
      required: true,
      options: [
        { option_id: 'opt-1', label: 'A' },
        { option_id: 'opt-2', label: 'B' },
      ],
    });
    const errors = validateField(field, []);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('obligatorio');
  });
});

// ─── Text Validation (Req 10.3) ──────────────────────────────────────────────

describe('form-validation: Text fields', () => {
  it('accepts valid text within length limits', () => {
    const field = makeField({
      type: FieldType.TEXTO_CORTO,
      validation: { min_length: 3, max_length: 100 },
    });
    const errors = validateField(field, 'Hello world');
    expect(errors).toHaveLength(0);
  });

  it('rejects text shorter than min_length', () => {
    const field = makeField({
      type: FieldType.TEXTO_CORTO,
      validation: { min_length: 5 },
    });
    const errors = validateField(field, 'Hi');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('5');
    expect(errors[0]!.message).toContain('al menos');
  });

  it('rejects text exceeding max_length and reports the limit and current length', () => {
    const field = makeField({
      type: FieldType.TEXTO_LARGO,
      validation: { max_length: 10 },
    });
    const errors = validateField(field, 'This is too long text');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('10');
    expect(errors[0]!.message).toContain('21'); // current length
  });

  it('rejects text not matching pattern', () => {
    const field = makeField({
      type: FieldType.TEXTO_CORTO,
      validation: { pattern: '^[A-Z]+$' },
    });
    const errors = validateField(field, 'lowercase');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('formato');
  });

  it('accepts text matching pattern', () => {
    const field = makeField({
      type: FieldType.TEXTO_CORTO,
      validation: { pattern: '^[A-Z]+$' },
    });
    const errors = validateField(field, 'UPPERCASE');
    expect(errors).toHaveLength(0);
  });

  it('reports multiple text errors simultaneously', () => {
    const field = makeField({
      type: FieldType.TEXTO_CORTO,
      validation: { min_length: 50, pattern: '^[0-9]+$' },
    });
    const errors = validateField(field, 'abc');
    // Should have both min_length and pattern errors
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Numeric Validation (Req 10.2) ───────────────────────────────────────────

describe('form-validation: Numeric fields', () => {
  it('accepts valid number within range', () => {
    const field = makeField({
      type: FieldType.NUMERO,
      validation: { min_value: 0, max_value: 100 },
    });
    const errors = validateField(field, 50);
    expect(errors).toHaveLength(0);
  });

  it('accepts number as string', () => {
    const field = makeField({
      type: FieldType.NUMERO,
      validation: { min_value: 0, max_value: 100 },
    });
    const errors = validateField(field, '42');
    expect(errors).toHaveLength(0);
  });

  it('rejects non-numeric value', () => {
    const field = makeField({ type: FieldType.NUMERO });
    const errors = validateField(field, 'not a number');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('numérico');
  });

  it('rejects value below min and reports both min and max', () => {
    const field = makeField({
      type: FieldType.NUMERO,
      validation: { min_value: 10, max_value: 100 },
    });
    const errors = validateField(field, 5);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('10');
    expect(errors[0]!.message).toContain('100');
  });

  it('rejects value above max and reports both min and max', () => {
    const field = makeField({
      type: FieldType.NUMERO,
      validation: { min_value: 10, max_value: 100 },
    });
    const errors = validateField(field, 150);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('10');
    expect(errors[0]!.message).toContain('100');
  });

  it('rejects value below min_value when only min is set', () => {
    const field = makeField({
      type: FieldType.NUMERO,
      validation: { min_value: 5 },
    });
    const errors = validateField(field, 2);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('5');
  });

  it('rejects value above max_value when only max is set', () => {
    const field = makeField({
      type: FieldType.NUMERO,
      validation: { max_value: 50 },
    });
    const errors = validateField(field, 100);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('50');
  });

  it('accepts boundary values (min and max)', () => {
    const field = makeField({
      type: FieldType.NUMERO,
      validation: { min_value: 0, max_value: 100 },
    });
    expect(validateField(field, 0)).toHaveLength(0);
    expect(validateField(field, 100)).toHaveLength(0);
  });
});

// ─── Date Validation (Req 10.5) ──────────────────────────────────────────────

describe('form-validation: Date fields', () => {
  it('accepts valid ISO date', () => {
    const field = makeField({ type: FieldType.FECHA });
    const errors = validateField(field, '2024-06-15');
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid date format', () => {
    const field = makeField({ type: FieldType.FECHA });
    const errors = validateField(field, '15/06/2024');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('YYYY-MM-DD');
  });

  it('rejects invalid date (e.g., Feb 30)', () => {
    const field = makeField({ type: FieldType.FECHA });
    const errors = validateField(field, '2024-02-30');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('inválida');
  });

  it('rejects date before min_date', () => {
    const field = makeField({
      type: FieldType.FECHA,
      validation: { min_date: '2024-01-01' },
    });
    const errors = validateField(field, '2023-12-31');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('2024-01-01');
  });

  it('rejects date after max_date', () => {
    const field = makeField({
      type: FieldType.FECHA,
      validation: { max_date: '2024-12-31' },
    });
    const errors = validateField(field, '2025-01-01');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('2024-12-31');
  });

  it('accepts date within range', () => {
    const field = makeField({
      type: FieldType.FECHA,
      validation: { min_date: '2024-01-01', max_date: '2024-12-31' },
    });
    const errors = validateField(field, '2024-06-15');
    expect(errors).toHaveLength(0);
  });
});

// ─── Selection Validation ─────────────────────────────────────────────────────

describe('form-validation: Selection fields', () => {
  const options = [
    { option_id: 'opt-1', label: 'Option A' },
    { option_id: 'opt-2', label: 'Option B' },
    { option_id: 'opt-3', label: 'Option C' },
  ];

  it('accepts valid single selection', () => {
    const field = makeField({ type: FieldType.SELECCION_SIMPLE, options });
    const errors = validateField(field, 'opt-1');
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid single selection option', () => {
    const field = makeField({ type: FieldType.SELECCION_SIMPLE, options });
    const errors = validateField(field, 'opt-invalid');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('no válida');
  });

  it('accepts valid multiple selection', () => {
    const field = makeField({ type: FieldType.SELECCION_MULTIPLE, options });
    const errors = validateField(field, ['opt-1', 'opt-3']);
    expect(errors).toHaveLength(0);
  });

  it('rejects multiple selection with invalid options', () => {
    const field = makeField({ type: FieldType.SELECCION_MULTIPLE, options });
    const errors = validateField(field, ['opt-1', 'opt-invalid']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('no válidas');
  });

  it('rejects non-array value for multiple selection', () => {
    const field = makeField({ type: FieldType.SELECCION_MULTIPLE, options });
    const errors = validateField(field, 'opt-1');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('lista');
  });
});

// ─── File Validation (Req 10.4) ──────────────────────────────────────────────

describe('form-validation: File fields', () => {
  it('accepts valid PDF file', () => {
    const field = makeField({ type: FieldType.CARGA_ARCHIVO });
    const fileMeta: FileMetadata = {
      filename: 'doc.pdf',
      size_bytes: 5 * 1024 * 1024, // 5 MB
      content_type: 'application/pdf',
    };
    const errors = validateField(field, 'file-key-123', fileMeta);
    expect(errors).toHaveLength(0);
  });

  it('accepts valid JPEG file', () => {
    const field = makeField({ type: FieldType.CARGA_ARCHIVO });
    const fileMeta: FileMetadata = {
      filename: 'photo.jpg',
      size_bytes: 2 * 1024 * 1024,
      content_type: 'image/jpeg',
    };
    const errors = validateField(field, 'file-key-123', fileMeta);
    expect(errors).toHaveLength(0);
  });

  it('accepts valid PNG file', () => {
    const field = makeField({ type: FieldType.CARGA_ARCHIVO });
    const fileMeta: FileMetadata = {
      filename: 'image.png',
      size_bytes: 1 * 1024 * 1024,
      content_type: 'image/png',
    };
    const errors = validateField(field, 'file-key-123', fileMeta);
    expect(errors).toHaveLength(0);
  });

  it('rejects file with invalid type', () => {
    const field = makeField({ type: FieldType.CARGA_ARCHIVO });
    const fileMeta: FileMetadata = {
      filename: 'script.exe',
      size_bytes: 1 * 1024 * 1024,
      content_type: 'application/x-msdownload',
    };
    const errors = validateField(field, 'file-key-123', fileMeta);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('PDF');
    expect(errors[0]!.message).toContain('JPEG');
    expect(errors[0]!.message).toContain('PNG');
  });

  it('rejects file exceeding 10 MB', () => {
    const field = makeField({ type: FieldType.CARGA_ARCHIVO });
    const fileMeta: FileMetadata = {
      filename: 'large.pdf',
      size_bytes: 11 * 1024 * 1024, // 11 MB
      content_type: 'application/pdf',
    };
    const errors = validateField(field, 'file-key-123', fileMeta);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('10 MB');
  });

  it('rejects file with both invalid type and size', () => {
    const field = makeField({ type: FieldType.CARGA_ARCHIVO });
    const fileMeta: FileMetadata = {
      filename: 'large.exe',
      size_bytes: 15 * 1024 * 1024,
      content_type: 'application/x-msdownload',
    };
    const errors = validateField(field, 'file-key-123', fileMeta);
    expect(errors).toHaveLength(2);
  });
});

// ─── Checkbox Validation ──────────────────────────────────────────────────────

describe('form-validation: Checkbox fields', () => {
  it('accepts true for required checkbox', () => {
    const field = makeField({ type: FieldType.CHECKBOX_ACEPTACION, required: true });
    const errors = validateField(field, true);
    expect(errors).toHaveLength(0);
  });

  it('accepts false for non-required checkbox', () => {
    const field = makeField({ type: FieldType.CHECKBOX_ACEPTACION, required: false });
    const errors = validateField(field, false);
    expect(errors).toHaveLength(0);
  });

  it('rejects non-boolean value', () => {
    const field = makeField({ type: FieldType.CHECKBOX_ACEPTACION });
    const errors = validateField(field, 'yes');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('verdadero o falso');
  });
});

// ─── Full Form Validation (Req 10.1 — all errors simultaneously) ─────────────

describe('form-validation: validateFormResponse', () => {
  it('returns all errors simultaneously for multiple invalid fields', () => {
    const fields: FieldConfig[] = [
      makeField({ field_id: 'f1', type: FieldType.TEXTO_CORTO, required: true, label: 'Nombre' }),
      makeField({ field_id: 'f2', type: FieldType.NUMERO, required: true, label: 'Edad' }),
      makeField({ field_id: 'f3', type: FieldType.FECHA, required: true, label: 'Fecha' }),
    ];

    const answers: Record<string, unknown> = {
      f1: '',
      f2: null,
      f3: undefined,
    };

    const result = validateFormResponse(fields, answers);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]!.field_id).toBe('f1');
    expect(result.errors[1]!.field_id).toBe('f2');
    expect(result.errors[2]!.field_id).toBe('f3');
  });

  it('returns valid=true when all fields pass validation', () => {
    const fields: FieldConfig[] = [
      makeField({ field_id: 'f1', type: FieldType.TEXTO_CORTO, required: true, label: 'Nombre' }),
      makeField({
        field_id: 'f2',
        type: FieldType.NUMERO,
        required: true,
        label: 'Edad',
        validation: { min_value: 0, max_value: 150 },
      }),
    ];

    const answers: Record<string, unknown> = {
      f1: 'Juan',
      f2: 30,
    };

    const result = validateFormResponse(fields, answers);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates file fields using fileMetadata parameter', () => {
    const fields: FieldConfig[] = [
      makeField({ field_id: 'f1', type: FieldType.CARGA_ARCHIVO, required: true, label: 'Documento' }),
    ];

    const answers: Record<string, unknown> = {
      f1: 'file-key-abc',
    };

    const fileMetadata: Record<string, FileMetadata> = {
      f1: {
        filename: 'doc.pdf',
        size_bytes: 5 * 1024 * 1024,
        content_type: 'application/pdf',
      },
    };

    const result = validateFormResponse(fields, answers, fileMetadata);
    expect(result.valid).toBe(true);
  });

  it('skips validation for non-required fields with missing answers', () => {
    const fields: FieldConfig[] = [
      makeField({ field_id: 'f1', type: FieldType.TEXTO_CORTO, required: false, label: 'Opcional' }),
      makeField({ field_id: 'f2', type: FieldType.NUMERO, required: false, label: 'Número' }),
    ];

    const answers: Record<string, unknown> = {};

    const result = validateFormResponse(fields, answers);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('includes field_id and field_label in each error', () => {
    const fields: FieldConfig[] = [
      makeField({ field_id: 'my-field', type: FieldType.TEXTO_CORTO, required: true, label: 'Mi Campo' }),
    ];

    const result = validateFormResponse(fields, { 'my-field': '' });
    expect(result.errors[0]!.field_id).toBe('my-field');
    expect(result.errors[0]!.field_label).toBe('Mi Campo');
  });
});
