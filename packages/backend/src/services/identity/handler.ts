/**
 * Identity Service Lambda Handler.
 * Handles worker CRUD, certification management, contractor management, and lead capture endpoints.
 *
 * Endpoints:
 * - POST /workers — Create a new worker
 * - GET /workers — List workers
 * - GET /workers/{id} — Get worker by ID
 * - PATCH /workers/{id} — Update worker
 * - POST /workers/{id}/certifications — Upload a certification
 * - GET /workers/{id}/certifications — List worker certifications
 * - PATCH /workers/{id}/certifications/{certId} — Update certification status
 * - POST /contractors — Create contractor
 * - GET /contractors — List contractors
 * - GET /contractors/{id} — Get contractor
 * - PATCH /contractors/{id} — Update contractor
 * - GET /contractors/{id}/workers — List contractor workers
 * - POST /contractors/{id}/workers — Assign worker to contractor
 * - DELETE /contractors/{id}/workers/{workerId} — Remove worker from contractor
 * - GET /contractors/{id}/compliance — Get contractor compliance
 * - POST /leads — Create lead (public, no auth)
 */

import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  unprocessableEntity,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { createWorker, getWorker, updateWorker, createWorkerSchema, updateWorkerSchema } from './worker.js';
import {
  createCertification,
  getCertification,
  listCertifications,
  updateCertification,
  createCertificationSchema,
  updateCertificationSchema,
  validateDocument,
  generateReadUrl,
} from './certification.js';
import { listAdminUsers } from './admin-users.js';
import { handler as contractorsHandler } from '../contractors/handler.js';
import { handler as leadsHandler } from '../leads/handler.js';

// --- Lambda Handler ---

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;

    // Handle CORS preflight
    if (httpMethod === 'OPTIONS') {
      return createSuccessResponse(200, {});
    }    // Delegate /contractors routes to the contractors handler
    if (resource && resource.startsWith('/contractors')) {
      return contractorsHandler(event);
    }

    // Delegate /leads routes to the leads handler (public, no auth)
    if (resource === '/leads' || (httpMethod === 'POST' && !resource && (event as Record<string, unknown>)['path'] === '/leads')) {
      return leadsHandler(event);
    }

    const pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;
    const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;

    // Authenticate
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    // Route to appropriate handler

    // --- Admin Users endpoint ---
    if (httpMethod === 'GET' && resource === '/admin/users') {
      return handleListAdminUsers(user, queryStringParameters);
    }

    if (httpMethod === 'GET' && resource === '/certifications/stats') {
      return handleCertificationStats(user);
    }

    if (httpMethod === 'POST' && resource === '/workers') {
      return handleCreateWorker(event, user);
    }

    if (httpMethod === 'GET' && resource === '/workers') {
      return handleListWorkers(user, queryStringParameters);
    }

    if (httpMethod === 'GET' && resource === '/workers/{id}') {
      const workerId = pathParameters?.['id'];
      if (!workerId) return badRequest('Worker ID is required');
      return handleGetWorker(workerId, user);
    }

    if (httpMethod === 'PATCH' && resource === '/workers/{id}') {
      const workerId = pathParameters?.['id'];
      if (!workerId) return badRequest('Worker ID is required');
      return handleUpdateWorker(event, workerId, user);
    }

    if (httpMethod === 'GET' && resource === '/workers/{id}/status') {
      const workerId = pathParameters?.['id'];
      if (!workerId) return badRequest('Worker ID is required');
      return handleGetWorkerStatus(workerId, user);
    }

    if (httpMethod === 'POST' && resource === '/workers/{id}/certifications') {
      const workerId = pathParameters?.['id'];
      if (!workerId) return badRequest('Worker ID is required');
      return handleCreateCertification(event, workerId, user);
    }

    if (httpMethod === 'GET' && resource === '/workers/{id}/certifications') {
      const workerId = pathParameters?.['id'];
      if (!workerId) return badRequest('Worker ID is required');
      return handleListCertifications(workerId, user);
    }

    if (httpMethod === 'GET' && resource === '/workers/{id}/certifications/{certId}/document-url') {
      const workerId = pathParameters?.['id'];
      const certId = pathParameters?.['certId'];
      if (!workerId) return badRequest('Worker ID is required');
      if (!certId) return badRequest('Certification ID is required');
      return handleGetDocumentUrl(workerId, certId, user);
    }

    if (httpMethod === 'PATCH' && resource === '/workers/{id}/certifications/{certId}') {
      const workerId = pathParameters?.['id'];
      const certId = pathParameters?.['certId'];
      if (!workerId) return badRequest('Worker ID is required');
      if (!certId) return badRequest('Certification ID is required');
      return handleUpdateCertification(event, workerId, certId, user);
    }

    // --- Certification aggregate endpoints ---

    if (httpMethod === 'GET' && resource === '/certifications/catalog') {
      return handleCertificationCatalog(user, queryStringParameters);
    }

    if (httpMethod === 'GET' && resource === '/certifications/expiring') {
      return handleExpiringCertifications(user, queryStringParameters);
    }

    if (httpMethod === 'GET' && resource === '/certifications/pending') {
      return handlePendingCertifications(user);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Identity handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// --- Route Handlers ---

async function handleListAdminUsers(
  user: { user_id: string; tenant_id: string; role: string },
  queryStringParameters: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'users:manage');
  if (permError) return permError;

  const search = queryStringParameters?.['search'];

  try {
    const result = await listAdminUsers(user.tenant_id, search);
    return createSuccessResponse(200, result);
  } catch (error) {
    console.error('Error listing admin users:', error);
    return internalError('Failed to list users');
  }
}

async function handleListWorkers(
  user: { user_id: string; tenant_id: string; role: string },
  queryStringParameters: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'workers:read');
  if (permError) return permError;

  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Workers'),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':prefix': 'WORKER#',
      },
      Limit: 100,
    })
  );

  let workers = (result.Items ?? []).map((item: Record<string, unknown>) => ({
    worker_id: item['worker_id'] as string,
    legal_name: item['legal_name'] as string | undefined,
    preferred_name: item['preferred_name'] as string | undefined,
    phone: item['phone'],
    language_preference: item['language_preference'],
    created_at: item['created_at'],
  }));

  const search = queryStringParameters?.['search'];
  const { filterWorkers } = await import('../../shared/search-filters.js');
  workers = filterWorkers(workers, search);

  return createSuccessResponse(200, { workers, total: workers.length });
}

async function handleCreateWorker(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'workers:create');
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = createWorkerSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const worker = await createWorker(user.tenant_id, validation.data);
  return createSuccessResponse(201, { worker });
}

async function handleGetWorker(
  workerId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'workers:read');
  if (permError) return permError;

  const worker = await getWorker(user.tenant_id, workerId);
  if (!worker) {
    return notFound('Worker not found');
  }

  return createSuccessResponse(200, { worker });
}

async function handleUpdateWorker(
  event: ApiGatewayEvent,
  workerId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'workers:update');
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = updateWorkerSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const worker = await updateWorker(user.tenant_id, workerId, validation.data);
  if (!worker) {
    return notFound('Worker not found');
  }

  return createSuccessResponse(200, { worker });
}

async function handleGetWorkerStatus(
  workerId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'workers:read');
  if (permError) return permError;

  const worker = await getWorker(user.tenant_id, workerId);
  if (!worker) {
    return notFound('Worker not found');
  }

  // Query worker certifications
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const certResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Certifications'),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}#WORKER#${workerId}`,
        ':prefix': 'CERT#',
      },
    })
  );

  const certifications = certResult.Items ?? [];
  const now = new Date();

  let valid = 0;
  let expired = 0;
  let pending = 0;

  for (const cert of certifications) {
    const validationStatus = cert['validation_status'] as string | undefined;
    const expiryDate = cert['expiry_date'] as string | undefined;

    if (validationStatus === 'expired' || (expiryDate && new Date(expiryDate) < now)) {
      expired++;
    } else if (validationStatus === 'pending_validation' || validationStatus === 'pending') {
      pending++;
    } else if (validationStatus === 'validated' || validationStatus === 'valid') {
      valid++;
    }
  }

  const total = certifications.length;
  const eligible = total > 0 && expired === 0 && valid > 0;

  return createSuccessResponse(200, {
    worker_id: workerId,
    eligible,
    certifications_summary: {
      total,
      valid,
      expired,
      pending,
    },
  });
}

async function handleCreateCertification(
  event: ApiGatewayEvent,
  workerId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'certifications:upload');
  if (permError) return permError;

  // Verify the worker exists
  const worker = await getWorker(user.tenant_id, workerId);
  if (!worker) {
    return notFound('Worker not found');
  }

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = createCertificationSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const input = validation.data;

  // Validate document constraints if document info is provided
  if (input.document_content_type || input.document_size) {
    const docError = validateDocument(input.document_content_type, input.document_size);
    if (docError) {
      return unprocessableEntity(docError);
    }
  }

  const result = await createCertification(user.tenant_id, workerId, input);
  return createSuccessResponse(201, {
    certification: result.certification,
    upload_url: result.upload_url,
  });
}

async function handleListCertifications(
  workerId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'certifications:read');
  if (permError) return permError;

  // Verify the worker exists
  const worker = await getWorker(user.tenant_id, workerId);
  if (!worker) {
    return notFound('Worker not found');
  }

  const certifications = await listCertifications(user.tenant_id, workerId);
  return createSuccessResponse(200, { certifications });
}

async function handleUpdateCertification(
  event: ApiGatewayEvent,
  workerId: string,
  certId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'certifications:validate');
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = updateCertificationSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  try {
    const certification = await updateCertification(
      user.tenant_id,
      workerId,
      certId,
      validation.data
    );

    if (!certification) {
      return notFound('Certification not found');
    }

    return createSuccessResponse(200, { certification });
  } catch (error) {
    // Status transition errors are thrown as Error with descriptive message
    if (error instanceof Error && error.message.includes('Cannot transition')) {
      return unprocessableEntity(error.message);
    }
    throw error;
  }
}

async function handleGetDocumentUrl(
  workerId: string,
  certId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'certifications:read');
  if (permError) return permError;

  const certification = await getCertification(user.tenant_id, workerId, certId);
  if (!certification) {
    return notFound('Certification not found');
  }

  if (!certification.document_key) {
    return notFound('No document is associated with this certification');
  }

  const { read_url, content_type } = await generateReadUrl(certification.document_key);
  return createSuccessResponse(200, { url: read_url, content_type });
}

// --- Certification Stats Handler ---

async function handleCertificationStats(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'certifications:read');
  if (permError) return permError;

  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');

  // Query all certifications for the tenant using GSI1
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Certifications'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
      },
    })
  );

  const items = result.Items ?? [];

  // Aggregate by status
  let totalActive = 0;
  let pendingValidation = 0;
  let expiringSoon = 0;
  let expired = 0;
  const typeCountMap: Record<string, number> = {};

  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  for (const item of items) {
    const status = item['status'] as string | undefined;
    const expiryDate = item['expiry_date'] as string | undefined;
    // Certification records persist the type under `certification_type`
    // (see the Certification interface and createCertification). Reading the
    // non-existent `cert_type` field caused every cert to fall into the
    // "Unknown" bucket in the "Certifications by Type" chart. Fall back to the
    // legacy `cert_type` key for any older records, then to "Unknown".
    const certType =
      (item['certification_type'] as string) || (item['cert_type'] as string) || 'Unknown';

    // Count by type
    typeCountMap[certType] = (typeCountMap[certType] ?? 0) + 1;

    // Categorize by status
    if (status === 'pending_validation') {
      pendingValidation++;
    } else if (status === 'expired' || (expiryDate && new Date(expiryDate) < now)) {
      expired++;
    } else if (expiryDate && new Date(expiryDate) <= thirtyDaysFromNow) {
      expiringSoon++;
    } else if (status === 'active' || status === 'valid') {
      totalActive++;
    } else {
      // Default: count as active if status is not explicitly handled
      totalActive++;
    }
  }

  const byType = Object.entries(typeCountMap).map(([type, count]) => ({
    type,
    count,
  }));

  return createSuccessResponse(200, {
    totalActive,
    pendingValidation,
    expiringSoon,
    expired,
    byType,
  });
}

// --- Certification Aggregate Handlers ---

async function handleCertificationCatalog(
  user: { user_id: string; tenant_id: string; role: string },
  queryStringParameters: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'certifications:read');
  if (permError) return permError;

  const search = queryStringParameters?.['search']?.toLowerCase();
  const category = queryStringParameters?.['category'];

  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');

  // Query certification type definitions: PK = TENANT#{tid}, SK begins_with CERTTYPE#
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Certifications'),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':prefix': 'CERTTYPE#',
      },
    })
  );

  let certTypes = (result.Items ?? []).map((item: Record<string, unknown>) => ({
    id: item['cert_type_id'] as string ?? item['certification_id'] as string ?? '',
    name: item['name'] as string ?? '',
    category: item['category'] as string ?? '',
    issuingAuthority: item['issuing_authority'] as string ?? '',
    validityMonths: (item['validity_months'] as number) ?? 0,
    isRequired: (item['is_required'] as boolean) ?? false,
    activeCount: (item['active_count'] as number) ?? 0,
  }));

  // Apply optional search filter (case-insensitive name substring match)
  if (search) {
    certTypes = certTypes.filter((ct) => ct.name.toLowerCase().includes(search));
  }

  // Apply optional category filter
  if (category) {
    certTypes = certTypes.filter((ct) => ct.category === category);
  }

  return createSuccessResponse(200, { certTypes, total: certTypes.length });
}

async function handleExpiringCertifications(
  user: { user_id: string; tenant_id: string; role: string },
  queryStringParameters: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'certifications:read');
  if (permError) return permError;

  const urgencyDays = parseInt(queryStringParameters?.['urgency'] ?? '30', 10);
  const days = isNaN(urgencyDays) || urgencyDays <= 0 ? 30 : urgencyDays;

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0]!;
  const futureDate = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
  const futureDateStr = futureDate.toISOString().split('T')[0]!;

  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Certifications'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':start': `CERT#${todayStr}`,
        ':end': `CERT#${futureDateStr}`,
      },
    })
  );

  const certifications = (result.Items ?? []).map((item: Record<string, unknown>) => {
    const expiryDate = item['expiry_date'] as string;
    const expiryMs = new Date(expiryDate).getTime();
    const nowMs = today.getTime();
    const daysRemaining = Math.max(0, Math.ceil((expiryMs - nowMs) / (1000 * 60 * 60 * 24)));

    return {
      id: item['certification_id'] as string,
      workerName: item['worker_name'] as string,
      workerId: item['worker_id'] as string,
      certType: item['cert_type'] as string,
      expiryDate,
      daysRemaining,
      site: item['site'] as string ?? '',
    };
  });

  return createSuccessResponse(200, { certifications, total: certifications.length });
}

async function handlePendingCertifications(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user as Parameters<typeof enforcePermission>[0], 'certifications:validate');
  if (permError) return permError;

  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Certifications'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      FilterExpression: '#status = :pendingStatus',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':pendingStatus': 'pending_validation',
      },
    })
  );

  const certifications = (result.Items ?? []).map((item: Record<string, unknown>) => ({
    id: item['certification_id'] as string,
    workerName: item['worker_name'] as string,
    certType: item['cert_type'] as string,
    uploadedAt: item['uploaded_at'] as string,
    documentUrl: item['document_url'] as string,
    expiryDate: item['expiry_date'] as string,
  }));

  return createSuccessResponse(200, { certifications, total: certifications.length });
}

// --- Helper Functions ---

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
