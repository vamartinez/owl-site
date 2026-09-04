/**
 * Document Explorer Service Lambda Handler.
 * Routes requests by httpMethod + resource path to individual handlers.
 *
 * Endpoints:
 * - GET /documents/folders — Folder navigation
 * - GET /documents/search — Full-text search
 * - GET /documents/{id}/metadata — Document metadata
 * - GET /documents/{id}/preview — Presigned preview URL
 * - POST /documents/download — Initiate download
 * - GET /documents/download/{downloadId}/status — Download status
 * - POST /documents/{id}/verify-integrity — Integrity verification
 * - GET /documents/preferences/organization-mode — Get preferences
 * - PUT /documents/preferences/organization-mode — Set preferences
 * - POST /documents/audit-log — Record audit event
 *
 * Requirements: 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 12.1
 */

import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import {
  createSuccessResponse,
  badRequest,
  forbidden,
  internalError,
} from '../../shared/error-handler.js';
import { createLogger } from '../../shared/logger.js';
import { Role } from '../../shared/types/common.js';
import { handleFolders } from './folder-handler.js';
import { handleSearch } from './search-handler.js';
import { handleMetadata } from './metadata-handler.js';
import { handlePreview } from './preview-handler.js';
import { handleDownload, handleDownloadStatus } from './download-handler.js';
import { handleVerifyIntegrity } from './integrity-handler.js';
import { handleGetPreferences, handleSetPreferences } from './preferences-handler.js';
import { handleAuditLog } from './audit-handler.js';

const logger = createLogger('document-service');

/** Roles allowed to access the Document Explorer */
const ALLOWED_ROLES: Set<string> = new Set([
  Role.PLATFORM_ADMIN,
  Role.TENANT_ADMIN,
  Role.SITE_ADMIN,
  Role.SUPERVISOR,
  Role.CSO,
]);

/**
 * Lambda entry point for the Document Explorer service.
 * Handles authentication, role-based access control, and route dispatch.
 */
export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  const correlationId =
    event.headers['X-Correlation-Id'] ?? event.headers['x-correlation-id'] ?? '';

  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;
    const path = (event as Record<string, unknown>)['path'] as string;

    // CORS preflight
    if (httpMethod === 'OPTIONS') {
      return createSuccessResponse(200, {});
    }

    // Authentication
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    // Role-based access control
    if (!ALLOWED_ROLES.has(user.role)) {
      return forbidden('Access denied');
    }

    const reqLogger = logger.child({
      correlation_id: correlationId,
      tenant_id: user.tenant_id,
    });
    reqLogger.info('Request received', { method: httpMethod, path });

    const pathParameters =
      (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;

    // ─── Route Matching (uses `path` for {proxy+} compatibility) ──────────────

    // Extract path relative to /documents
    const relativePath = path.replace(/^\/documents\/?/, '') || '';

    // GET /documents/folders
    if (httpMethod === 'GET' && relativePath === 'folders') {
      return handleFolders(event, user);
    }

    // GET /documents/search
    if (httpMethod === 'GET' && relativePath === 'search') {
      return handleSearch(event, user);
    }

    // POST /documents/download
    if (httpMethod === 'POST' && relativePath === 'download') {
      return handleDownload(event, user);
    }

    // GET /documents/download/{downloadId}/status
    const downloadStatusMatch = relativePath.match(/^download\/([^/]+)\/status$/);
    if (httpMethod === 'GET' && downloadStatusMatch) {
      return handleDownloadStatus(downloadStatusMatch[1], user);
    }

    // GET /documents/preferences/organization-mode
    if (httpMethod === 'GET' && relativePath === 'preferences/organization-mode') {
      return handleGetPreferences(user);
    }

    // PUT /documents/preferences/organization-mode
    if (httpMethod === 'PUT' && relativePath === 'preferences/organization-mode') {
      return handleSetPreferences(event, user);
    }

    // POST /documents/audit-log
    if (httpMethod === 'POST' && relativePath === 'audit-log') {
      return handleAuditLog(event, user);
    }

    // GET /documents/{id}/metadata
    const metadataMatch = relativePath.match(/^([^/]+)\/metadata$/);
    if (httpMethod === 'GET' && metadataMatch) {
      return handleMetadata(metadataMatch[1], user);
    }

    // GET /documents/{id}/preview
    const previewMatch = relativePath.match(/^([^/]+)\/preview$/);
    if (httpMethod === 'GET' && previewMatch) {
      return handlePreview(previewMatch[1], user);
    }

    // POST /documents/{id}/verify-integrity
    const verifyMatch = relativePath.match(/^([^/]+)\/verify-integrity$/);
    if (httpMethod === 'POST' && verifyMatch) {
      return handleVerifyIntegrity(verifyMatch[1], user);
    }

    // Catch-all for unmatched routes
    return badRequest('Unsupported route');
  } catch (error) {
    logger.error('Unexpected error', {
      correlation_id: correlationId,
      error: error instanceof Error ? error.stack : String(error),
    });
    return internalError('An unexpected error occurred');
  }
}
