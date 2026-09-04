/**
 * Sync Service Lambda Handler.
 * Handles offline data synchronization endpoints.
 *
 * Endpoints:
 * - POST /sync/sessions — Batch sync offline scan sessions
 * - POST /sync/media — Batch sync offline media uploads
 * - GET /sync/status — Get sync status for device
 *
 * Requirements: 15.1, 15.2, 15.3, 18.17
 */

import { z } from 'zod';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import {
  reconcileSessions,
  reconcileMedia,
  getDeviceSyncStatus,
  updateDeviceSyncTimestamp,
} from './reconciler.js';
import type { OfflineScanSession, OfflineMediaItem } from './types.js';

// --- Zod Schemas ---

const offlineScanSessionSchema = z.object({
  session_id: z.string().min(1),
  worker_id: z.string().min(1),
  site_id: z.string().min(1),
  tenant_id: z.string().min(1),
  scan_timestamp: z.string().min(1),
  scanner_type: z.string().min(1),
  device_id: z.string().min(1),
  token_reference: z.string().optional(),
  cached_decision: z.string().optional(),
  cached_at: z.string().min(1),
});

const syncSessionsSchema = z.object({
  device_id: z.string().min(1, 'device_id is required'),
  sessions: z.array(offlineScanSessionSchema).min(1, 'At least one session is required').max(100, 'Maximum 100 sessions per batch'),
});

const offlineMediaItemSchema = z.object({
  media_id: z.string().min(1),
  inspection_id: z.string().min(1),
  site_id: z.string().min(1),
  tenant_id: z.string().min(1),
  file_name: z.string().min(1),
  content_type: z.string().min(1),
  file_size: z.number().positive(),
  captured_at: z.string().min(1),
});

const syncMediaSchema = z.object({
  device_id: z.string().min(1, 'device_id is required'),
  media_items: z.array(offlineMediaItemSchema).min(1, 'At least one media item is required').max(50, 'Maximum 50 media items per batch'),
});

// --- Lambda Handler ---

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;
    const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;

    // Authenticate
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    // Route to appropriate handler
    if (httpMethod === 'POST' && resource === '/sync/sessions') {
      return handleSyncSessions(event, user);
    }

    if (httpMethod === 'POST' && resource === '/sync/media') {
      return handleSyncMedia(event, user);
    }

    if (httpMethod === 'GET' && resource === '/sync/status') {
      return handleGetSyncStatus(user, queryStringParameters);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Sync handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// --- Route Handlers ---

/**
 * POST /sync/sessions
 * Batch sync offline scan sessions.
 * Processes in chronological order, re-evaluates against policy version active at scan time.
 * Backend decision takes precedence over cached decision.
 * Flags stale sessions (>24h cache).
 *
 * Requirements: 15.1, 15.2, 15.3
 */
async function handleSyncSessions(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:scan'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = syncSessionsSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { device_id, sessions } = validation.data;

  // Ensure all sessions belong to the authenticated tenant
  const invalidSessions = sessions.filter((s) => s.tenant_id !== user.tenant_id);
  if (invalidSessions.length > 0) {
    return badRequest('All sessions must belong to the authenticated tenant');
  }

  const results = await reconcileSessions(sessions as OfflineScanSession[]);

  // Update device sync timestamp
  await updateDeviceSyncTimestamp(user.tenant_id, device_id);

  const summary = {
    total: results.length,
    synced: results.filter((r) => r.status === 're_evaluated' || r.status === 'synced').length,
    stale: results.filter((r) => r.status === 'stale').length,
    errors: results.filter((r) => r.status === 'error').length,
    decisions_changed: results.filter((r) => r.decision_changed).length,
  };

  return createSuccessResponse(200, { results, summary });
}

/**
 * POST /sync/media
 * Batch sync offline media uploads.
 * Returns presigned URLs for each media item to upload.
 */
async function handleSyncMedia(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'inspections:upload_media'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = syncMediaSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { device_id, media_items } = validation.data;

  // Ensure all media items belong to the authenticated tenant
  const invalidItems = media_items.filter((m) => m.tenant_id !== user.tenant_id);
  if (invalidItems.length > 0) {
    return badRequest('All media items must belong to the authenticated tenant');
  }

  const results = await reconcileMedia(user.tenant_id, media_items as OfflineMediaItem[]);

  // Update device sync timestamp
  await updateDeviceSyncTimestamp(user.tenant_id, device_id);

  const summary = {
    total: results.length,
    uploaded: results.filter((r) => r.status === 'uploaded').length,
    errors: results.filter((r) => r.status === 'error').length,
  };

  return createSuccessResponse(200, { results, summary });
}

/**
 * GET /sync/status
 * Get sync status for a device.
 * Requires device_id query parameter.
 */
async function handleGetSyncStatus(
  user: { user_id: string; tenant_id: string; role: string },
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:scan'
  );
  if (permError) return permError;

  const deviceId = queryParams?.['device_id'];
  if (!deviceId) {
    return badRequest('device_id query parameter is required');
  }

  const status = await getDeviceSyncStatus(user.tenant_id, deviceId);
  return createSuccessResponse(200, { status });
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
