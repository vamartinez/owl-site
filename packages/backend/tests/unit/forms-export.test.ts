/**
 * Unit tests for CSV export logic (form-export.ts).
 * Tests column unification, CSV generation, cell formatting, and error handling.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.5, 13.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FieldType } from '../../src/services/forms/types.js';
import type { FieldConfig, FormVersion, FormResponse } from '../../src/services/forms/types.js';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    PutCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    GetCommand: vi.fn().mockImplementation((params) => ({ input: params })),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

describe('forms: CSV export logic', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  // ─── buildUnifiedColumns ────────────────────────────────────────────────────

  describe('buildUnifiedColumns', () => {
    it('builds columns from a single version', async () => {
      const { buildUnifiedColumns } = await import(
        '../../src/services/forms/form-export.js'
      );

      const versions: FormVersion[] = [
        {
          form_id: 'form-1',
          version_number: 1,
          fields_snapshot: [
            { field_id: 'f1', type: FieldType.TEXTO_CORTO, label: 'Nombre', required: true, order: 1 },
            { field_id: 'f2', type: FieldType.NUMERO, label: 'Edad', required: false, order: 2 },
          ],
          created_at: '2024-01-01T00:00:00.000Z',
          created_by: 'user-1',
        },
      ];

      const columns = buildUnifiedColumns(versions);

      expect(columns).toHaveLength(2);
      expect(columns[0]).toEqual({ field_id: 'f1', label: 'Nombre', type: FieldType.TEXTO_CORTO });
      expect(columns[1]).toEqual({ field_id: 'f2', label: 'Edad', type: FieldType.NUMERO });
    });

    it('unifies columns from multiple versions without duplicates', async () => {
      const { buildUnifiedColumns } = await import(
        '../../src/services/forms/form-export.js'
      );

      const versions: FormVersion[] = [
        {
          form_id: 'form-1',
          version_number: 1,
          fields_snapshot: [
            { field_id: 'f1', type: FieldType.TEXTO_CORTO, label: 'Nombre', required: true, order: 1 },
            { field_id: 'f2', type: FieldType.NUMERO, label: 'Edad', required: false, order: 2 },
          ],
          created_at: '2024-01-01T00:00:00.000Z',
          created_by: 'user-1',
        },
        {
          form_id: 'form-1',
          version_number: 2,
          fields_snapshot: [
            { field_id: 'f1', type: FieldType.TEXTO_CORTO, label: 'Nombre Completo', required: true, order: 1 },
            { field_id: 'f3', type: FieldType.FECHA, label: 'Fecha Ingreso', required: true, order: 2 },
          ],
          created_at: '2024-02-01T00:00:00.000Z',
          created_by: 'user-1',
        },
      ];

      const columns = buildUnifiedColumns(versions);

      // f1 from v1, f2 from v1, f3 from v2
      expect(columns).toHaveLength(3);
      // f1 label updated to latest version
      expect(columns[0]).toEqual({ field_id: 'f1', label: 'Nombre Completo', type: FieldType.TEXTO_CORTO });
      expect(columns[1]).toEqual({ field_id: 'f2', label: 'Edad', type: FieldType.NUMERO });
      expect(columns[2]).toEqual({ field_id: 'f3', label: 'Fecha Ingreso', type: FieldType.FECHA });
    });

    it('preserves field order by first appearance', async () => {
      const { buildUnifiedColumns } = await import(
        '../../src/services/forms/form-export.js'
      );

      const versions: FormVersion[] = [
        {
          form_id: 'form-1',
          version_number: 1,
          fields_snapshot: [
            { field_id: 'f2', type: FieldType.NUMERO, label: 'B', required: false, order: 1 },
            { field_id: 'f1', type: FieldType.TEXTO_CORTO, label: 'A', required: true, order: 2 },
          ],
          created_at: '2024-01-01T00:00:00.000Z',
          created_by: 'user-1',
        },
      ];

      const columns = buildUnifiedColumns(versions);

      expect(columns[0].field_id).toBe('f2');
      expect(columns[1].field_id).toBe('f1');
    });
  });

  // ─── escapeCsvValue ─────────────────────────────────────────────────────────

  describe('escapeCsvValue', () => {
    it('returns plain value when no special characters', async () => {
      const { escapeCsvValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      expect(escapeCsvValue('hello')).toBe('hello');
    });

    it('wraps value in quotes when it contains a comma', async () => {
      const { escapeCsvValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      expect(escapeCsvValue('hello,world')).toBe('"hello,world"');
    });

    it('wraps value in quotes and doubles internal quotes', async () => {
      const { escapeCsvValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
    });

    it('wraps value in quotes when it contains a newline', async () => {
      const { escapeCsvValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
    });
  });

  // ─── formatCellValue ────────────────────────────────────────────────────────

  describe('formatCellValue', () => {
    it('returns empty string for undefined values', async () => {
      const { formatCellValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      const result = formatCellValue({}, { field_id: 'f1', label: 'X', type: FieldType.TEXTO_CORTO });
      expect(result).toBe('');
    });

    it('returns empty string for null values', async () => {
      const { formatCellValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      const result = formatCellValue({ f1: null }, { field_id: 'f1', label: 'X', type: FieldType.TEXTO_CORTO });
      expect(result).toBe('');
    });

    it('joins multiple selection values with semicolons', async () => {
      const { formatCellValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      const result = formatCellValue(
        { f1: ['Opción A', 'Opción B', 'Opción C'] },
        { field_id: 'f1', label: 'Selección', type: FieldType.SELECCION_MULTIPLE }
      );
      expect(result).toBe('Opción A;Opción B;Opción C');
    });

    it('converts boolean true to "Sí"', async () => {
      const { formatCellValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      const result = formatCellValue(
        { f1: true },
        { field_id: 'f1', label: 'Acepto', type: FieldType.CHECKBOX_ACEPTACION }
      );
      expect(result).toBe('Sí');
    });

    it('converts boolean false to "No"', async () => {
      const { formatCellValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      const result = formatCellValue(
        { f1: false },
        { field_id: 'f1', label: 'Acepto', type: FieldType.CHECKBOX_ACEPTACION }
      );
      expect(result).toBe('No');
    });

    it('converts numbers to string', async () => {
      const { formatCellValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      const result = formatCellValue(
        { f1: 42 },
        { field_id: 'f1', label: 'Edad', type: FieldType.NUMERO }
      );
      expect(result).toBe('42');
    });

    it('returns string values as-is', async () => {
      const { formatCellValue } = await import(
        '../../src/services/forms/form-export.js'
      );
      const result = formatCellValue(
        { f1: 'Juan Pérez' },
        { field_id: 'f1', label: 'Nombre', type: FieldType.TEXTO_CORTO }
      );
      expect(result).toBe('Juan Pérez');
    });
  });

  // ─── generateCsv ───────────────────────────────────────────────────────────

  describe('generateCsv', () => {
    it('generates CSV with UTF-8 BOM prefix', async () => {
      const { generateCsv } = await import(
        '../../src/services/forms/form-export.js'
      );

      const csv = generateCsv([], []);
      expect(csv.charCodeAt(0)).toBe(0xFEFF);
    });

    it('generates headers-only CSV when no responses exist (Req 13.5)', async () => {
      const { generateCsv } = await import(
        '../../src/services/forms/form-export.js'
      );

      const columns = [
        { field_id: 'f1', label: 'Nombre', type: FieldType.TEXTO_CORTO },
        { field_id: 'f2', label: 'Edad', type: FieldType.NUMERO },
      ];

      const csv = generateCsv(columns, []);
      const lines = csv.substring(1).split('\r\n'); // Skip BOM

      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe('folio,fecha_envio,Nombre,Edad');
    });

    it('generates correct data rows with fixed and dynamic columns', async () => {
      const { generateCsv } = await import(
        '../../src/services/forms/form-export.js'
      );

      const columns = [
        { field_id: 'f1', label: 'Nombre', type: FieldType.TEXTO_CORTO },
        { field_id: 'f2', label: 'Edad', type: FieldType.NUMERO },
      ];

      const responses: FormResponse[] = [
        {
          response_id: 'r1',
          form_id: 'form-1',
          version_number: 1,
          folio: 'A3K9M2X7',
          submitted_at: '2024-01-15T10:30:00.000Z',
          answers: { f1: 'Juan', f2: 25 },
          metadata: { origin_type: 'qr', user_agent: 'Mozilla/5.0', ip_address: '1.2.3.4' },
          tenant_id: 'tenant-1',
        },
      ];

      const csv = generateCsv(columns, responses);
      const lines = csv.substring(1).split('\r\n'); // Skip BOM

      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('folio,fecha_envio,Nombre,Edad');
      expect(lines[1]).toBe('A3K9M2X7,2024-01-15T10:30:00.000Z,Juan,25');
    });

    it('handles multi-version with empty cells for missing fields (Req 13.3)', async () => {
      const { generateCsv } = await import(
        '../../src/services/forms/form-export.js'
      );

      const columns = [
        { field_id: 'f1', label: 'Nombre', type: FieldType.TEXTO_CORTO },
        { field_id: 'f2', label: 'Edad', type: FieldType.NUMERO },
        { field_id: 'f3', label: 'Fecha', type: FieldType.FECHA },
      ];

      const responses: FormResponse[] = [
        {
          response_id: 'r1',
          form_id: 'form-1',
          version_number: 1,
          folio: 'AAAA1111',
          submitted_at: '2024-01-15T10:30:00.000Z',
          answers: { f1: 'Juan', f2: 25 }, // f3 didn't exist in v1
          metadata: { origin_type: 'qr', user_agent: 'Mozilla/5.0', ip_address: '1.2.3.4' },
          tenant_id: 'tenant-1',
        },
        {
          response_id: 'r2',
          form_id: 'form-1',
          version_number: 2,
          folio: 'BBBB2222',
          submitted_at: '2024-02-15T10:30:00.000Z',
          answers: { f1: 'María', f3: '2024-02-01' }, // f2 removed in v2
          metadata: { origin_type: 'url_directa', user_agent: 'Mozilla/5.0', ip_address: '5.6.7.8' },
          tenant_id: 'tenant-1',
        },
      ];

      const csv = generateCsv(columns, responses);
      const lines = csv.substring(1).split('\r\n'); // Skip BOM

      expect(lines).toHaveLength(3);
      expect(lines[1]).toBe('AAAA1111,2024-01-15T10:30:00.000Z,Juan,25,');
      expect(lines[2]).toBe('BBBB2222,2024-02-15T10:30:00.000Z,María,,2024-02-01');
    });

    it('handles multiple selection values separated by semicolons (Req 13.2)', async () => {
      const { generateCsv } = await import(
        '../../src/services/forms/form-export.js'
      );

      const columns = [
        { field_id: 'f1', label: 'Equipos', type: FieldType.SELECCION_MULTIPLE },
      ];

      const responses: FormResponse[] = [
        {
          response_id: 'r1',
          form_id: 'form-1',
          version_number: 1,
          folio: 'CCCC3333',
          submitted_at: '2024-01-15T10:30:00.000Z',
          answers: { f1: ['Casco', 'Guantes', 'Botas'] },
          metadata: { origin_type: 'qr', user_agent: 'Mozilla/5.0', ip_address: '1.2.3.4' },
          tenant_id: 'tenant-1',
        },
      ];

      const csv = generateCsv(columns, responses);
      const lines = csv.substring(1).split('\r\n'); // Skip BOM

      expect(lines[1]).toBe('CCCC3333,2024-01-15T10:30:00.000Z,Casco;Guantes;Botas');
    });
  });

  // ─── exportFormResponses (integration with mocked DynamoDB) ─────────────────

  describe('exportFormResponses', () => {
    it('returns error when no versions exist', async () => {
      // getFormVersions returns empty
      mockSend.mockResolvedValueOnce({ Items: [] });

      const { exportFormResponses } = await import(
        '../../src/services/forms/form-export.js'
      );

      const result = await exportFormResponses('form-nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.statusCode).toBe(404);
        expect(result.code).toBe('NOT_FOUND');
      }
    });

    it('returns headers-only CSV when no responses exist (Req 13.5)', async () => {
      // getFormVersions returns one version
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            form_id: 'form-1',
            version_number: 1,
            fields_snapshot: [
              { field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: true, order: 1 },
            ],
            created_at: '2024-01-01T00:00:00.000Z',
            created_by: 'user-1',
          },
        ],
      });
      // fetchAllResponses returns empty
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const { exportFormResponses } = await import(
        '../../src/services/forms/form-export.js'
      );

      const result = await exportFormResponses('form-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.csv).toContain('\uFEFF');
        expect(result.csv).toContain('folio,fecha_envio,Nombre');
        // Only header row
        const lines = result.csv.substring(1).split('\r\n');
        expect(lines).toHaveLength(1);
        expect(result.filename).toBe('formulario_form-1_respuestas.csv');
      }
    });

    it('returns complete CSV with responses', async () => {
      // getFormVersions
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            form_id: 'form-1',
            version_number: 1,
            fields_snapshot: [
              { field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: true, order: 1 },
              { field_id: 'f2', type: 'numero', label: 'Edad', required: false, order: 2 },
            ],
            created_at: '2024-01-01T00:00:00.000Z',
            created_by: 'user-1',
          },
        ],
      });
      // fetchAllResponses
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            response_id: 'r1',
            form_id: 'form-1',
            version_number: 1,
            folio: 'A3K9M2X7',
            submitted_at: '2024-01-15T10:30:00.000Z',
            answers: { f1: 'Juan', f2: 25 },
            metadata: { origin_type: 'qr', user_agent: 'Mozilla/5.0', ip_address: '1.2.3.4' },
            tenant_id: 'tenant-1',
          },
        ],
        LastEvaluatedKey: undefined,
      });

      const { exportFormResponses } = await import(
        '../../src/services/forms/form-export.js'
      );

      const result = await exportFormResponses('form-1');

      expect(result.success).toBe(true);
      if (result.success) {
        const lines = result.csv.substring(1).split('\r\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe('folio,fecha_envio,Nombre,Edad');
        expect(lines[1]).toBe('A3K9M2X7,2024-01-15T10:30:00.000Z,Juan,25');
      }
    });

    it('handles paginated responses', async () => {
      // getFormVersions
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            form_id: 'form-1',
            version_number: 1,
            fields_snapshot: [
              { field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: true, order: 1 },
            ],
            created_at: '2024-01-01T00:00:00.000Z',
            created_by: 'user-1',
          },
        ],
      });
      // First page of responses
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            response_id: 'r1',
            form_id: 'form-1',
            version_number: 1,
            folio: 'AAAA1111',
            submitted_at: '2024-01-15T10:30:00.000Z',
            answers: { f1: 'Juan' },
            metadata: { origin_type: 'qr', user_agent: 'Mozilla/5.0', ip_address: '1.2.3.4' },
            tenant_id: 'tenant-1',
          },
        ],
        LastEvaluatedKey: { PK: 'FORM#form-1', SK: 'RESPONSE#r1' },
      });
      // Second page of responses
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            response_id: 'r2',
            form_id: 'form-1',
            version_number: 1,
            folio: 'BBBB2222',
            submitted_at: '2024-01-16T10:30:00.000Z',
            answers: { f1: 'María' },
            metadata: { origin_type: 'url_directa', user_agent: 'Mozilla/5.0', ip_address: '5.6.7.8' },
            tenant_id: 'tenant-1',
          },
        ],
        LastEvaluatedKey: undefined,
      });

      const { exportFormResponses } = await import(
        '../../src/services/forms/form-export.js'
      );

      const result = await exportFormResponses('form-1');

      expect(result.success).toBe(true);
      if (result.success) {
        const lines = result.csv.substring(1).split('\r\n');
        expect(lines).toHaveLength(3); // header + 2 data rows
        expect(lines[1]).toContain('AAAA1111');
        expect(lines[2]).toContain('BBBB2222');
      }
    });
  });
});
