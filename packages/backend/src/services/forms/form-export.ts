/**
 * CSV Export for form responses.
 *
 * Generates a UTF-8 with BOM CSV file containing all responses for a form.
 * Handles multi-version column unification: columns from all versions are merged,
 * with empty cells for fields that didn't exist in a response's version.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.5, 13.6
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { getFormVersions } from './form-version.js';
import type { FieldConfig, FormResponse, FormVersion } from './types.js';
import { FieldType } from './types.js';

const FORM_RESPONSES_TABLE = 'FormResponses';
const logger = createLogger('form-export');

/** UTF-8 BOM prefix */
const UTF8_BOM = '\uFEFF';

/** Export timeout in milliseconds (30 seconds) */
const EXPORT_TIMEOUT_MS = 30_000;

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface ExportSuccess {
  success: true;
  csv: string;
  filename: string;
}

export interface ExportError {
  success: false;
  statusCode: number;
  code: string;
  message: string;
}

export type ExportResult = ExportSuccess | ExportError;

// ─── Column Definition ────────────────────────────────────────────────────────

interface CsvColumn {
  field_id: string;
  label: string;
  type: FieldType;
}

// ─── Main Export Function ─────────────────────────────────────────────────────

/**
 * Exports all responses for a form as a CSV string.
 *
 * - Fetches all versions to build unified column set
 * - Fetches all responses
 * - Generates CSV with UTF-8 BOM
 * - Fixed columns: folio, fecha_envio
 * - Dynamic columns: one per unique field across all versions (by field_id)
 * - Multi-selection values joined with semicolons
 * - Returns headers-only CSV if no responses exist
 * - 30-second timeout, no partial files on failure
 *
 * @param formId - The form's UUID
 * @returns ExportResult with CSV content or error
 */
export async function exportFormResponses(formId: string): Promise<ExportResult> {
  const startTime = Date.now();

  try {
    // 1. Get all versions to build unified column set
    const versions = await getFormVersions(formId);

    if (versions.length === 0) {
      // No versions means form was never published — return error
      return {
        success: false,
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Formulario no encontrado o sin versiones publicadas',
      };
    }

    checkTimeout(startTime);

    // 2. Build unified columns from all versions
    const columns = buildUnifiedColumns(versions);

    // 3. Fetch all responses
    const responses = await fetchAllResponses(formId, startTime);

    checkTimeout(startTime);

    // 4. Generate CSV
    const csv = generateCsv(columns, responses);

    const filename = `formulario_${formId}_respuestas.csv`;

    logger.info('CSV export completed', {
      form_id: formId,
      response_count: responses.length,
      column_count: columns.length + 2, // +2 for folio and fecha_envio
      duration_ms: Date.now() - startTime,
    });

    return {
      success: true,
      csv,
      filename,
    };
  } catch (error) {
    if (error instanceof ExportTimeoutError) {
      logger.error('CSV export timeout', { form_id: formId, duration_ms: Date.now() - startTime });
      return {
        success: false,
        statusCode: 504,
        code: 'EXPORT_TIMEOUT',
        message: 'La exportación no pudo completarse dentro del tiempo límite',
      };
    }

    logger.error('CSV export failed', {
      form_id: formId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'La exportación no pudo completarse',
    };
  }
}

// ─── Build Unified Columns ────────────────────────────────────────────────────

/**
 * Builds a unified set of columns from all form versions.
 * Uses field_id as the unique key — if the same field_id appears in multiple versions,
 * it uses the label from the latest version.
 * Columns are ordered by their first appearance across versions (version order, then field order).
 */
export function buildUnifiedColumns(versions: FormVersion[]): CsvColumn[] {
  const columnMap = new Map<string, CsvColumn>();
  const columnOrder: string[] = [];

  // Process versions in order (ascending by version_number)
  for (const version of versions) {
    const sortedFields = [...version.fields_snapshot].sort((a, b) => a.order - b.order);

    for (const field of sortedFields) {
      if (!columnMap.has(field.field_id)) {
        // First time seeing this field — add to order
        columnOrder.push(field.field_id);
        columnMap.set(field.field_id, {
          field_id: field.field_id,
          label: field.label,
          type: field.type,
        });
      } else {
        // Field exists in a later version — update label to latest
        columnMap.set(field.field_id, {
          field_id: field.field_id,
          label: field.label,
          type: field.type,
        });
      }
    }
  }

  return columnOrder.map((id) => columnMap.get(id)!);
}

// ─── Fetch All Responses ──────────────────────────────────────────────────────

/**
 * Fetches all responses for a form using pagination.
 * Checks timeout between pages to avoid partial results.
 */
async function fetchAllResponses(
  formId: string,
  startTime: number
): Promise<FormResponse[]> {
  const responses: FormResponse[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    checkTimeout(startTime);

    const result = await docClient.send(
      new QueryCommand({
        TableName: getTableName(FORM_RESPONSES_TABLE),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `FORM#${formId}`,
          ':skPrefix': 'RESPONSE#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      responses.push(...(result.Items as FormResponse[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return responses;
}

// ─── CSV Generation ───────────────────────────────────────────────────────────

/**
 * Generates the CSV string with UTF-8 BOM.
 *
 * Format:
 * - BOM prefix for Excel compatibility
 * - Header row: folio, fecha_envio, [field labels...]
 * - Data rows: one per response
 * - Values are properly escaped (quoted if they contain commas, quotes, or newlines)
 * - Multi-selection values joined with semicolons
 */
export function generateCsv(columns: CsvColumn[], responses: FormResponse[]): string {
  const rows: string[] = [];

  // Header row
  const headers = ['folio', 'fecha_envio', ...columns.map((col) => col.label)];
  rows.push(headers.map(escapeCsvValue).join(','));

  // Data rows
  for (const response of responses) {
    const row: string[] = [
      response.folio,
      response.submitted_at,
    ];

    for (const column of columns) {
      const value = formatCellValue(response.answers, column);
      row.push(value);
    }

    rows.push(row.map(escapeCsvValue).join(','));
  }

  return UTF8_BOM + rows.join('\r\n');
}

// ─── Cell Value Formatting ────────────────────────────────────────────────────

/**
 * Formats a cell value based on the field type and the response's answers.
 * - Multiple selection: values joined with semicolons
 * - Missing fields (from different version): empty string
 * - Arrays: joined with semicolons
 * - Other values: converted to string
 */
export function formatCellValue(
  answers: Record<string, unknown>,
  column: CsvColumn
): string {
  const value = answers[column.field_id];

  // Field not present in this response's version → empty cell
  if (value === undefined || value === null) {
    return '';
  }

  // Multiple selection: array of values joined with semicolons
  if (column.type === FieldType.SELECCION_MULTIPLE && Array.isArray(value)) {
    return value.join(';');
  }

  // Arrays (fallback): join with semicolons
  if (Array.isArray(value)) {
    return value.join(';');
  }

  // Boolean (checkbox): convert to string
  if (typeof value === 'boolean') {
    return value ? 'Sí' : 'No';
  }

  return String(value);
}

// ─── CSV Escaping ─────────────────────────────────────────────────────────────

/**
 * Escapes a CSV value according to RFC 4180:
 * - If the value contains a comma, double-quote, or newline, wrap in double-quotes
 * - Double-quotes within the value are escaped by doubling them
 */
export function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── Timeout Handling ─────────────────────────────────────────────────────────

class ExportTimeoutError extends Error {
  constructor() {
    super('Export timeout exceeded');
    this.name = 'ExportTimeoutError';
  }
}

/**
 * Checks if the export has exceeded the 30-second timeout.
 * Throws ExportTimeoutError if exceeded — ensures no partial files are returned.
 */
function checkTimeout(startTime: number): void {
  if (Date.now() - startTime >= EXPORT_TIMEOUT_MS) {
    throw new ExportTimeoutError();
  }
}
