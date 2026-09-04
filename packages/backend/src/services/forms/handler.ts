/**
 * Forms Service Lambda Handler.
 * Routes requests by httpMethod + resource path.
 *
 * Authenticated Endpoints (Cognito Authorizer):
 * - POST /forms — Create a new form
 * - GET /forms — List forms for tenant
 * - GET /forms/{id} — Get form by ID
 * - PATCH /forms/{id} — Edit draft form
 * - POST /forms/{id}/publish — Publish form
 * - POST /forms/{id}/unpublish — Unpublish form
 * - POST /forms/{id}/duplicate — Duplicate form
 * - GET /forms/{id}/responses — List form responses
 * - GET /forms/{id}/responses/{responseId} — Get response detail
 * - GET /forms/{id}/responses/export — Export responses as CSV
 * - GET /forms/{id}/audit — Get form audit log
 * - POST /forms/{id}/upload-url — Generate presigned upload URL
 *
 * Public Endpoints (No Auth):
 * - GET /public/forms/{token} — Get published form schema
 * - POST /public/forms/{token}/responses — Submit form response
 * - POST /public/forms/{token}/upload-url — Get presigned URL for file upload
 */

import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import type { Permission } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  conflict,
  internalError,
  createErrorResponse,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { createForm, createFormSchema, getForm, listForms, updateForm, duplicateForm, unpublishForm, publishForm } from './form.js';
import type { UpdateFormInput } from './form.js';
import { getPublicForm, submitFormResponse, getFormByToken, listFormResponses, getFormResponseDetail } from './form-response.js';
import { exportFormResponses } from './form-export.js';
import type { SubmitResponseInput, ListResponsesParams } from './form-response.js';
import { queryAuditLog } from './audit.js';
import { generateFormUploadUrl, validateUploadInput, validateFileUpload } from './form-upload.js';
import type { GenerateUploadUrlInput } from './form-upload.js';
import { FormStatus } from './types.js';
import { checkRateLimit } from './rate-limiter.js';
import { detectBot } from './sanitizer.js';

// ─── Lambda Handler ───────────────────────────────────────────────────────────

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;

    // Handle CORS preflight
    if (httpMethod === 'OPTIONS') {
      return createSuccessResponse(200, {});
    }

    // ─── Public Endpoints (no auth) ────────────────────────────────────────────
    if (resource && resource.startsWith('/public/forms')) {
      return handlePublicRoute(event, httpMethod, resource);
    }

    // ─── Authenticated Endpoints ───────────────────────────────────────────────
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    const pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;

    // POST /forms — Create form
    if (httpMethod === 'POST' && resource === '/forms') {
      const permError = enforcePermission(user, 'forms:create' as Permission);
      if (permError) return permError;
      return await handleCreateForm(event, user);
    }

    // GET /forms — List forms
    if (httpMethod === 'GET' && resource === '/forms') {
      const permError = enforcePermission(user, 'forms:read' as Permission);
      if (permError) return permError;
      return await handleListForms(user);
    }

    // GET /forms/{id} — Get form by ID
    if (httpMethod === 'GET' && resource === '/forms/{id}') {
      const formId = pathParameters?.['id'];
      if (!formId) return badRequest('Form ID is required');
      const permError = enforcePermission(user, 'forms:read' as Permission);
      if (permError) return permError;
      return await handleGetForm(formId, user);
    }

    // PATCH /forms/{id} — Edit draft form
    if (httpMethod === 'PATCH' && resource === '/forms/{id}') {
      const formId = pathParameters?.['id'];
      if (!formId) return badRequest('Form ID is required');
      const permError = enforcePermission(user, 'forms:update' as Permission);
      if (permError) return permError;
      return handleUpdateForm(event, formId, user);
    }

    // POST /forms/{id}/publish — Publish form
    if (httpMethod === 'POST' && resource === '/forms/{id}/publish') {
      const formId = pathParameters?.['id'];
      if (!formId) return badRequest('Form ID is required');
      const permError = enforcePermission(user, 'forms:publish' as Permission);
      if (permError) return permError;
      return handlePublishForm(event, formId, user);
    }

    // POST /forms/{id}/unpublish — Unpublish form
    if (httpMethod === 'POST' && resource === '/forms/{id}/unpublish') {
      const formId = pathParameters?.['id'];
      if (!formId) return badRequest('Form ID is required');
      const permError = enforcePermission(user, 'forms:publish' as Permission);
      if (permError) return permError;
      return await handleUnpublishForm(event, formId, user);
    }

    // POST /forms/{id}/duplicate — Duplicate form
    if (httpMethod === 'POST' && resource === '/forms/{id}/duplicate') {
      const formId = pathParameters?.['id'];
      if (!formId) return badRequest('Form ID is required');
      const permError = enforcePermission(user, 'forms:create' as Permission);
      if (permError) return permError;
      return await handleDuplicateForm(event, formId, user);
    }

    // GET /forms/{id}/responses — List responses
    if (httpMethod === 'GET' && resource === '/forms/{id}/responses') {
      const formId = pathParameters?.['id'];
      if (!formId) return badRequest('Form ID is required');
      const permError = enforcePermission(user, 'forms:read_responses' as Permission);
      if (permError) return permError;
      return handleListResponses(event, formId, user);
    }

    // GET /forms/{id}/responses/export — Export responses CSV
    if (httpMethod === 'GET' && resource === '/forms/{id}/responses/export') {
      const formId = pathParameters?.['id'];
      if (!formId) return badRequest('Form ID is required');
      const permError = enforcePermission(user, 'forms:export' as Permission);
      if (permError) return permError;
      return handleExportResponses(formId, user);
    }

    // GET /forms/{id}/responses/{responseId} — Get response detail
    if (httpMethod === 'GET' && resource === '/forms/{id}/responses/{responseId}') {
      const formId = pathParameters?.['id'];
      const responseId = pathParameters?.['responseId'];
      if (!formId) return badRequest('Form ID is required');
      if (!responseId) return badRequest('Response ID is required');
      const permError = enforcePermission(user, 'forms:read_responses' as Permission);
      if (permError) return permError;
      return handleGetResponse(formId, responseId, user);
    }

    // GET /forms/{id}/audit — Get audit log
    if (httpMethod === 'GET' && resource === '/forms/{id}/audit') {
      const formId = pathParameters?.['id'];
      if (!formId) return badRequest('Form ID is required');
      const permError = enforcePermission(user, 'audit:read' as Permission);
      if (permError) return permError;
      return handleGetAuditLog(event, formId, user);
    }

    // POST /forms/{id}/upload-url — Generate presigned upload URL
    if (httpMethod === 'POST' && resource === '/forms/{id}/upload-url') {
      const formId = pathParameters?.['id'];
      if (!formId) return badRequest('Form ID is required');
      const permError = enforcePermission(user, 'forms:create' as Permission);
      if (permError) return permError;
      return handleGenerateUploadUrl(event, formId, user);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Forms handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// ─── Public Route Handler ─────────────────────────────────────────────────────

async function handlePublicRoute(
  event: ApiGatewayEvent,
  httpMethod: string,
  resource: string
): Promise<ApiGatewayResponse> {
  const pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;
  const token = pathParameters?.['token'];

  if (!token) {
    return badRequest('Token is required');
  }

  // GET /public/forms/{token} — Get published form schema
  if (httpMethod === 'GET' && resource === '/public/forms/{token}') {
    return handleGetPublicForm(token);
  }

  // POST /public/forms/{token}/responses — Submit response
  if (httpMethod === 'POST' && resource === '/public/forms/{token}/responses') {
    return handleSubmitPublicResponse(event, token);
  }

  // POST /public/forms/{token}/upload-url — Get presigned URL for file upload
  if (httpMethod === 'POST' && resource === '/public/forms/{token}/upload-url') {
    return handlePublicUploadUrl(event, token);
  }

  return badRequest('Unsupported route');
}

// ─── Authenticated Route Handlers ─────────────────────────────────────────────

async function handleCreateForm(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = createFormSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validación fallida', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const ipAddress = extractIpAddress(event);

  try {
    const form = await createForm(
      user.tenant_id,
      user.user_id,
      validation.data,
      ipAddress
    );
    return createSuccessResponse(201, { form });
  } catch (error) {
    if (error instanceof Error && (error as Error & { code?: string }).code === 'DUPLICATE_NAME') {
      return conflict('Ya existe un formulario con ese nombre');
    }
    throw error;
  }
}

async function handleListForms(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const result = await listForms(user.tenant_id);
  return createSuccessResponse(200, result);
}

async function handleGetForm(
  formId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const form = await getForm(user.tenant_id, formId);
  if (!form) {
    return notFound('Formulario no encontrado');
  }
  return createSuccessResponse(200, { form });
}

async function handleUpdateForm(
  event: ApiGatewayEvent,
  formId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const input: UpdateFormInput = {};

  if (body['name'] !== undefined) {
    input.name = body['name'] as string;
  }
  if (body['description'] !== undefined) {
    input.description = body['description'] as string;
  }
  if (body['fields'] !== undefined) {
    input.fields = body['fields'] as UpdateFormInput['fields'];
  }

  const ipAddress = extractIpAddress(event);

  const result = await updateForm(
    user.tenant_id,
    formId,
    input,
    user.user_id,
    ipAddress
  );

  if (!result.success) {
    return createErrorResponse(
      result.statusCode,
      result.code,
      result.message,
      result.errors ? { errors: result.errors } : undefined
    );
  }

  return createSuccessResponse(200, { form: result.form });
}

async function handlePublishForm(
  event: ApiGatewayEvent,
  formId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const ipAddress = extractIpAddress(event);

  const result = await publishForm(
    user.tenant_id,
    formId,
    user.user_id,
    ipAddress
  );

  if (!result.success) {
    return createErrorResponse(
      result.statusCode,
      result.code,
      result.message,
      result.errors ? { errors: result.errors } : undefined
    );
  }

  return createSuccessResponse(200, {
    form: result.form,
    token_publico: result.token_publico,
    url_publica: result.url_publica,
    version_number: result.version_number,
  });
}

async function handleUnpublishForm(
  event: ApiGatewayEvent,
  formId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const ipAddress = extractIpAddress(event);

  const result = await unpublishForm(
    user.tenant_id,
    formId,
    user.user_id,
    ipAddress
  );

  if (!result.success) {
    return createErrorResponse(result.statusCode, result.code, result.message);
  }

  return createSuccessResponse(200, { form: result.form });
}

async function handleDuplicateForm(
  event: ApiGatewayEvent,
  formId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const ipAddress = extractIpAddress(event);

  const result = await duplicateForm(
    user.tenant_id,
    formId,
    user.user_id,
    ipAddress
  );

  if (!result.success) {
    return createErrorResponse(result.statusCode, result.code, result.message);
  }

  return createSuccessResponse(201, { form: result.form });
}

async function handleListResponses(
  event: ApiGatewayEvent,
  formId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const queryParams = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;

  const params: ListResponsesParams = {
    formId,
    tenantId: user.tenant_id,
    startDate: queryParams?.['start_date'] || undefined,
    endDate: queryParams?.['end_date'] || undefined,
    status: queryParams?.['status'] || undefined,
    contractor: queryParams?.['contractor'] || undefined,
    nextToken: queryParams?.['next_token'] || undefined,
  };

  const result = await listFormResponses(params);

  if (!result.success) {
    return createErrorResponse(result.statusCode, result.code, result.message);
  }

  return createSuccessResponse(200, {
    responses: result.responses,
    total: result.total,
    ...(result.nextToken && { next_token: result.nextToken }),
  });
}

async function handleExportResponses(
  formId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const result = await exportFormResponses(formId);

  if (!result.success) {
    return createErrorResponse(result.statusCode, result.code, result.message);
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Correlation-Id,X-Tenant-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    },
    body: result.csv,
  };
}

async function handleGetResponse(
  formId: string,
  responseId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const result = await getFormResponseDetail(formId, responseId, user.tenant_id);

  if (!result.success) {
    return createErrorResponse(result.statusCode, result.code, result.message);
  }

  return createSuccessResponse(200, {
    response: result.response,
    version_schema: result.version_schema,
  });
}

async function handleGetAuditLog(
  event: ApiGatewayEvent,
  formId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;
  const cursor = queryStringParameters?.['cursor'] ?? undefined;

  const result = await queryAuditLog(formId, cursor);

  return createSuccessResponse(200, {
    entries: result.entries,
    cursor: result.cursor ?? null,
  });
}

async function handleGenerateUploadUrl(
  event: ApiGatewayEvent,
  formId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const input: GenerateUploadUrlInput = {
    filename: body['filename'] as string,
    content_type: body['content_type'] as string,
    size: body['size'] as number,
  };

  // Use a placeholder response_id and field_id for authenticated uploads
  const responseId = (body['response_id'] as string) || 'pending';
  const fieldId = (body['field_id'] as string) || 'attachment';

  if (!fieldId || typeof fieldId !== 'string') {
    return badRequest('field_id es requerido');
  }

  const result = await generateFormUploadUrl(
    user.tenant_id,
    formId,
    responseId,
    fieldId,
    input
  );

  if (!result.success) {
    return createErrorResponse(result.statusCode, result.code, result.message);
  }

  return createSuccessResponse(200, {
    upload_url: result.upload_url,
    fields: result.fields,
    file_key: result.file_key,
  });
}

// ─── Public Route Handlers (Placeholders) ─────────────────────────────────────

async function handleGetPublicForm(
  token: string
): Promise<ApiGatewayResponse> {
  const result = await getPublicForm(token);

  if (!result.success) {
    return createErrorResponse(result.statusCode, result.code, result.message);
  }

  return createSuccessResponse(200, { form: result.form });
}

async function handleSubmitPublicResponse(
  event: ApiGatewayEvent,
  token: string
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const ipAddress = extractIpAddress(event);
  const headers = (event as Record<string, unknown>)['headers'] as Record<string, string> | null;
  const userAgent = headers?.['User-Agent'] ?? headers?.['user-agent'] ?? '';
  const origin = headers?.['Origin'] ?? headers?.['origin'] ?? '';
  const referer = headers?.['Referer'] ?? headers?.['referer'] ?? '';

  // 1. Rate limiting — check before any processing (Req 15.1)
  // We need the form_id for rate limiting. Look up the form by token first.
  const form = await getFormByToken(token);
  if (!form) {
    return createErrorResponse(404, 'NOT_FOUND', 'Formulario no encontrado');
  }

  const rateLimitResult = await checkRateLimit(form.form_id, ipAddress);
  if (!rateLimitResult.allowed) {
    const retryMinutes = Math.ceil((rateLimitResult.retryAfterSeconds ?? 0) / 60);
    return createErrorResponse(429, 'RATE_LIMITED', `Demasiados envíos. Intente nuevamente en ${retryMinutes} minutos.`, {
      retry_after_seconds: rateLimitResult.retryAfterSeconds,
    });
  }

  // 2. Bot detection — validate headers, timing, honeypot (Req 15.5)
  const honeypotValue = body['_hp_website'] as string | undefined;
  const pageLoadTimestamp = body['_page_load_ts'] as number | undefined;
  const submissionTimestamp = Date.now();

  const botResult = detectBot({
    userAgent,
    origin,
    referer,
    honeypotValue,
    pageLoadTimestamp,
    submissionTimestamp,
  });

  if (botResult.isBot) {
    // Silently reject bot submissions — return fake success to not reveal detection
    return createSuccessResponse(201, {
      folio: 'XXXXXXXX',
      response_id: '00000000-0000-0000-0000-000000000000',
      message: 'Respuesta enviada exitosamente',
    });
  }

  // 3. Parse and validate input
  const answers = body['answers'] as Record<string, unknown> | undefined;
  if (!answers || typeof answers !== 'object') {
    return badRequest('El campo "answers" es requerido y debe ser un objeto');
  }

  const fileMetadata = body['file_metadata'] as Record<string, unknown> | undefined;

  const input: SubmitResponseInput = {
    answers,
    file_metadata: fileMetadata as SubmitResponseInput['file_metadata'],
  };

  // 4. Submit response (sanitization is applied inside submitFormResponse)
  const result = await submitFormResponse(token, input, ipAddress, userAgent, referer, headers ?? undefined);

  if (!result.success) {
    return createErrorResponse(
      result.statusCode,
      result.code,
      result.message,
      result.errors ? { errors: result.errors } : undefined
    );
  }

  return createSuccessResponse(201, {
    folio: result.folio,
    response_id: result.response_id,
    message: 'Respuesta enviada exitosamente',
  });
}

async function handlePublicUploadUrl(
  event: ApiGatewayEvent,
  token: string
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // 1. Validate the form exists and is published
  const form = await getFormByToken(token);

  if (!form) {
    return createErrorResponse(404, 'NOT_FOUND', 'Formulario no encontrado');
  }

  if (form.status !== FormStatus.PUBLICADO) {
    if (form.status === FormStatus.DESPUBLICADO) {
      return createErrorResponse(410, 'GONE', 'Este formulario ya no está disponible');
    }
    return createErrorResponse(404, 'NOT_FOUND', 'Formulario no encontrado');
  }

  // 2. Parse input
  const input: GenerateUploadUrlInput = {
    filename: body['filename'] as string,
    content_type: body['content_type'] as string,
    size: body['size'] as number,
  };

  const responseId = (body['response_id'] as string) || 'pending';
  const fieldId = body['field_id'] as string;

  if (!fieldId || typeof fieldId !== 'string') {
    return badRequest('field_id es requerido');
  }

  // 3. Generate presigned URL
  const result = await generateFormUploadUrl(
    form.tenant_id,
    form.form_id,
    responseId,
    fieldId,
    input
  );

  if (!result.success) {
    return createErrorResponse(result.statusCode, result.code, result.message);
  }

  return createSuccessResponse(200, {
    upload_url: result.upload_url,
    fields: result.fields,
    file_key: result.file_key,
  });
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function parseBody(event: ApiGatewayEvent): Record<string, unknown> | null {
  const body = (event as Record<string, unknown>)['body'];
  if (!body) return null;

  try {
    if (typeof body === 'string') {
      return JSON.parse(body) as Record<string, unknown>;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractIpAddress(event: ApiGatewayEvent): string {
  const requestContext = (event as Record<string, unknown>)['requestContext'] as Record<string, unknown> | undefined;
  const identity = requestContext?.['identity'] as Record<string, unknown> | undefined;
  return (identity?.['sourceIp'] as string) ?? 'unknown';
}
