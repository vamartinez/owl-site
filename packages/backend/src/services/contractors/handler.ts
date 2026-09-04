/**
 * Contractors Service Lambda Handler.
 * Handles contractor CRUD, worker assignment/removal, and compliance status endpoints.
 *
 * Endpoints:
 * - POST /contractors — Create contractor
 * - GET /contractors — List contractors
 * - GET /contractors/{id} — Get contractor profile
 * - PATCH /contractors/{id} — Update contractor
 * - GET /contractors/{id}/workers — List contractor's workers
 * - POST /contractors/{id}/workers — Assign worker to contractor
 * - DELETE /contractors/{id}/workers/{workerId} — Remove worker from contractor
 * - GET /contractors/{id}/compliance — Get contractor compliance status
 *
 * Requirements: 17.4
 */

import { z } from 'zod';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  forbidden,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import {
  createContractor,
  getContractor,
  listContractors,
  updateContractor,
  assignWorker,
  removeWorker,
  listContractorWorkers,
  calculateComplianceStatus,
} from './contractor.js';
import { ContractorStatus } from './types.js';
import { e164PhoneSchema, emailSchema } from '../../shared/validators.js';

// --- Zod Schemas ---

const createContractorSchema = z.object({
  company_name: z.string().trim().min(1, 'company_name is required').max(200),
  contact_name: z.string().trim().min(1, 'contact_name is required').max(150),
  contact_email: emailSchema,
  contact_phone: e164PhoneSchema.optional(),
  license_number: z.string().max(100).optional(),
});

const updateContractorSchema = z.object({
  company_name: z.string().trim().min(1).max(200).optional(),
  contact_name: z.string().trim().min(1).max(150).optional(),
  contact_email: emailSchema.optional(),
  contact_phone: e164PhoneSchema.optional(),
  license_number: z.string().max(100).optional(),
  status: z.nativeEnum(ContractorStatus).optional(),
});

const assignWorkerSchema = z.object({
  worker_id: z.string().min(1, 'worker_id is required'),
});

// --- Lambda Handler ---

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;
    const pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;
    const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;

    // Authenticate
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    // Route to appropriate handler
    if (httpMethod === 'POST' && resource === '/contractors') {
      return handleCreateContractor(event, user);
    }

    if (httpMethod === 'GET' && resource === '/contractors') {
      return handleListContractors(user, queryStringParameters);
    }

    if (httpMethod === 'GET' && resource === '/contractors/{id}') {
      const contractorId = pathParameters?.['id'];
      if (!contractorId) return badRequest('Contractor ID is required');
      return handleGetContractor(user, contractorId);
    }

    if (httpMethod === 'PATCH' && resource === '/contractors/{id}') {
      const contractorId = pathParameters?.['id'];
      if (!contractorId) return badRequest('Contractor ID is required');
      return handleUpdateContractor(event, user, contractorId);
    }

    if (httpMethod === 'GET' && resource === '/contractors/{id}/workers') {
      const contractorId = pathParameters?.['id'];
      if (!contractorId) return badRequest('Contractor ID is required');
      return handleListWorkers(user, contractorId, queryStringParameters);
    }

    if (httpMethod === 'POST' && resource === '/contractors/{id}/workers') {
      const contractorId = pathParameters?.['id'];
      if (!contractorId) return badRequest('Contractor ID is required');
      return handleAssignWorker(event, user, contractorId);
    }

    if (httpMethod === 'DELETE' && resource === '/contractors/{id}/workers/{workerId}') {
      const contractorId = pathParameters?.['id'];
      const workerId = pathParameters?.['workerId'];
      if (!contractorId) return badRequest('Contractor ID is required');
      if (!workerId) return badRequest('Worker ID is required');
      return handleRemoveWorker(user, contractorId, workerId);
    }

    if (httpMethod === 'GET' && resource === '/contractors/{id}/compliance') {
      const contractorId = pathParameters?.['id'];
      if (!contractorId) return badRequest('Contractor ID is required');
      return handleGetCompliance(user, contractorId);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Contractors handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// --- Route Handlers ---

async function handleCreateContractor(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'contractors:create'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = createContractorSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const contractor = await createContractor(user.tenant_id, validation.data, user.user_id);
  return createSuccessResponse(201, { contractor });
}

async function handleListContractors(
  user: { user_id: string; tenant_id: string; role: string },
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'contractors:read'
  );
  if (permError) return permError;

  const limit = queryParams?.['limit'] ? parseInt(queryParams['limit'], 10) : 20;
  const cursor = queryParams?.['cursor'];

  const result = await listContractors(user.tenant_id, limit, cursor);
  return createSuccessResponse(200, result);
}

async function handleGetContractor(
  user: { user_id: string; tenant_id: string; role: string },
  contractorId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'contractors:read'
  );
  if (permError) return permError;

  const contractor = await getContractor(user.tenant_id, contractorId);
  if (!contractor) {
    return notFound('Contractor not found');
  }

  return createSuccessResponse(200, { contractor });
}

async function handleUpdateContractor(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string },
  contractorId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'contractors:update'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = updateContractorSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const contractor = await updateContractor(user.tenant_id, contractorId, validation.data);
  if (!contractor) {
    return notFound('Contractor not found');
  }

  return createSuccessResponse(200, { contractor });
}

async function handleListWorkers(
  user: { user_id: string; tenant_id: string; role: string },
  contractorId: string,
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'contractors:read'
  );
  if (permError) return permError;

  // Verify contractor exists
  const contractor = await getContractor(user.tenant_id, contractorId);
  if (!contractor) {
    return notFound('Contractor not found');
  }

  const limit = queryParams?.['limit'] ? parseInt(queryParams['limit'], 10) : 50;
  const cursor = queryParams?.['cursor'];

  const result = await listContractorWorkers(user.tenant_id, contractorId, limit, cursor);
  return createSuccessResponse(200, result);
}

async function handleAssignWorker(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string },
  contractorId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'contractors:update'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = assignWorkerSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  // Verify contractor exists
  const contractor = await getContractor(user.tenant_id, contractorId);
  if (!contractor) {
    return notFound('Contractor not found');
  }

  const assignment = await assignWorker(
    user.tenant_id,
    contractorId,
    validation.data.worker_id,
    user.user_id
  );

  return createSuccessResponse(201, { assignment });
}

async function handleRemoveWorker(
  user: { user_id: string; tenant_id: string; role: string },
  contractorId: string,
  workerId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'contractors:update'
  );
  if (permError) return permError;

  const removed = await removeWorker(user.tenant_id, contractorId, workerId);
  if (!removed) {
    return notFound('Worker assignment not found');
  }

  return createSuccessResponse(200, { message: 'Worker removed from contractor' });
}

async function handleGetCompliance(
  user: { user_id: string; tenant_id: string; role: string },
  contractorId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'contractors:read'
  );
  if (permError) return permError;

  // Verify contractor exists
  const contractor = await getContractor(user.tenant_id, contractorId);
  if (!contractor) {
    return notFound('Contractor not found');
  }

  const compliance = await calculateComplianceStatus(user.tenant_id, contractorId);
  return createSuccessResponse(200, { compliance });
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
