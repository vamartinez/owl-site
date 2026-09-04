/**
 * Report Validation Service Lambda Handler.
 * Handles all /report-validation/* endpoints for report upload, validation,
 * submission, version management, and Knowledge Base document management.
 *
 * Requirements: 1.1–1.7, 2.1–2.5, 3.1–3.8, 7.1–7.8, 8.1–8.7, 11.1–11.5, 13.1–13.10
 */

import { v4 as uuidv4 } from 'uuid';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent, AuthenticatedUser } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import { canUploadReports, canManageKB, isReportOwner } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  forbidden,
  conflict,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { getReportVisibilityScope } from './utils.js';
import type { ReportRecord, ValidationResultRecord } from './types.js';
import {
  createReportRequestSchema,
  uploadVersionRequestSchema,
  uploadKBDocumentRequestSchema,
  listReportsQuerySchema,
  isValidTransition,
  VALID_TRANSITIONS,
} from './types.js';
import type { ReportStatus } from './types.js';
import {
  createReport,
  uploadNewVersion,
  getVersionHistory,
} from './upload-manager.js';
import { extractText } from './text-extractor.js';
import { runValidation } from './validation-engine.js';
import {
  uploadKBDocument,
  deleteKBDocument,
  listKBDocuments,
} from './kb-manager.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORTS_TABLE = 'reports';
const VALIDATION_RESULTS_TABLE = 'validation-results';
const MAX_PAGE_SIZE = 20;

const logger = createLogger('report-validation-handler');

// ---------------------------------------------------------------------------
// Lambda Handler
// ---------------------------------------------------------------------------

/**
 * Main Lambda handler that routes API Gateway events to the appropriate endpoint.
 */
export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    return await handleApiEvent(event);
  } catch (error) {
    logger.error('Unhandled error in report-validation handler', {
      error: error instanceof Error ? error.message : String(error),
    });
    return internalError('An unexpected error occurred');
  }
}

// ---------------------------------------------------------------------------
// API Gateway Router
// ---------------------------------------------------------------------------

async function handleApiEvent(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
  const resource = (event as Record<string, unknown>)['resource'] as string;
  const pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;
  const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;

  // Authenticate request
  const authResult = authenticateRequest(event);
  if ('error' in authResult) {
    return authResult.error;
  }
  const { user } = authResult;

  // --- Report endpoints ---
  if (httpMethod === 'POST' && resource === '/report-validation/reports') {
    return handleCreateReport(event, user);
  }

  if (httpMethod === 'GET' && resource === '/report-validation/reports') {
    return handleListReports(user, queryStringParameters);
  }

  if (httpMethod === 'GET' && resource === '/report-validation/reports/{id}') {
    const reportId = pathParameters?.['id'];
    if (!reportId) return badRequest('Report ID is required');
    return handleGetReport(user, reportId);
  }

  if (httpMethod === 'POST' && resource === '/report-validation/reports/{id}/validate') {
    const reportId = pathParameters?.['id'];
    if (!reportId) return badRequest('Report ID is required');
    return handleValidateReport(user, reportId);
  }

  if (httpMethod === 'POST' && resource === '/report-validation/reports/{id}/versions') {
    const reportId = pathParameters?.['id'];
    if (!reportId) return badRequest('Report ID is required');
    return handleUploadVersion(event, user, reportId);
  }

  if (httpMethod === 'POST' && resource === '/report-validation/reports/{id}/submit') {
    const reportId = pathParameters?.['id'];
    if (!reportId) return badRequest('Report ID is required');
    return handleSubmitReport(user, reportId);
  }

  if (httpMethod === 'GET' && resource === '/report-validation/reports/{id}/history') {
    const reportId = pathParameters?.['id'];
    if (!reportId) return badRequest('Report ID is required');
    return handleGetHistory(user, reportId);
  }

  // --- Knowledge Base endpoints ---
  if (httpMethod === 'POST' && resource === '/report-validation/kb/documents') {
    return handleUploadKBDocument(event, user);
  }

  if (httpMethod === 'GET' && resource === '/report-validation/kb/documents') {
    return handleListKBDocuments(user);
  }

  if (httpMethod === 'DELETE' && resource === '/report-validation/kb/documents/{id}') {
    const documentId = pathParameters?.['id'];
    if (!documentId) return badRequest('Document ID is required');
    return handleDeleteKBDocument(user, documentId);
  }

  return badRequest('Unsupported route');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBody(event: ApiGatewayEvent): unknown {
  const body = (event as Record<string, unknown>)['body'];
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body;
}

/**
 * Fetches a report record from DynamoDB by tenant_id and report_id.
 */
async function getReportRecord(
  tenantId: string,
  reportId: string
): Promise<ReportRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(REPORTS_TABLE),
      Key: {
        tenant_id: tenantId,
        report_id: reportId,
      },
    })
  );
  return (result.Item as ReportRecord) ?? null;
}

/**
 * Checks if the user has visibility access to a report based on their role.
 * Returns null if access is allowed, or a 403/404 response if not.
 *
 * Requirements: 8.4, 8.5, 8.6, 11.2, 11.4
 */
function checkReportVisibility(
  user: AuthenticatedUser,
  report: ReportRecord
): ApiGatewayResponse | null {
  const scope = getReportVisibilityScope(user.role);

  switch (scope) {
    case 'tenant':
      // tenant_admin and cso can see all reports in their tenant
      return null;
    case 'site':
      // site_admin and supervisor can see reports for their assigned sites
      // For now, if user is in the same tenant, allow access
      // (full site-level filtering would require site assignment on reports)
      return null;
    case 'own':
      // Other roles can only see their own reports
      if (report.owner_id !== user.user_id) {
        return forbidden('Insufficient permissions');
      }
      return null;
  }
}

/**
 * Gets the latest validation result for a report.
 */
async function getLatestValidationResult(
  reportId: string,
  version: number
): Promise<ValidationResultRecord | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(VALIDATION_RESULTS_TABLE),
      KeyConditionExpression: 'report_id = :rid AND version = :v',
      ExpressionAttributeValues: {
        ':rid': reportId,
        ':v': version,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as ValidationResultRecord;
}

/**
 * Transitions a report's status and records the transition in status_history.
 * Returns null on success, or an error message on failure.
 *
 * Requirements: 2.2, 2.3, 2.5
 */
async function transitionReportStatus(
  tenantId: string,
  reportId: string,
  fromStatus: ReportStatus,
  toStatus: ReportStatus,
  triggeredBy: string
): Promise<string | null> {
  if (!isValidTransition(fromStatus, toStatus)) {
    return `Cannot transition from "${fromStatus}" to "${toStatus}". Valid transitions: [${VALID_TRANSITIONS[fromStatus].join(', ')}]`;
  }

  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(REPORTS_TABLE),
      Key: { tenant_id: tenantId, report_id: reportId },
      UpdateExpression:
        'SET #status = :newStatus, updated_at = :now, status_history = list_append(if_not_exists(status_history, :emptyList), :transition)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':newStatus': toStatus,
        ':now': now,
        ':emptyList': [],
        ':transition': [
          {
            from_status: fromStatus,
            to_status: toStatus,
            triggered_by: triggeredBy,
            timestamp: now,
          },
        ],
      },
    })
  );

  return null;
}

// ---------------------------------------------------------------------------
// POST /report-validation/reports — Create report + presigned URL
// ---------------------------------------------------------------------------

/**
 * Creates a new report record and returns a presigned URL for file upload.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 11.1
 */
async function handleCreateReport(
  event: ApiGatewayEvent,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // RBAC: only roles with reports:upload can create reports
  if (!canUploadReports(user.role)) {
    return forbidden('Insufficient permissions');
  }

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = createReportRequestSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const request = validation.data;
  const reportId = uuidv4();

  try {
    const result = await createReport(
      user.tenant_id,
      user.user_id,
      reportId,
      request
    );

    return createSuccessResponse(201, result);
  } catch (error) {
    logger.error('Failed to create report', {
      report_id: reportId,
      error: error instanceof Error ? error.message : String(error),
    });
    return internalError('Upload could not be completed. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// GET /report-validation/reports — List reports (paginated, filtered)
// ---------------------------------------------------------------------------

/**
 * Lists reports with pagination (max 20 per page), optional status filter,
 * and sort order. Scoped by user role visibility.
 *
 * Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 8.7
 */
async function handleListReports(
  user: AuthenticatedUser,
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  // RBAC: reports:read permission check
  const permError = enforcePermission(user, 'reports:read');
  if (permError) return permError;

  // Parse and validate query parameters
  const queryValidation = listReportsQuerySchema.safeParse(queryParams ?? {});
  if (!queryValidation.success) {
    return badRequest('Invalid query parameters', {
      errors: queryValidation.error.flatten().fieldErrors,
    });
  }

  const { limit, cursor, status, sort_by, sort_order } = queryValidation.data;
  const pageSize = Math.min(limit, MAX_PAGE_SIZE);
  const scope = getReportVisibilityScope(user.role);

  let items: ReportRecord[] = [];

  try {
    if (scope === 'own') {
      // Query by owner_id using GSI
      const result = await docClient.send(
        new QueryCommand({
          TableName: getTableName(REPORTS_TABLE),
          IndexName: 'owner_id-index',
          KeyConditionExpression: 'owner_id = :oid',
          ExpressionAttributeValues: {
            ':oid': user.user_id,
          },
          ScanIndexForward: sort_order === 'asc',
        })
      );
      items = (result.Items ?? []) as ReportRecord[];
    } else {
      // tenant or site scope: query by tenant_id
      const queryParams: Record<string, unknown> = {
        ':tid': user.tenant_id,
      };
      let keyCondition = 'tenant_id = :tid';

      // If filtering by status, use the status GSI
      if (status) {
        const result = await docClient.send(
          new QueryCommand({
            TableName: getTableName(REPORTS_TABLE),
            IndexName: 'status-index',
            KeyConditionExpression: '#pk = :pk',
            ExpressionAttributeNames: { '#pk': 'tenant_id#status' },
            ExpressionAttributeValues: {
              ':pk': `${user.tenant_id}#${status}`,
            },
            ScanIndexForward: sort_order === 'asc',
          })
        );
        items = (result.Items ?? []) as ReportRecord[];
      } else {
        const result = await docClient.send(
          new QueryCommand({
            TableName: getTableName(REPORTS_TABLE),
            KeyConditionExpression: keyCondition,
            ExpressionAttributeValues: queryParams,
            ScanIndexForward: sort_order === 'asc',
          })
        );
        items = (result.Items ?? []) as ReportRecord[];
      }
    }

    // Apply status filter for 'own' scope (not using GSI)
    if (status && scope === 'own') {
      items = items.filter((r) => r.status === status);
    }

    // Sort by the requested field
    items.sort((a, b) => {
      const fieldA = sort_by === 'validation_date' ? a.updated_at : a.created_at;
      const fieldB = sort_by === 'validation_date' ? b.updated_at : b.created_at;
      const cmp = fieldA.localeCompare(fieldB);
      return sort_order === 'asc' ? cmp : -cmp;
    });

    // Apply cursor-based pagination
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = items.findIndex((r) => r.report_id === cursor);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const paginatedItems = items.slice(startIndex, startIndex + pageSize);
    const nextCursor =
      startIndex + pageSize < items.length
        ? paginatedItems[paginatedItems.length - 1]?.report_id
        : undefined;

    return createSuccessResponse(200, {
      reports: paginatedItems,
      pagination: {
        total: items.length,
        page_size: pageSize,
        next_cursor: nextCursor,
      },
    });
  } catch (error) {
    logger.error('Failed to list reports', {
      error: error instanceof Error ? error.message : String(error),
    });
    return internalError('An unexpected error occurred');
  }
}

// ---------------------------------------------------------------------------
// GET /report-validation/reports/{id} — Get report detail
// ---------------------------------------------------------------------------

/**
 * Gets a single report with its latest validation result.
 *
 * Requirements: 8.3, 11.2, 11.4
 */
async function handleGetReport(
  user: AuthenticatedUser,
  reportId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user, 'reports:read');
  if (permError) return permError;

  const report = await getReportRecord(user.tenant_id, reportId);
  if (!report) {
    return notFound('Report not found');
  }

  // Check visibility
  const visError = checkReportVisibility(user, report);
  if (visError) return visError;

  // Get latest validation result for the current version
  const latestValidation = await getLatestValidationResult(
    reportId,
    report.current_version
  );

  return createSuccessResponse(200, {
    report,
    validation_result: latestValidation ?? null,
  });
}

// ---------------------------------------------------------------------------
// POST /report-validation/reports/{id}/validate — Initiate AI validation
// ---------------------------------------------------------------------------

/**
 * Initiates AI validation on a draft report.
 * Transitions status to "validating" and starts the async validation pipeline.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 11.1
 */
async function handleValidateReport(
  user: AuthenticatedUser,
  reportId: string
): Promise<ApiGatewayResponse> {
  // RBAC: only roles with reports:upload can request validation
  if (!canUploadReports(user.role)) {
    return forbidden('Insufficient permissions');
  }

  const report = await getReportRecord(user.tenant_id, reportId);
  if (!report) {
    return notFound('Report not found');
  }

  // Check visibility
  const visError = checkReportVisibility(user, report);
  if (visError) return visError;

  // Validate status transition: only draft → validating is allowed
  if (report.status !== 'draft') {
    return conflict(
      `Cannot transition from "${report.status}" to "validating". Valid transitions: [${VALID_TRANSITIONS[report.status].join(', ')}]`,
      { current_status: report.status, valid_transitions: VALID_TRANSITIONS[report.status] }
    );
  }

  // Transition status to "validating"
  const transitionError = await transitionReportStatus(
    user.tenant_id,
    reportId,
    'draft',
    'validating',
    user.user_id
  );
  if (transitionError) {
    return conflict(transitionError);
  }

  // Get the version record to find the S3 key
  const versionResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('report-versions'),
      KeyConditionExpression: 'report_id = :rid AND version = :v',
      ExpressionAttributeValues: {
        ':rid': reportId,
        ':v': report.current_version,
      },
    })
  );

  const versionRecord = versionResult.Items?.[0];
  if (!versionRecord) {
    // Revert status on failure
    await transitionReportStatus(user.tenant_id, reportId, 'validating', 'draft', 'system');
    return internalError('Version record not found');
  }

  // Start async validation pipeline (non-blocking response)
  // The validation runs asynchronously; the frontend polls for completion
  startValidationPipeline(
    user.tenant_id,
    reportId,
    report.current_version,
    versionRecord['s3_key'] as string,
    versionRecord['mime_type'] as string,
    versionRecord['file_size'] as number,
    versionRecord['page_count'] as number | undefined,
    user.user_id
  ).catch((error) => {
    logger.error('Validation pipeline failed', {
      report_id: reportId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return createSuccessResponse(200, {
    report_id: reportId,
    status: 'validating',
    message: 'Validation initiated',
  });
}

/**
 * Runs the full validation pipeline asynchronously:
 * 1. Extract text from document
 * 2. Run RAG validation
 *
 * On failure, reverts status to "draft".
 */
async function startValidationPipeline(
  tenantId: string,
  reportId: string,
  version: number,
  s3Key: string,
  mimeType: string,
  fileSize: number,
  pageCount: number | undefined,
  requestedBy: string
): Promise<void> {
  try {
    // Step 1: Extract text
    const extractionResult = await extractText({
      tenant_id: tenantId,
      report_id: reportId,
      version,
      s3_key: s3Key,
      mime_type: mimeType,
      file_size: fileSize,
      page_count: pageCount,
    });

    // Check for extraction failure
    if ('error_type' in extractionResult) {
      logger.warn('Text extraction failed during validation', {
        report_id: reportId,
        error_type: extractionResult.error_type,
        message: extractionResult.message,
      });
      await transitionReportStatus(tenantId, reportId, 'validating', 'draft', 'system');
      return;
    }

    // Step 2: Run validation engine
    await runValidation(
      {
        report_id: reportId,
        version,
        extracted_text: extractionResult.text,
        tenant_id: tenantId,
      },
      requestedBy
    );
  } catch (error) {
    logger.error('Validation pipeline error', {
      report_id: reportId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Validation engine handles its own status revert on failure
  }
}

// ---------------------------------------------------------------------------
// POST /report-validation/reports/{id}/versions — Upload new version
// ---------------------------------------------------------------------------

/**
 * Uploads a new version of an existing report.
 * Only allowed when report is in "validated" or "draft" status.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.7, 6.8, 11.1
 */
async function handleUploadVersion(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  reportId: string
): Promise<ApiGatewayResponse> {
  // RBAC: only roles with reports:upload can upload versions
  if (!canUploadReports(user.role)) {
    return forbidden('Insufficient permissions');
  }

  const report = await getReportRecord(user.tenant_id, reportId);
  if (!report) {
    return notFound('Report not found');
  }

  // Only the report owner can upload new versions
  if (!isReportOwner(user.user_id, report.owner_id)) {
    return forbidden('Insufficient permissions');
  }

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = uploadVersionRequestSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { result, error } = await uploadNewVersion(
    user.tenant_id,
    reportId,
    user.user_id,
    report,
    validation.data
  );

  if (error) {
    return badRequest(error);
  }

  return createSuccessResponse(201, result);
}

// ---------------------------------------------------------------------------
// POST /report-validation/reports/{id}/submit — Submit report
// ---------------------------------------------------------------------------

/**
 * Submits a report. Only the report owner can submit.
 * Allowed from "draft" or "validated" status.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.8, 11.3
 */
async function handleSubmitReport(
  user: AuthenticatedUser,
  reportId: string
): Promise<ApiGatewayResponse> {
  // RBAC: only roles with reports:upload can submit
  if (!canUploadReports(user.role)) {
    return forbidden('Insufficient permissions');
  }

  const report = await getReportRecord(user.tenant_id, reportId);
  if (!report) {
    return notFound('Report not found');
  }

  // Only the report owner can submit
  if (!isReportOwner(user.user_id, report.owner_id)) {
    return forbidden('Insufficient permissions');
  }

  // Validate status transition
  if (!isValidTransition(report.status, 'submitted')) {
    return conflict(
      `Cannot transition from "${report.status}" to "submitted". Valid transitions: [${VALID_TRANSITIONS[report.status].join(', ')}]`,
      { current_status: report.status, valid_transitions: VALID_TRANSITIONS[report.status] }
    );
  }

  const now = new Date().toISOString();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: getTableName(REPORTS_TABLE),
        Key: { tenant_id: user.tenant_id, report_id: reportId },
        UpdateExpression:
          'SET #status = :submitted, updated_at = :now, submitted_at = :now, submitted_by = :uid, status_history = list_append(if_not_exists(status_history, :emptyList), :transition)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':submitted': 'submitted',
          ':now': now,
          ':uid': user.user_id,
          ':emptyList': [],
          ':transition': [
            {
              from_status: report.status,
              to_status: 'submitted',
              triggered_by: user.user_id,
              timestamp: now,
            },
          ],
        },
      })
    );

    return createSuccessResponse(200, {
      report_id: reportId,
      status: 'submitted',
      submitted_at: now,
      submitted_by: user.user_id,
    });
  } catch (error) {
    logger.error('Failed to submit report', {
      report_id: reportId,
      error: error instanceof Error ? error.message : String(error),
    });
    return internalError('Submission failed. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// GET /report-validation/reports/{id}/history — Version + validation history
// ---------------------------------------------------------------------------

/**
 * Gets the version and validation history for a report.
 * Returns versions in reverse chronological order with their validation results.
 *
 * Requirements: 6.5, 6.6
 */
async function handleGetHistory(
  user: AuthenticatedUser,
  reportId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(user, 'reports:read');
  if (permError) return permError;

  const report = await getReportRecord(user.tenant_id, reportId);
  if (!report) {
    return notFound('Report not found');
  }

  // Check visibility
  const visError = checkReportVisibility(user, report);
  if (visError) return visError;

  // Get version history (reverse chronological)
  const versions = await getVersionHistory(reportId);

  // Get all validation results for this report
  const validationResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName(VALIDATION_RESULTS_TABLE),
      KeyConditionExpression: 'report_id = :rid',
      ExpressionAttributeValues: {
        ':rid': reportId,
      },
      ScanIndexForward: false,
    })
  );

  const validationResults = (validationResult.Items ?? []) as ValidationResultRecord[];

  // Combine versions with their validation results
  const history = versions.map((version) => {
    const validation = validationResults.find((v) => v.version === version.version);
    return {
      ...version,
      validation_result: validation ?? null,
    };
  });

  return createSuccessResponse(200, { history });
}

// ---------------------------------------------------------------------------
// POST /report-validation/kb/documents — Upload KB context document
// ---------------------------------------------------------------------------

/**
 * Uploads a new Knowledge Base context document.
 * Only tenant_admin can manage KB documents.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.8
 */
async function handleUploadKBDocument(
  event: ApiGatewayEvent,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // RBAC: only tenant_admin can manage KB
  if (!canManageKB(user.role)) {
    return forbidden('Insufficient permissions');
  }

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = uploadKBDocumentRequestSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const documentId = uuidv4();
  const { result, error } = await uploadKBDocument(
    user.tenant_id,
    documentId,
    user.user_id,
    validation.data
  );

  if (error) {
    return badRequest(error);
  }

  return createSuccessResponse(201, result);
}

// ---------------------------------------------------------------------------
// GET /report-validation/kb/documents — List KB context documents
// ---------------------------------------------------------------------------

/**
 * Lists all Knowledge Base context documents for the tenant.
 * Only tenant_admin can view KB documents.
 *
 * Requirement: 13.7
 */
async function handleListKBDocuments(
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // RBAC: only tenant_admin can manage KB
  if (!canManageKB(user.role)) {
    return forbidden('Insufficient permissions');
  }

  try {
    const documents = await listKBDocuments(user.tenant_id);
    return createSuccessResponse(200, { documents });
  } catch (error) {
    logger.error('Failed to list KB documents', {
      error: error instanceof Error ? error.message : String(error),
    });
    return internalError('An unexpected error occurred');
  }
}

// ---------------------------------------------------------------------------
// DELETE /report-validation/kb/documents/{id} — Delete KB context document
// ---------------------------------------------------------------------------

/**
 * Deletes a Knowledge Base context document.
 * Only tenant_admin can delete KB documents.
 *
 * Requirement: 13.10
 */
async function handleDeleteKBDocument(
  user: AuthenticatedUser,
  documentId: string
): Promise<ApiGatewayResponse> {
  // RBAC: only tenant_admin can manage KB
  if (!canManageKB(user.role)) {
    return forbidden('Insufficient permissions');
  }

  const { result, error } = await deleteKBDocument(user.tenant_id, documentId);

  if (error) {
    if (error === 'Document not found') {
      return notFound('Document not found');
    }
    return internalError(error);
  }

  return createSuccessResponse(200, result);
}
