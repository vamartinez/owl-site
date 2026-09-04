import { describe, it, expect } from 'vitest';
import { validateField, validateFormResponse } from '../form-validation';
import { FieldType } from '../types';
import type { FieldConfig, FileMetadata, FieldValidationError } from '../types';

/** Helper to safely access first error */
function firstError(errors: FieldValidationError[]): FieldValidationError {
  const err = errors[0];
  if (!err) throw new Error('Expected at least one error');
  return err;
}

// ─── Helper Factories ─────────────────────────────────────────────────────────

function makeField(overrides: Partial<FieldConfig> & { field_id: string; type: FieldType; label: string }): FieldConfig {
  return {
    required: false,
    order: 1,
    ...overrides,
  };
}

// ─── Required Field Validation ────────────────────────────────────────────────

describe('validateField — required check', () => {
  it('returns error for required text field with empty string', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.TEXTO_CORTO,
      label: 'Nombre',
      required: true,
    });

    const errors = validateField(field, '');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('obligatorio');
    expect(firstError(errors).field_id).toBe('f1');
  });

  it('returns error for required text field with whitespace-only string', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.TEXTO_CORTO,
      label: 'Nombre',
      required: true,
    });

    const errors = validateField(field, '   ');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('obligatorio');
  });

  it('returns no error for optional empty field', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.TEXTO_CORTO,
      label: 'Nombre',
      required: false,
    });

    const errors = validateField(field, '');
    expect(errors).toHaveLength(0);
  });

  it('returns error for required numeric field with null', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.NUMERO,
      label: 'Edad',
      required: true,
    });

    const errors = validateField(field, null);
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('obligatorio');
  });

  it('returns error for required checkbox that is false', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.CHECKBOX_ACEPTACION,
      label: 'Acepto',
      required: true,
    });

    const errors = validateField(field, false);
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('obligatorio');
  });

  it('returns error for required multiple selection with empty array', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.SELECCION_MULTIPLE,
      label: 'Opciones',
      required: true,
      options: [
        { option_id: 'a', label: 'A' },
        { option_id: 'b', label: 'B' },
      ],
    });

    const errors = validateField(field, []);
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('obligatorio');
  });
});

// ─── Text Validation ──────────────────────────────────────────────────────────

describe('validateField — text validation', () => {
  it('returns error when text exceeds max_length', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.TEXTO_CORTO,
      label: 'Código',
      validation: { max_length: 5 },
    });

    const errors = validateField(field, 'abcdef');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('5');
    expect(firstError(errors).message).toContain('6');
  });

  it('returns error when text is below min_length', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.TEXTO_CORTO,
      label: 'Código',
      validation: { min_length: 3 },
    });

    const errors = validateField(field, 'ab');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('3');
  });

  it('returns error when text does not match pattern', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.TEXTO_CORTO,
      label: 'Email',
      validation: { pattern: '^[a-z]+@[a-z]+\\.[a-z]+$' },
    });

    const errors = validateField(field, 'not-an-email');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('formato');
  });

  it('passes valid text within constraints', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.TEXTO_CORTO,
      label: 'Código',
      validation: { min_length: 2, max_length: 10 },
    });

    const errors = validateField(field, 'hello');
    expect(errors).toHaveLength(0);
  });
});

// ─── Numeric Validation ───────────────────────────────────────────────────────

describe('validateField — numeric validation', () => {
  it('returns error for non-numeric value', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.NUMERO,
      label: 'Cantidad',
    });

    const errors = validateField(field, 'abc');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('numérico');
  });

  it('returns error when value is below min_value', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.NUMERO,
      label: 'Edad',
      validation: { min_value: 18, max_value: 100 },
    });

    const errors = validateField(field, 10);
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('18');
    expect(firstError(errors).message).toContain('100');
  });

  it('returns error when value exceeds max_value', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.NUMERO,
      label: 'Edad',
      validation: { min_value: 18, max_value: 100 },
    });

    const errors = validateField(field, 150);
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('18');
    expect(firstError(errors).message).toContain('100');
  });

  it('passes valid numeric value within range', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.NUMERO,
      label: 'Edad',
      validation: { min_value: 18, max_value: 100 },
    });

    const errors = validateField(field, 25);
    expect(errors).toHaveLength(0);
  });

  it('accepts string representation of number', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.NUMERO,
      label: 'Cantidad',
      validation: { min_value: 0, max_value: 1000 },
    });

    const errors = validateField(field, '42');
    expect(errors).toHaveLength(0);
  });
});

// ─── Date Validation ──────────────────────────────────────────────────────────

describe('validateField — date validation', () => {
  it('returns error for invalid date format', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.FECHA,
      label: 'Fecha inicio',
    });

    const errors = validateField(field, '12/31/2024');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('YYYY-MM-DD');
  });

  it('returns error for invalid date (Feb 30)', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.FECHA,
      label: 'Fecha',
    });

    const errors = validateField(field, '2024-02-30');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('inválida');
  });

  it('returns error when date is before min_date', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.FECHA,
      label: 'Fecha',
      validation: { min_date: '2024-01-01' },
    });

    const errors = validateField(field, '2023-12-31');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('2024-01-01');
  });

  it('returns error when date is after max_date', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.FECHA,
      label: 'Fecha',
      validation: { max_date: '2024-12-31' },
    });

    const errors = validateField(field, '2025-01-01');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('2024-12-31');
  });

  it('passes valid date within range', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.FECHA,
      label: 'Fecha',
      validation: { min_date: '2024-01-01', max_date: '2024-12-31' },
    });

    const errors = validateField(field, '2024-06-15');
    expect(errors).toHaveLength(0);
  });
});

// ─── File Validation ──────────────────────────────────────────────────────────

describe('validateField — file validation', () => {
  it('returns error for invalid file type', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.CARGA_ARCHIVO,
      label: 'Documento',
    });

    const fileMeta: FileMetadata = {
      filename: 'doc.exe',
      size_bytes: 1024,
      content_type: 'application/x-msdownload',
    };

    const errors = validateField(field, 'file-key', fileMeta);
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('PDF');
    expect(firstError(errors).message).toContain('JPEG');
    expect(firstError(errors).message).toContain('PNG');
  });

  it('returns error for file exceeding max size', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.CARGA_ARCHIVO,
      label: 'Documento',
    });

    const fileMeta: FileMetadata = {
      filename: 'large.pdf',
      size_bytes: 15 * 1024 * 1024, // 15 MB
      content_type: 'application/pdf',
    };

    const errors = validateField(field, 'file-key', fileMeta);
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('10 MB');
  });

  it('passes valid PDF file under size limit', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.CARGA_ARCHIVO,
      label: 'Documento',
    });

    const fileMeta: FileMetadata = {
      filename: 'doc.pdf',
      size_bytes: 5 * 1024 * 1024, // 5 MB
      content_type: 'application/pdf',
    };

    const errors = validateField(field, 'file-key', fileMeta);
    expect(errors).toHaveLength(0);
  });

  it('accepts JPEG images', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.CARGA_ARCHIVO,
      label: 'Foto',
    });

    const fileMeta: FileMetadata = {
      filename: 'photo.jpg',
      size_bytes: 2 * 1024 * 1024,
      content_type: 'image/jpeg',
    };

    const errors = validateField(field, 'file-key', fileMeta);
    expect(errors).toHaveLength(0);
  });
});

// ─── Selection Validation ─────────────────────────────────────────────────────

describe('validateField — selection validation', () => {
  it('returns error for invalid single selection option', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.SELECCION_SIMPLE,
      label: 'Tipo',
      options: [
        { option_id: 'opt1', label: 'Opción 1' },
        { option_id: 'opt2', label: 'Opción 2' },
      ],
    });

    const errors = validateField(field, 'invalid-option');
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('no válida');
  });

  it('passes valid single selection', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.SELECCION_SIMPLE,
      label: 'Tipo',
      options: [
        { option_id: 'opt1', label: 'Opción 1' },
        { option_id: 'opt2', label: 'Opción 2' },
      ],
    });

    const errors = validateField(field, 'opt1');
    expect(errors).toHaveLength(0);
  });

  it('returns error for invalid multiple selection options', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.SELECCION_MULTIPLE,
      label: 'Categorías',
      options: [
        { option_id: 'a', label: 'A' },
        { option_id: 'b', label: 'B' },
      ],
    });

    const errors = validateField(field, ['a', 'invalid']);
    expect(errors).toHaveLength(1);
    expect(firstError(errors).message).toContain('no válidas');
  });

  it('passes valid multiple selection', () => {
    const field = makeField({
      field_id: 'f1',
      type: FieldType.SELECCION_MULTIPLE,
      label: 'Categorías',
      options: [
        { option_id: 'a', label: 'A' },
        { option_id: 'b', label: 'B' },
        { option_id: 'c', label: 'C' },
      ],
    });

    const errors = validateField(field, ['a', 'c']);
    expect(errors).toHaveLength(0);
  });
});

// ─── Full Form Validation (all errors simultaneously) ─────────────────────────

describe('validateFormResponse — simultaneous errors', () => {
  it('returns all errors simultaneously for multiple invalid fields', () => {
    const fields: FieldConfig[] = [
      makeField({
        field_id: 'f1',
        type: FieldType.TEXTO_CORTO,
        label: 'Nombre',
        required: true,
      }),
      makeField({
        field_id: 'f2',
        type: FieldType.NUMERO,
        label: 'Edad',
        required: true,
        order: 2,
      }),
      makeField({
        field_id: 'f3',
        type: FieldType.FECHA,
        label: 'Fecha',
        required: true,
        order: 3,
      }),
    ];

    const result = validateFormResponse(fields, {});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.map((e) => e.field_id)).toEqual(['f1', 'f2', 'f3']);
  });

  it('returns valid result when all fields pass', () => {
    const fields: FieldConfig[] = [
      makeField({
        field_id: 'f1',
        type: FieldType.TEXTO_CORTO,
        label: 'Nombre',
        required: true,
      }),
      makeField({
        field_id: 'f2',
        type: FieldType.NUMERO,
        label: 'Edad',
        required: true,
        order: 2,
        validation: { min_value: 0, max_value: 150 },
      }),
    ];

    const result = validateFormResponse(fields, { f1: 'Juan', f2: 25 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns errors for both required and validation rule violations', () => {
    const fields: FieldConfig[] = [
      makeField({
        field_id: 'f1',
        type: FieldType.TEXTO_CORTO,
        label: 'Nombre',
        required: true,
      }),
      makeField({
        field_id: 'f2',
        type: FieldType.NUMERO,
        label: 'Edad',
        required: false,
        order: 2,
        validation: { min_value: 18, max_value: 100 },
      }),
    ];

    // f1 is empty (required), f2 has invalid value (out of range)
    const result = validateFormResponse(fields, { f2: 150 });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);

    const err0 = result.errors[0]!;
    const err1 = result.errors[1]!;
    expect(err0.field_id).toBe('f1');
    expect(err0.message).toContain('obligatorio');
    expect(err1.field_id).toBe('f2');
    expect(err1.message).toContain('18');
  });
});
