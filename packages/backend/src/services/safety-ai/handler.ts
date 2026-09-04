/**
 * Safety AI Service Lambda Handler.
 * Provides the /safety-ai/* routes consumed by the admin portal.
 * Delegates finding operations to the existing findings service logic.
 *
 * Endpoints:
 * - GET /safety-ai/findings — List findings (with search support)
 * - GET /safety-ai/findings/{id} — Get finding detail
 * - PATCH /safety-ai/findings/{id}/confirm — Confirm a finding
 * - PATCH /safety-ai/findings/{id}/dismiss — Dismiss a finding
 * - GET /safety-ai/pending-review — List findings pending review
 * - GET /safety-ai/violations-by-rule — Aggregate violations by rule
 * - GET /safety-ai/corrective-actions — List corrective actions
 * - GET /safety-ai/pdf-reports — List generated PDF reports
 * - POST /safety-ai/pdf-reports/generate — Generate a new PDF report
 * - POST /safety-ai/upload-evidence — Upload evidence media
 */

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
} from '../findings/review.js';

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

    // --- Findings routes ---

    if (httpMethod === 'GET' && resource === '/safety-ai/findings') {
      return handleListFindings(user, queryStringParameters);
    }

    if (httpMethod === 'GET' && resource === '/safety-ai/findings/{id}') {
      const findingId = pathParameters?.['id'];
      if (!findingId) return badRequest('Finding ID is required');
      return handleGetFinding(user, findingId);
    }

    if (httpMethod === 'PATCH' && resource === '/safety-ai/findings/{id}/confirm') {
      const findingId = pathParameters?.['id'];
      if (!findingId) return badRequest('Finding ID is required');
      return handleReviewAction(event, user, findingId, 'confirm');
    }

    if (httpMethod === 'PATCH' && resource === '/safety-ai/findings/{id}/dismiss') {
      const findingId = pathParameters?.['id'];
      if (!findingId) return badRequest('Finding ID is required');
      return handleReviewAction(event, user, findingId, 'dismiss');
    }

    // --- Pending review ---

    if (httpMethod === 'GET' && resource === '/safety-ai/pending-review') {
      return handlePendingReview(user);
    }

    // --- Violations by rule ---

    if (httpMethod === 'GET' && resource === '/safety-ai/violations-by-rule') {
      return handleViolationsByRule(user);
    }

    // --- Corrective actions ---

    if (httpMethod === 'GET' && resource === '/safety-ai/corrective-actions') {
      return handleCorrectiveActions(user, queryStringParameters);
    }

    // --- PDF Reports ---

    if (httpMethod === 'GET' && resource === '/safety-ai/pdf-reports') {
      return handleListPdfReports(user);
    }

    if (httpMethod === 'POST' && resource === '/safety-ai/pdf-reports/generate') {
      return handleGeneratePdfReport(event, user);
    }

    // --- Upload evidence ---

    if (httpMethod === 'POST' && resource === '/safety-ai/upload-evidence') {
      return handleUploadEvidence(event, user);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Safety AI handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// --- Route Handlers ---

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
    search?: string;
  } = {};

  if (queryParams?.['site_id']) filters.site_id = queryParams['site_id'];
  if (queryParams?.['search']) filters.search = queryParams['search'];
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
  if (queryParams?.['next_token']) filters.next_token = queryParams['next_token'];

  const result = await listFindings(user.tenant_id, filters);

  return createSuccessResponse(200, {
    findings: result.findings,
    next_token: result.next_token,
    total: result.findings.length,
  });
}

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
  if (!finding) return notFound('Finding not found');

  return createSuccessResponse(200, { finding });
}

async function handleReviewAction(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string },
  findingId: string,
  action: 'confirm' | 'dismiss'
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'findings:review'
  );
  if (permError) return permError;

  const body = parseBody(event);
  const reason = body?.['reason'] as string | undefined;

  try {
    const result = await reviewFinding(
      user.tenant_id,
      findingId,
      user.user_id,
      { action, reason }
    );

    return createSuccessResponse(200, {
      finding: result.finding,
      enforcement_action: result.enforcement_action ?? null,
    });
  } catch (error) {
    if (error instanceof FindingNotFoundError) return notFound('Finding not found');
    if (error instanceof FindingNotReviewableError) {
      return conflict(error.message, { current_status: error.currentStatus });
    }
    if (error instanceof InvalidDismissalReasonError) return badRequest(error.message);
    if (error instanceof InvalidReviewActionError) return badRequest(error.message);
    throw error;
  }
}

async function handlePendingReview(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'findings:read'
  );
  if (permError) return permError;

  const result = await listFindings(user.tenant_id, {
    status: FindingStatus.PENDING,
  });

  return createSuccessResponse(200, {
    findings: result.findings,
    total: result.findings.length,
  });
}

async function handleViolationsByRule(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'findings:read'
  );
  if (permError) return permError;

  // Fetch all confirmed findings and aggregate by rule
  const result = await listFindings(user.tenant_id, {
    status: FindingStatus.CONFIRMED,
    limit: 100,
  });

  const ruleMap = new Map<string, { rule: string; count: number; severity: string }>();
  for (const finding of result.findings) {
    const rule = (finding as Record<string, unknown>)['rule_id'] as string || 'unknown';
    const existing = ruleMap.get(rule);
    if (existing) {
      existing.count++;
    } else {
      ruleMap.set(rule, {
        rule,
        count: 1,
        severity: (finding as Record<string, unknown>)['severity'] as string || 'medium',
      });
    }
  }

  return createSuccessResponse(200, {
    violations: Array.from(ruleMap.values()).sort((a, b) => b.count - a.count),
  });
}

async function handleCorrectiveActions(
  user: { user_id: string; tenant_id: string; role: string },
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'findings:read'
  );
  if (permError) return permError;

  // Corrective actions are findings that have been confirmed (enforcement triggered)
  const filters: { status?: FindingStatus; severity?: Severity } = {
    status: FindingStatus.CONFIRMED,
  };
  if (queryParams?.['severity']) {
    filters.severity = queryParams['severity'] as Severity;
  }

  const result = await listFindings(user.tenant_id, filters);

  return createSuccessResponse(200, {
    actions: result.findings.map((f: Record<string, unknown>) => ({
      id: f['id'],
      finding_id: f['id'],
      rule_id: f['rule_id'],
      severity: f['severity'],
      status: f['enforcement_status'] || 'pending',
      created_at: f['reviewed_at'] || f['created_at'],
    })),
    total: result.findings.length,
  });
}

async function handleListPdfReports(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'findings:read'
  );
  if (permError) return permError;

  // TODO: Implement PDF reports storage/retrieval
  // For now return empty list — the infrastructure is ready
  return createSuccessResponse(200, {
    reports: [],
    total: 0,
  });
}

async function handleGeneratePdfReport(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'findings:read'
  );
  if (permError) return permError;

  const body = parseBody(event);
  const reportType = (body?.['type'] as string) || 'summary';

  // TODO: Trigger async PDF generation via SQS
  // For now return a placeholder response
  const reportId = `rpt_${Date.now()}`;

  return createSuccessResponse(202, {
    id: reportId,
    status: 'generating',
    type: reportType,
    message: 'PDF report generation initiated',
  });
}

async function handleUploadEvidence(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'inspections:upload_media'
  );
  if (permError) return permError;

  // TODO: Implement evidence upload (generate pre-signed URL)
  // For now return a placeholder
  return createSuccessResponse(202, {
    message: 'Evidence upload initiated',
    upload_url: null,
  });
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
