/**
 * Findings Service Lambda Handler.
 * Handles finding listing, retrieval, and review (confirm/dismiss).
 *
 * Endpoints:
 * - GET /findings — List findings (filtered by site_id, status, severity)
 * - GET /findings/{id} — Get finding detail
 * - POST /findings/{id}/review — Confirm or dismiss finding
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import { z } from 'zod';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  conflict,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { FindingStatus, Severity } from '../../shared/types/common.js';
import {
  getFinding,
  listFindings,
  reviewFinding,
  FindingNotFoundError,
  FindingNotReviewableError,
  InvalidDismissalReasonError,
  InvalidReviewActionError,
} from './review.js';

// --- Zod Schemas ---

const reviewFindingSchema = z.object({
  action: z.enum(['confirm', 'dismiss'], {
    errorMap: () => ({ message: "action must be 'confirm' or 'dismiss'" }),
  }),
  reason: z.string().optional(),
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
    if (httpMethod === 'GET' && resource === '/findings') {
      return handleListFindings(user, queryStringParameters);
    }

    if (httpMethod === 'GET' && resource === '/findings/{id}') {
      const findingId = pathParameters?.['id'];
      if (!findingId) return badRequest('Finding ID is required');
      return handleGetFinding(user, findingId);
    }

    if (httpMethod === 'POST' && resource === '/findings/{id}/review') {
      const findingId = pathParameters?.['id'];
      if (!findingId) return badRequest('Finding ID is required');
      return handleReviewFinding(event, user, findingId);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Findings handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// --- Route Handlers ---

/**
 * GET /findings
 * Lists findings with optional filters.
 */
async function handleListFindings(
  user: { user_id: string; tenant_id: string; role: string },
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'findings:read'
  );
  if (permError) return permError;

  const filters: {
    site_id?: string;
    status?: FindingStatus;
    severity?: Severity;
    limit?: number;
    next_token?: string;
  } = {};

  if (queryParams?.['site_id']) {
    filters.site_id = queryParams['site_id'];
  }
  if (queryParams?.['status']) {
    const status = queryParams['status'] as FindingStatus;
    if (!Object.values(FindingStatus).includes(status)) {
      return badRequest(`Invalid status filter. Must be one of: ${Object.values(FindingStatus).join(', ')}`);
    }
    filters.status = status;
  }
  if (queryParams?.['severity']) {
    const severity = queryParams['severity'] as Severity;
    if (!Object.values(Severity).includes(severity)) {
      return badRequest(`Invalid severity filter. Must be one of: ${Object.values(Severity).join(', ')}`);
    }
    filters.severity = severity;
  }
  if (queryParams?.['limit']) {
    const limit = parseInt(queryParams['limit'], 10);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return badRequest('limit must be a number between 1 and 100');
    }
    filters.limit = limit;
  }
  if (queryParams?.['next_token']) {
    filters.next_token = queryParams['next_token'];
  }

  const result = await listFindings(user.tenant_id, filters);

  return createSuccessResponse(200, {
    findings: result.findings,
    next_token: result.next_token,
    count: result.findings.length,
  });
}

/**
 * GET /findings/{id}
 * Gets a single finding by ID.
 */
async function handleGetFinding(
  user: { user_id: string; tenant_id: string; role: string },
  findingId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'findings:read'
  );
  if (permError) return permError;

  const finding = await getFinding(user.tenant_id, findingId);
  if (!finding) {
    return notFound('Finding not found');
  }

  return createSuccessResponse(200, { finding });
}

/**
 * POST /findings/{id}/review
 * Confirms or dismisses a finding.
 * Requirement 9.4: Confirm updates status, records reviewer_id and timestamp.
 * Requirement 9.5: Dismiss requires reason ≥ 10 chars.
 * Requirement 9.6: Unreviewed findings cannot trigger EnforcementActions.
 * Requirement 9.7: On confirm (high/critical), create EnforcementAction within 60s.
 */
async function handleReviewFinding(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string },
  findingId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'findings:review'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = reviewFindingSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await reviewFinding(
      user.tenant_id,
      findingId,
      user.user_id,
      validation.data
    );

    return createSuccessResponse(200, {
      finding: result.finding,
      enforcement_action: result.enforcement_action ?? null,
    });
  } catch (error) {
    if (error instanceof FindingNotFoundError) {
      return notFound('Finding not found');
    }
    if (error instanceof FindingNotReviewableError) {
      return conflict(error.message, { current_status: error.currentStatus });
    }
    if (error instanceof InvalidDismissalReasonError) {
      return badRequest(error.message);
    }
    if (error instanceof InvalidReviewActionError) {
      return badRequest(error.message);
    }
    throw error;
  }
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
