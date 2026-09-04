// Feature: contractor-forms-qr, Property 23: Exportación CSV estructura correcta
// Feature: contractor-forms-qr, Property 24: CSV multi-versión unifica columnas

/**
 * Property-based tests for CSV export module.
 *
 * Property 23: For any form with responses, the exported CSV must:
 * - Be encoded in UTF-8 with BOM
 * - Have a header row with columns [folio, fecha_envio, ...field labels]
 * - Have exactly one data row per response
 * - Represent multiple selection values separated by semicolons
 *
 * Property 24: For any form with multiple versions, the exported CSV must:
 * - Contain the union of all columns from all versions
 * - Have empty cells for responses where the field didn't exist in that version
 *
 * **Validates: Requirements 13.1, 13.2, 13.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { FieldType } from '../../src/services/forms/types.js';
import type { FieldConfig, FormResponse, FormVersion } from '../../src/services/forms/types.js';
import { generateCsv, buildUnifiedColumns, formatCellValue } from '../../src/services/forms/form-export.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const UTF8_BOM = '\uFEFF';

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid field labels (1-200 chars, no commas/quotes/newlines for simpler CSV testing) */
const arbSafeLabel = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-'.split('')), {
    minLength: 1,
    maxLength: 50,
  })
  .filter((s) => s.trim().length >= 1);

/** Arbitrary for field labels that may contain CSV-special characters */
const arbLabel = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length >= 1);

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
const arbNonSelectionField = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom(...NON_SELECTION_TYPES),
    arbSafeLabel,
    fc.boolean(),
    fc.integer({ min: 1, max: 50 }),
  )
  .map(([field_id, type, label, required, order]): FieldConfig => ({
    field_id,
    type,
    label,
    required,
    order,
  }));

/** Arbitrary for a valid selection field */
const arbSelectionField = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom(FieldType.SELECCION_SIMPLE, FieldType.SELECCION_MULTIPLE),
    arbSafeLabel,
    fc.boolean(),
    fc.integer({ min: 1, max: 50 }),
    fc.array(
      fc.record({ option_id: fc.uuid(), label: arbSafeLabel }),
      { minLength: 2, maxLength: 5 },
    ),
  )
  .map(([field_id, type, label, required, order, options]): FieldConfig => ({
    field_id,
    type,
    label,
    required,
    order,
    options,
  }));

/** Arbitrary for any valid field */
const arbField = fc.oneof(arbNonSelectionField, arbSelectionField);

/** Arbitrary for a valid fields array (1-8 fields for performance) */
const arbFieldsArray = fc.array(arbField, { minLength: 1, maxLength: 8 });

/** Arbitrary for a folio (8 alphanumeric chars) */
const arbFolio = fc
  .stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), {
    minLength: 8,
    maxLength: 8,
  });

/** Arbitrary for ISO 8601 UTC timestamp */
const arbTimestamp = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map((d) => d.toISOString());

/** Arbitrary for a simple text answer value */
const arbTextValue = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')), {
    minLength: 1,
    maxLength: 50,
  });

/** Arbitrary for multiple selection answer (array of option labels) */
const arbMultiSelectValue = fc.array(arbTextValue, { minLength: 1, maxLength: 5 });

/** Generate a FormResponse with answers matching given fields */
function arbResponseForFields(fields: FieldConfig[]): fc.Arbitrary<FormResponse> {
  return fc
    .tuple(fc.uuid(), fc.uuid(), arbFolio, arbTimestamp, fc.uuid(), fc.integer({ min: 1, max: 10 }))
    .map(([response_id, form_id, folio, submitted_at, tenant_id, version_number]) => {
      const answers: Record<string, unknown> = {};
      for (const field of fields) {
        if (field.type === FieldType.SELECCION_MULTIPLE) {
          // Generate array values for multi-select
          answers[field.field_id] = ['Opcion1', 'Opcion2'];
        } else if (field.type === FieldType.NUMERO) {
          answers[field.field_id] = 42;
        } else if (field.type === FieldType.CHECKBOX_ACEPTACION) {
          answers[field.field_id] = true;
        } else {
          answers[field.field_id] = 'respuesta';
        }
      }
      return {
        response_id,
        form_id,
        version_number,
        folio,
        submitted_at,
        answers,
        metadata: { origin_type: 'url_directa', user_agent: 'test', ip_address: '127.0.0.1' },
        tenant_id,
      };
    });
}

/** Arbitrary for a FormVersion */
function arbVersion(formId: string, versionNumber: number, fields: FieldConfig[]): FormVersion {
  return {
    form_id: formId,
    version_number: versionNumber,
    fields_snapshot: fields,
    created_at: new Date().toISOString(),
    created_by: 'user-test',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Forms CSV Export Property Tests', () => {
  // **Validates: Requirements 13.1, 13.2**
  describe('Property 23: Exportación CSV estructura correcta', () => {
    it('CSV output starts with UTF-8 BOM', () => {
      fc.assert(
        fc.property(
          arbFieldsArray,
          fc.integer({ min: 0, max: 5 }),
          (fields, responseCount) => {
            const columns = fields.map((f) => ({
              field_id: f.field_id,
              label: f.label,
              type: f.type,
            }));

            const responses: FormResponse[] = [];
            for (let i = 0; i < responseCount; i++) {
              const answers: Record<string, unknown> = {};
              for (const field of fields) {
                if (field.type === FieldType.SELECCION_MULTIPLE) {
                  answers[field.field_id] = ['A', 'B'];
                } else {
                  answers[field.field_id] = 'val';
                }
              }
              responses.push({
                response_id: `resp-${i}`,
                form_id: 'form-1',
                version_number: 1,
                folio: `FOLIO${String(i).padStart(3, '0')}`,
                submitted_at: '2024-01-01T00:00:00.000Z',
                answers,
                metadata: { origin_type: 'url_directa', user_agent: 'test', ip_address: '127.0.0.1' },
                tenant_id: 'tenant-1',
              });
            }

            const csv = generateCsv(columns, responses);

            // Must start with UTF-8 BOM
            expect(csv.charCodeAt(0)).toBe(0xFEFF);
            expect(csv.startsWith(UTF8_BOM)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('CSV header row contains folio, fecha_envio, and all field labels', () => {
      fc.assert(
        fc.property(
          arbFieldsArray,
          (fields) => {
            const columns = fields.map((f) => ({
              field_id: f.field_id,
              label: f.label,
              type: f.type,
            }));

            const csv = generateCsv(columns, []);

            // Remove BOM and get the header line
            const content = csv.slice(1); // Remove BOM
            const lines = content.split('\r\n');
            const headerLine = lines[0];

            // Parse the header (handle CSV escaping)
            const expectedHeaders = ['folio', 'fecha_envio', ...fields.map((f) => f.label)];

            // Verify each expected header is present in the header line
            for (const header of expectedHeaders) {
              // The header may be escaped with quotes if it contains special chars
              const escaped = header.includes(',') || header.includes('"') || header.includes('\n') || header.includes('\r')
                ? `"${header.replace(/"/g, '""')}"`
                : header;
              expect(headerLine).toContain(escaped);
            }

            // Verify the number of columns matches
            // Simple count: split by comma (this works for safe labels without commas)
            const headerColumns = parseCsvRow(headerLine!);
            expect(headerColumns.length).toBe(2 + fields.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('CSV has exactly one data row per response', () => {
      fc.assert(
        fc.property(
          arbFieldsArray,
          fc.integer({ min: 1, max: 10 }),
          (fields, responseCount) => {
            const columns = fields.map((f) => ({
              field_id: f.field_id,
              label: f.label,
              type: f.type,
            }));

            const responses: FormResponse[] = [];
            for (let i = 0; i < responseCount; i++) {
              const answers: Record<string, unknown> = {};
              for (const field of fields) {
                answers[field.field_id] = 'value';
              }
              responses.push({
                response_id: `resp-${i}`,
                form_id: 'form-1',
                version_number: 1,
                folio: `F${String(i).padStart(7, '0')}`,
                submitted_at: '2024-06-15T10:30:00.000Z',
                answers,
                metadata: { origin_type: 'qr', user_agent: 'Mozilla/5.0', ip_address: '192.168.1.1' },
                tenant_id: 'tenant-1',
              });
            }

            const csv = generateCsv(columns, responses);

            // Remove BOM and split by CRLF
            const content = csv.slice(1);
            const lines = content.split('\r\n').filter((l) => l.length > 0);

            // First line is header, rest are data rows
            // lines count = 1 header + responseCount data rows
            expect(lines.length).toBe(1 + responseCount);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('multiple selection values are separated by semicolons', () => {
      fc.assert(
        fc.property(
          arbMultiSelectValue,
          fc.uuid(),
          (selectedValues, fieldId) => {
            const column = {
              field_id: fieldId,
              label: 'Multi Select Field',
              type: FieldType.SELECCION_MULTIPLE,
            };

            const answers: Record<string, unknown> = {
              [fieldId]: selectedValues,
            };

            const cellValue = formatCellValue(answers, column);

            // Values must be joined with semicolons
            expect(cellValue).toBe(selectedValues.join(';'));

            // Verify semicolons separate the values
            if (selectedValues.length > 1) {
              expect(cellValue).toContain(';');
              const parts = cellValue.split(';');
              expect(parts.length).toBe(selectedValues.length);
              for (let i = 0; i < selectedValues.length; i++) {
                expect(parts[i]).toBe(selectedValues[i]);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('CSV with no responses produces headers-only output', () => {
      fc.assert(
        fc.property(
          arbFieldsArray,
          (fields) => {
            const columns = fields.map((f) => ({
              field_id: f.field_id,
              label: f.label,
              type: f.type,
            }));

            const csv = generateCsv(columns, []);

            // Remove BOM
            const content = csv.slice(1);
            const lines = content.split('\r\n').filter((l) => l.length > 0);

            // Only the header row should exist
            expect(lines.length).toBe(1);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 13.3**
  describe('Property 24: CSV multi-versión unifica columnas', () => {
    it('unified columns contain all unique fields from all versions', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          arbFieldsArray,
          arbFieldsArray,
          (formId, fieldsV1, fieldsV2) => {
            const version1 = arbVersion(formId, 1, fieldsV1);
            const version2 = arbVersion(formId, 2, fieldsV2);

            const columns = buildUnifiedColumns([version1, version2]);

            // All field_ids from both versions must be present in columns
            const allFieldIds = new Set([
              ...fieldsV1.map((f) => f.field_id),
              ...fieldsV2.map((f) => f.field_id),
            ]);

            const columnFieldIds = new Set(columns.map((c) => c.field_id));

            for (const fieldId of allFieldIds) {
              expect(columnFieldIds.has(fieldId)).toBe(true);
            }

            // Number of columns equals number of unique field_ids
            expect(columns.length).toBe(allFieldIds.size);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('responses have empty cells for fields not present in their version', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          arbFieldsArray,
          arbFieldsArray,
          (formId, fieldsV1, fieldsV2) => {
            // Ensure versions have at least some different fields
            const version1 = arbVersion(formId, 1, fieldsV1);
            const version2 = arbVersion(formId, 2, fieldsV2);

            const columns = buildUnifiedColumns([version1, version2]);

            // Create a response for version 1 (only has answers for fieldsV1)
            const answersV1: Record<string, unknown> = {};
            for (const field of fieldsV1) {
              answersV1[field.field_id] = 'answer_v1';
            }

            const responseV1: FormResponse = {
              response_id: 'resp-v1',
              form_id: formId,
              version_number: 1,
              folio: 'ABCD1234',
              submitted_at: '2024-01-01T00:00:00.000Z',
              answers: answersV1,
              metadata: { origin_type: 'url_directa', user_agent: 'test', ip_address: '127.0.0.1' },
              tenant_id: 'tenant-1',
            };

            // For fields that exist only in version 2 (not in version 1),
            // the response from version 1 should have empty cells
            const v1FieldIds = new Set(fieldsV1.map((f) => f.field_id));
            const v2OnlyFieldIds = fieldsV2
              .map((f) => f.field_id)
              .filter((id) => !v1FieldIds.has(id));

            for (const fieldId of v2OnlyFieldIds) {
              const column = columns.find((c) => c.field_id === fieldId)!;
              if (column) {
                const cellValue = formatCellValue(responseV1.answers, column);
                expect(cellValue).toBe('');
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('multi-version CSV has correct number of data rows regardless of version differences', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          arbFieldsArray,
          arbFieldsArray,
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 5 }),
          (formId, fieldsV1, fieldsV2, countV1, countV2) => {
            const version1 = arbVersion(formId, 1, fieldsV1);
            const version2 = arbVersion(formId, 2, fieldsV2);

            const columns = buildUnifiedColumns([version1, version2]);

            // Create responses for both versions
            const responses: FormResponse[] = [];

            for (let i = 0; i < countV1; i++) {
              const answers: Record<string, unknown> = {};
              for (const field of fieldsV1) {
                answers[field.field_id] = 'v1_answer';
              }
              responses.push({
                response_id: `resp-v1-${i}`,
                form_id: formId,
                version_number: 1,
                folio: `V1${String(i).padStart(6, '0')}`,
                submitted_at: '2024-01-01T00:00:00.000Z',
                answers,
                metadata: { origin_type: 'qr', user_agent: 'test', ip_address: '10.0.0.1' },
                tenant_id: 'tenant-1',
              });
            }

            for (let i = 0; i < countV2; i++) {
              const answers: Record<string, unknown> = {};
              for (const field of fieldsV2) {
                answers[field.field_id] = 'v2_answer';
              }
              responses.push({
                response_id: `resp-v2-${i}`,
                form_id: formId,
                version_number: 2,
                folio: `V2${String(i).padStart(6, '0')}`,
                submitted_at: '2024-06-01T00:00:00.000Z',
                answers,
                metadata: { origin_type: 'url_directa', user_agent: 'test', ip_address: '10.0.0.2' },
                tenant_id: 'tenant-1',
              });
            }

            const csv = generateCsv(columns, responses);

            // Remove BOM and count lines
            const content = csv.slice(1);
            const lines = content.split('\r\n').filter((l) => l.length > 0);

            // 1 header + total responses
            const totalResponses = countV1 + countV2;
            expect(lines.length).toBe(1 + totalResponses);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('labels from the latest version are used when a field appears in multiple versions', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.uuid(),
          arbSafeLabel,
          arbSafeLabel,
          (formId, fieldId, labelV1, labelV2) => {
            // Same field_id in both versions but with different labels
            const fieldV1: FieldConfig = {
              field_id: fieldId,
              type: FieldType.TEXTO_CORTO,
              label: labelV1,
              required: true,
              order: 1,
            };

            const fieldV2: FieldConfig = {
              field_id: fieldId,
              type: FieldType.TEXTO_CORTO,
              label: labelV2,
              required: true,
              order: 1,
            };

            const version1 = arbVersion(formId, 1, [fieldV1]);
            const version2 = arbVersion(formId, 2, [fieldV2]);

            const columns = buildUnifiedColumns([version1, version2]);

            // Should have exactly 1 column (same field_id)
            expect(columns.length).toBe(1);

            // Label should be from the latest version (version 2)
            expect(columns[0].label).toBe(labelV2);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

// ─── Helper: Parse CSV Row ────────────────────────────────────────────────────

/**
 * Simple CSV row parser that handles quoted fields.
 * Used for test assertions only.
 */
function parseCsvRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < row.length) {
    const char = row[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < row.length && row[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        result.push(current);
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  result.push(current);
  return result;
}
