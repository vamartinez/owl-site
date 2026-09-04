/**
 * AI Orchestration Service Lambda Handler.
 * Handles inspection creation, media upload, AI analysis triggering, and findings.
 *
 * Endpoints:
 * - POST /inspections — Create inspection
 * - POST /inspections/{id}/media — Upload media (signed URL)
 * - POST /inspections/{id}/analyze — Trigger AI analysis
 * - GET /findings — List findings
 * - GET /findings/{id} — Get finding detail
 * - POST /findings/{id}/review — Confirm or dismiss finding
 *
 * Requirements: 6.5, 6.6, 6.7, 9.1, 9.2, 9.3, 11.3
 */

import { z } from 'zod';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  internalError,
  unprocessableEntity,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import {
  validateImageMetadata,
  createInspection,
  getInspection,
  uploadMedia,
  triggerAnalysis,
} from './pipeline.js';
import { InspectionStatus } from './types.js';
import { handler as findingsHandler } from '../findings/handler.js';
import { handler as safetyAiHandler } from '../safety-ai/handler.js';

// --- Zod Schemas ---

const createInspectionSchema = z.object({
  site_id: z.string().uuid('site_id must be a valid UUID'),
  trade: z.string().min(1, 'trade is required').max(100, 'trade must be at most 100 characters'),
  project_phase: z.string().min(1, 'project_phase is required').max(100, 'project_phase must be at most 100 characters'),
  notes: z.string().max(1000, 'notes must be at most 1000 characters').optional(),
});

const uploadMediaSchema = z.object({
  file_name: z.string().min(1, 'file_name is required').max(255, 'file_name must be at most 255 characters'),
  content_type: z.string().min(1, 'content_type is required'),
  file_size: z.number().int().positive('file_size must be a positive integer'),
  width: z.number().int().positive('width must be a positive integer'),
  height: z.number().int().positive('height must be a positive integer'),
});

// --- Lambda Handler ---

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;
    const pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;

    // Delegate /findings routes to the findings handler
    if (resource && resource.startsWith('/findings')) {
      return findingsHandler(event);
    }

    // Delegate /safety-ai routes to the safety-ai handler
    if (resource && resource.startsWith('/safety-ai')) {
      return safetyAiHandler(event);
    }

    // Authenticate
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    // Route to appropriate handler
    if (httpMethod === 'POST' && resource === '/inspections') {
      return handleCreateInspection(event, user);
    }

    if (httpMethod === 'POST' && resource === '/inspections/{id}/media') {
      const inspectionId = pathParameters?.['id'];
      if (!inspectionId) return badRequest('Inspection ID is required');
      return handleUploadMedia(event, inspectionId, user);
    }

    if (httpMethod === 'POST' && resource === '/inspections/{id}/analyze') {
      const inspectionId = pathParameters?.['id'];
      if (!inspectionId) return badRequest('Inspection ID is required');
      return handleTriggerAnalysis(inspectionId, user);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('AI Orchestration handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// --- Route Handlers ---

/**
 * POST /inspections
 * Creates a new inspection record.
 */
async function handleCreateInspection(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'inspections:create'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = createInspectionSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const inspection = await createInspection(
    user.tenant_id,
    user.user_id,
    validation.data
  );

  return createSuccessResponse(201, { inspection });
}

/**
 * POST /inspections/{id}/media
 * Validates image metadata and returns a pre-signed S3 URL for upload.
 * Requirement 6.6: JPEG/PNG only, max 25MB, min 640×480.
 * Requirement 6.7: Reject with specific error if invalid.
 */
async function handleUploadMedia(
  event: ApiGatewayEvent,
  inspectionId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'inspections:upload_media'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = uploadMediaSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { file_name, content_type, file_size, width, height } = validation.data;

  // Validate image against acceptance criteria (Requirement 6.6, 6.7)
  const imageError = validateImageMetadata(content_type, file_size, width, height);
  if (imageError) {
    return unprocessableEntity(imageError);
  }

  // Verify inspection exists and belongs to tenant
  const inspection = await getInspection(user.tenant_id, inspectionId);
  if (!inspection) {
    return notFound('Inspection not found');
  }

  // Generate signed URL and create media asset
  const result = await uploadMedia(
    user.tenant_id,
    user.user_id,
    inspectionId,
    inspection,
    { file_name, content_type, file_size, width, height }
  );

  return createSuccessResponse(201, result);
}

/**
 * POST /inspections/{id}/analyze
 * Triggers AI analysis pipeline by publishing InspectionUploaded event.
 * Requirement 11.3: Initiate pipeline within 5 seconds.
 */
async function handleTriggerAnalysis(
  inspectionId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'inspections:create'
  );
  if (permError) return permError;

  // Verify inspection exists and belongs to tenant
  const inspection = await getInspection(user.tenant_id, inspectionId);
  if (!inspection) {
    return notFound('Inspection not found');
  }

  // Ensure inspection has media uploaded
  if (inspection.status === InspectionStatus.CREATED && inspection.media_count === 0) {
    return badRequest('Inspection has no media uploaded. Upload at least one image before triggering analysis.');
  }

  // Ensure inspection is not already being analyzed
  if (inspection.status === InspectionStatus.ANALYZING) {
    return badRequest('Analysis is already in progress for this inspection.');
  }

  // Trigger analysis
  const result = await triggerAnalysis(
    user.tenant_id,
    user.user_id,
    inspectionId,
    inspection
  );

  return createSuccessResponse(202, {
    message: 'AI analysis pipeline initiated',
    inspection_id: inspectionId,
    event_id: result.event_id,
    status: InspectionStatus.ANALYZING,
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
