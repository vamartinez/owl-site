/**
 * Public form access, response submission, and response query for the Forms Service.
 *
 * This file implements:
 * - GET /public/forms/{token} (task 5.1)
 * - POST /public/forms/{token}/responses (task 5.5)
 * - GET /forms/{id}/responses (task 6.5) — paginated, filterable by date range, status, contractor
 * - GET /forms/{id}/responses/{responseId} (task 6.5) — full detail with version schema
 *
 * Requirements: 3.2, 7.3, 9.1, 9.4, 11.1, 11.2, 11.3, 11.6, 11.8, 11.9, 12.1, 12.2, 12.3, 12.5, 12.6
 */

import { v4 as uuidv4 } from 'uuid';
import { GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { FormStatus, AuditEntityType, AuditAction, FOLIO_LENGTH } from './types.js';
import type { Form, FieldConfig, FormResponse, FormResponseMetadata, FormVersion } from './types.js';
import { validateFormResponse } from './form-validation.js';
import type { FileMetadata } from './form-validation.js';
import { logAuditEntry } from './audit.js';
import { getFormVersion } from './form-version.js';
import { sanitizeFormAnswers } from './sanitizer.js';

const FORMS_TABLE = 'Forms';
const FORM_RESPONSES_TABLE = 'FormResponses';
const logger = createLogger('form-response');

// ─── Public Form Schema Response ──────────────────────────────────────────────

/**
 * Represents the public-facing field schema returned to contractors.
 * Only includes rendering properties needed to display the form.
 */
export interface PublicFieldSchema {
  field_id: string;
  type: string;
  label: string;
  required: boolean;
  order: number;
  placeholder?: string;
  help_text?: string;
  options?: { option_id: string; label: string }[];
  validation?: {
    min_value?: number;
    max_value?: number;
    min_length?: number;
    max_length?: number;
    pattern?: string;
    min_date?: string;
    max_date?: string;
    allowed_file_types?: string[];
    max_file_size_mb?: number;
  };
}

export interface PublicFormSchema {
  name: string;
  description?: string;
  fields: PublicFieldSchema[];
}

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface GetPublicFormSuccess {
  success: true;
  form: PublicFormSchema;
}

export interface GetPublicFormError {
  success: false;
  statusCode: number;
  code: string;
  message: string;
}

// ─── Query Form by Token (GSI1) ──────────────────────────────────────────────

/**
 * Queries the Forms table GSI1 by token_publico.
 * GSI1PK = TOKEN#{token}, GSI1SK = FORM#{form_id}
 */
export async function getFormByToken(token: string): Promise<Form | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(FORMS_TABLE),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': `TOKEN#${token}`,
      },
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as Form;
}

// ─── Map to Public Schema ─────────────────────────────────────────────────────

/**
 * Maps a Form entity to the public-facing schema.
 * Returns fields sorted by order with only rendering properties.
 */
function mapToPublicSchema(form: Form): PublicFormSchema {
  const sortedFields = [...form.fields].sort((a, b) => a.order - b.order);

  const fields: PublicFieldSchema[] = sortedFields.map((field: FieldConfig) => {
    const publicField: PublicFieldSchema = {
      field_id: field.field_id,
      type: field.type,
      label: field.label,
      required: field.required,
      order: field.order,
    };

    if (field.placeholder) {
      publicField.placeholder = field.placeholder;
    }

    if (field.help_text) {
      publicField.help_text = field.help_text;
    }

    if (field.options && field.options.length > 0) {
      publicField.options = field.options.map((opt) => ({
        option_id: opt.option_id,
        label: opt.label,
      }));
    }

    if (field.validation) {
      publicField.validation = { ...field.validation };
    }

    return publicField;
  });

  const schema: PublicFormSchema = {
    name: form.name,
    fields,
  };

  if (form.description) {
    schema.description = form.description;
  }

  return schema;
}

// ─── GET /public/forms/{token} (task 5.1) ─────────────────────────────────────

/**
 * Retrieves a published form by its public token.
 *
 * Behavior:
 * - Returns 404 if token not found (Req 9.4)
 * - Returns 404 if form is in "borrador" state — does not reveal content (Req 3.2)
 * - Returns 410 if form is "despublicado" with message (Req 7.3)
 * - Returns form schema with name, description, fields in order (Req 9.1)
 *
 * Requirements: 3.2, 7.3, 9.1, 9.4
 */
export async function getPublicForm(
  token: string
): Promise<GetPublicFormSuccess | GetPublicFormError> {
  // 1. Query Forms table GSI1 by token
  const form = await getFormByToken(token);

  // 2. Token not found → 404 (Req 9.4)
  if (!form) {
    logger.info('Public form access: token not found', { token });
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Formulario no encontrado',
    };
  }

  // 3. Form in "borrador" state → 404 without revealing content (Req 3.2)
  if (form.status === FormStatus.BORRADOR) {
    logger.info('Public form access: form in borrador state', {
      token,
      form_id: form.form_id,
    });
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Formulario no encontrado',
    };
  }

  // 4. Form is "despublicado" → 410 Gone (Req 7.3)
  if (form.status === FormStatus.DESPUBLICADO) {
    logger.info('Public form access: form despublicado', {
      token,
      form_id: form.form_id,
    });
    return {
      success: false,
      statusCode: 410,
      code: 'GONE',
      message: 'Este formulario ya no está disponible',
    };
  }

  // 5. Form is "publicado" → return schema (Req 9.1)
  const publicSchema = mapToPublicSchema(form);

  logger.info('Public form access: success', {
    token,
    form_id: form.form_id,
    field_count: publicSchema.fields.length,
  });

  return {
    success: true,
    form: publicSchema,
  };
}

// ─── Submit Response Types ────────────────────────────────────────────────────

export interface SubmitResponseInput {
  answers: Record<string, unknown>;
  file_metadata?: Record<string, FileMetadata>;
}

export interface SubmitResponseSuccess {
  success: true;
  folio: string;
  response_id: string;
}

export interface SubmitResponseError {
  success: false;
  statusCode: number;
  code: string;
  message: string;
  errors?: Array<{ field_id: string; field_label: string; message: string }>;
}

// ─── Folio Generation ─────────────────────────────────────────────────────────

/**
 * Characters used for folio generation: uppercase letters + digits.
 */
const FOLIO_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Generates a random alphanumeric folio of FOLIO_LENGTH characters.
 * Uses uppercase letters and digits only.
 */
export function generateFolio(): string {
  let folio = '';
  for (let i = 0; i < FOLIO_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * FOLIO_CHARS.length);
    folio += FOLIO_CHARS[randomIndex];
  }
  return folio;
}

// ─── Detect Origin Type ───────────────────────────────────────────────────────

/**
 * Detects whether the request originated from a QR scan or direct URL access.
 * Heuristic: if referer contains a QR-related pattern or is empty (camera app), assume QR.
 */
function detectOriginType(referer?: string, headers?: Record<string, string>): string {
  // If no referer, likely from QR scan (camera app opens URL directly)
  if (!referer || referer.trim() === '') {
    return 'qr';
  }

  // If referer contains the form URL itself, it's a direct URL access
  return 'url_directa';
}

// ─── POST /public/forms/{token}/responses (task 5.5) ──────────────────────────

/**
 * Submits a form response for a published form.
 *
 * Behavior:
 * - Validates form is still "publicado" (Req 11.8)
 * - Runs server-side validation using form-validation module (Req 10.7, 11.9)
 * - Creates FormResponse with UUID, form_id, version_number, folio, submitted_at, answers, metadata (Req 11.1, 11.2, 11.3)
 * - Logs audit entry "respuesta_enviada" with response_id as actor (Req 11.6, 16.3)
 * - Returns confirmation with folio (Req 11.3)
 *
 * Requirements: 11.1, 11.2, 11.3, 11.6, 11.8, 11.9
 */
export async function submitFormResponse(
  token: string,
  input: SubmitResponseInput,
  ipAddress: string,
  userAgent: string,
  referer?: string,
  headers?: Record<string, string>
): Promise<SubmitResponseSuccess | SubmitResponseError> {
  // 1. Query form by token
  const form = await getFormByToken(token);

  // Token not found → 404
  if (!form) {
    logger.info('Submit response: token not found', { token });
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Formulario no encontrado',
    };
  }

  // 2. Validate form is still "publicado" (Req 11.8)
  if (form.status === FormStatus.DESPUBLICADO) {
    logger.info('Submit response: form despublicado', { token, form_id: form.form_id });
    return {
      success: false,
      statusCode: 410,
      code: 'GONE',
      message: 'Este formulario ya no está disponible para recibir respuestas',
    };
  }

  if (form.status !== FormStatus.PUBLICADO) {
    logger.info('Submit response: form not publicado', { token, form_id: form.form_id, status: form.status });
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Formulario no encontrado',
    };
  }

  // 3. Run server-side validation (Req 10.7, 11.9)
  // First, sanitize all text inputs before validation and storage (Req 11.7, 15.3)
  const sanitizedAnswers = sanitizeFormAnswers(input.answers);

  const validationResult = validateFormResponse(
    form.fields,
    sanitizedAnswers,
    input.file_metadata
  );

  if (!validationResult.valid) {
    logger.info('Submit response: validation failed', {
      token,
      form_id: form.form_id,
      error_count: validationResult.errors.length,
    });
    return {
      success: false,
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Datos inválidos',
      errors: validationResult.errors,
    };
  }

  // 4. Create FormResponse (Req 11.1, 11.2, 11.3)
  const responseId = uuidv4();
  const folio = generateFolio();
  const submittedAt = new Date().toISOString();
  const versionNumber = form.current_version ?? 1;

  // Truncate user_agent to 500 chars (Req 11.2)
  const truncatedUserAgent = userAgent.length > 500 ? userAgent.substring(0, 500) : userAgent;

  const metadata: FormResponseMetadata = {
    origin_type: detectOriginType(referer, headers),
    user_agent: truncatedUserAgent,
    ip_address: ipAddress,
  };

  const formResponse: FormResponse = {
    response_id: responseId,
    form_id: form.form_id,
    version_number: versionNumber,
    folio,
    submitted_at: submittedAt,
    answers: sanitizedAnswers,
    metadata,
    tenant_id: form.tenant_id,
  };

  // 5. Write to DynamoDB FormResponses table
  await docClient.send(
    new PutCommand({
      TableName: getTableName(FORM_RESPONSES_TABLE),
      Item: {
        PK: `FORM#${form.form_id}`,
        SK: `RESPONSE#${responseId}`,
        GSI1PK: `FORM#${form.form_id}`,
        GSI1SK: `DATE#${submittedAt}`,
        ...formResponse,
      },
    })
  );

  // 6. Log audit entry "respuesta_enviada" with response_id as actor (Req 11.6, 16.3)
  await logAuditEntry({
    entity_type: AuditEntityType.RESPUESTA,
    entity_id: responseId,
    action: AuditAction.RESPUESTA_ENVIADA,
    actor_id: responseId, // For contractors, actor_id is the response_id (Req 16.3)
    ip_address: ipAddress,
    metadata: {
      folio,
      form_name: form.name,
      version_number: versionNumber,
      origin_type: metadata.origin_type,
    },
    tenant_id: form.tenant_id,
    form_id: form.form_id,
  });

  logger.info('Submit response: success', {
    token,
    form_id: form.form_id,
    response_id: responseId,
    folio,
    version_number: versionNumber,
  });

  // 7. Return confirmation with folio (Req 11.3)
  return {
    success: true,
    folio,
    response_id: responseId,
  };
}


// ─── Response List & Detail Types (task 6.5) ──────────────────────────────────

/** Maximum responses per page (Req 12.5) */
const RESPONSES_PAGE_SIZE = 25;

/** Maximum date range span in days (Req 12.2) */
const MAX_DATE_RANGE_DAYS = 365;

export interface ListResponsesParams {
  formId: string;
  tenantId: string;
  /** ISO 8601 date string for start of date range filter */
  startDate?: string;
  /** ISO 8601 date string for end of date range filter */
  endDate?: string;
  /** Filter by response status */
  status?: string;
  /** Filter by contractor (matches metadata.ip_address or answers containing contractor info) */
  contractor?: string;
  /** DynamoDB pagination token (base64 encoded LastEvaluatedKey) */
  nextToken?: string;
}

export interface ResponseSummary {
  response_id: string;
  form_id: string;
  folio: string;
  submitted_at: string;
  version_number: number;
  metadata: FormResponseMetadata;
}

export interface ListResponsesSuccess {
  success: true;
  responses: ResponseSummary[];
  total: number;
  nextToken?: string;
}

export interface ListResponsesError {
  success: false;
  statusCode: number;
  code: string;
  message: string;
}

export interface GetResponseDetailSuccess {
  success: true;
  response: FormResponse;
  version_schema: FormVersion;
}

export interface GetResponseDetailError {
  success: false;
  statusCode: number;
  code: string;
  message: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validates that a date range does not exceed MAX_DATE_RANGE_DAYS.
 */
function validateDateRange(startDate?: string, endDate?: string): string | null {
  if (!startDate && !endDate) return null;

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime())) {
      return 'start_date tiene formato inválido. Use formato ISO 8601 (YYYY-MM-DD)';
    }
    if (isNaN(end.getTime())) {
      return 'end_date tiene formato inválido. Use formato ISO 8601 (YYYY-MM-DD)';
    }
    if (start > end) {
      return 'start_date debe ser anterior a end_date';
    }

    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_DATE_RANGE_DAYS) {
      return `El rango de fechas no puede exceder ${MAX_DATE_RANGE_DAYS} días`;
    }
  }

  if (startDate && !endDate) {
    const start = new Date(startDate);
    if (isNaN(start.getTime())) {
      return 'start_date tiene formato inválido. Use formato ISO 8601 (YYYY-MM-DD)';
    }
  }

  if (endDate && !startDate) {
    const end = new Date(endDate);
    if (isNaN(end.getTime())) {
      return 'end_date tiene formato inválido. Use formato ISO 8601 (YYYY-MM-DD)';
    }
  }

  return null;
}

/**
 * Encodes a DynamoDB LastEvaluatedKey to a base64 pagination token.
 */
function encodeNextToken(lastEvaluatedKey: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
}

/**
 * Decodes a base64 pagination token to a DynamoDB ExclusiveStartKey.
 */
function decodeNextToken(token: string): Record<string, unknown> | null {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── GET /forms/{id}/responses (task 6.5) ─────────────────────────────────────

/**
 * Lists responses for a form, paginated (25 per page) and filterable.
 *
 * Uses GSI1 for date ordering:
 * - GSI1PK = FORM#{form_id}
 * - GSI1SK = DATE#{submitted_at}
 *
 * Filters:
 * - Date range (start_date, end_date) — max 365 days span (Req 12.2)
 * - Status (Req 12.2)
 * - Contractor (Req 12.2)
 *
 * Pagination: 25 per page using DynamoDB LastEvaluatedKey/ExclusiveStartKey (Req 12.5)
 *
 * Requirements: 12.1, 12.2, 12.5, 12.6
 */
export async function listFormResponses(
  params: ListResponsesParams
): Promise<ListResponsesSuccess | ListResponsesError> {
  const { formId, tenantId, startDate, endDate, status, contractor, nextToken } = params;

  // 1. Validate date range (Req 12.2 — max 365 days)
  const dateError = validateDateRange(startDate, endDate);
  if (dateError) {
    return {
      success: false,
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: dateError,
    };
  }

  // 2. Build GSI1 query with date range key condition
  let keyConditionExpression = 'GSI1PK = :gsi1pk';
  const expressionAttributeValues: Record<string, unknown> = {
    ':gsi1pk': `FORM#${formId}`,
  };

  // Apply date range to GSI1SK (DATE#{submitted_at})
  if (startDate && endDate) {
    keyConditionExpression += ' AND GSI1SK BETWEEN :startKey AND :endKey';
    expressionAttributeValues[':startKey'] = `DATE#${startDate}`;
    // Ensure end date is inclusive by appending a high character
    expressionAttributeValues[':endKey'] = `DATE#${endDate}\uffff`;
  } else if (startDate) {
    keyConditionExpression += ' AND GSI1SK >= :startKey';
    expressionAttributeValues[':startKey'] = `DATE#${startDate}`;
  } else if (endDate) {
    keyConditionExpression += ' AND GSI1SK <= :endKey';
    expressionAttributeValues[':endKey'] = `DATE#${endDate}\uffff`;
  }

  // 3. Build filter expressions for status and contractor
  const filterExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};

  // Filter by tenant_id for isolation
  filterExpressions.push('tenant_id = :tenantId');
  expressionAttributeValues[':tenantId'] = tenantId;

  if (status) {
    filterExpressions.push('#responseStatus = :status');
    expressionAttributeValues[':status'] = status;
    expressionAttributeNames['#responseStatus'] = 'status';
  }

  if (contractor) {
    // Filter by contractor — search in metadata.ip_address or folio
    filterExpressions.push('(contains(metadata.ip_address, :contractor) OR contains(folio, :contractor))');
    expressionAttributeValues[':contractor'] = contractor;
  }

  const filterExpression = filterExpressions.length > 0
    ? filterExpressions.join(' AND ')
    : undefined;

  // 4. Decode pagination token
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (nextToken) {
    const decoded = decodeNextToken(nextToken);
    if (!decoded) {
      return {
        success: false,
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Token de paginación inválido',
      };
    }
    exclusiveStartKey = decoded;
  }

  // 5. Execute query using GSI1 for date ordering
  const queryInput: Record<string, unknown> = {
    TableName: getTableName(FORM_RESPONSES_TABLE),
    IndexName: 'GSI1',
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ScanIndexForward: false, // Most recent first
    Limit: RESPONSES_PAGE_SIZE,
    ...(filterExpression && { FilterExpression: filterExpression }),
    ...(Object.keys(expressionAttributeNames).length > 0 && {
      ExpressionAttributeNames: expressionAttributeNames,
    }),
    ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
  };

  const result = await docClient.send(new QueryCommand(queryInput as any));

  // 6. Map results to response summaries
  const responses: ResponseSummary[] = (result.Items ?? []).map((item) => {
    const response = item as FormResponse;
    return {
      response_id: response.response_id,
      form_id: response.form_id,
      folio: response.folio,
      submitted_at: response.submitted_at,
      version_number: response.version_number,
      metadata: response.metadata,
    };
  });

  // 7. Encode pagination token if there are more results
  let responseNextToken: string | undefined;
  if (result.LastEvaluatedKey) {
    responseNextToken = encodeNextToken(result.LastEvaluatedKey as Record<string, unknown>);
  }

  logger.info('List responses: success', {
    form_id: formId,
    count: responses.length,
    has_more: !!result.LastEvaluatedKey,
    filters: { startDate, endDate, status, contractor },
  });

  return {
    success: true,
    responses,
    total: responses.length,
    nextToken: responseNextToken,
  };
}

// ─── GET /forms/{id}/responses/{responseId} (task 6.5) ────────────────────────

/**
 * Retrieves a single response with full detail including field values and version schema.
 *
 * Returns:
 * - Full FormResponse with all field values (Req 12.3)
 * - The FormVersion schema used at submission time (Req 14.4, 12.3)
 *
 * Requirements: 12.3, 12.6
 */
export async function getFormResponseDetail(
  formId: string,
  responseId: string,
  tenantId: string
): Promise<GetResponseDetailSuccess | GetResponseDetailError> {
  // 1. Get the response from FormResponses table
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(FORM_RESPONSES_TABLE),
      Key: {
        PK: `FORM#${formId}`,
        SK: `RESPONSE#${responseId}`,
      },
    })
  );

  if (!result.Item) {
    logger.info('Get response detail: not found', { form_id: formId, response_id: responseId });
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Respuesta no encontrada',
    };
  }

  const response = result.Item as FormResponse;

  // 2. Verify tenant isolation
  if (response.tenant_id !== tenantId) {
    logger.warn('Get response detail: tenant mismatch', {
      form_id: formId,
      response_id: responseId,
      expected_tenant: tenantId,
      actual_tenant: response.tenant_id,
    });
    return {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Respuesta no encontrada',
    };
  }

  // 3. Get the version schema used at submission time (Req 14.4)
  const versionSchema = await getFormVersion(formId, response.version_number);

  if (!versionSchema) {
    logger.error('Get response detail: version schema not found', {
      form_id: formId,
      response_id: responseId,
      version_number: response.version_number,
    });
    return {
      success: false,
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo obtener el esquema de la versión del formulario',
    };
  }

  logger.info('Get response detail: success', {
    form_id: formId,
    response_id: responseId,
    version_number: response.version_number,
  });

  return {
    success: true,
    response,
    version_schema: versionSchema,
  };
}
