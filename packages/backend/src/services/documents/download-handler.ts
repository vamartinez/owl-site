/**
 * Download Handler for the Document Explorer service.
 * POST /documents/download — Initiates single or batch document download.
 * GET /documents/download/{downloadId}/status — Checks download status.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 10.5
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import type { ApiGatewayEvent, AuthenticatedUser } from '../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  forbidden,
  createErrorResponse,
} from '../../shared/error-handler.js';
import { Role } from '../../shared/types/common.js';
import { downloadRequestSchema } from './schemas.js';
import { aggregateDocuments } from './aggregator.js';
import type { DownloadInitResponse, BatchDownloadStatusResponse } from './types.js';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env['DOCUMENTS_BUCKET_NAME'] || process.env['MEDIA_BUCKET_NAME'] || '';

/** Maximum total size for batch downloads: 500MB */
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

/** Presigned URL expiration for downloads: 60 minutes */
const DOWNLOAD_URL_EXPIRY_SECONDS = 60 * 60;

/**
 * Validates total download size does not exceed 500MB.
 * Pure function — suitable for property testing.
 */
export function validateBatchSize(fileSizes: number[]): { valid: boolean; totalSize: number } {
  const totalSize = fileSizes.reduce((sum, s) => sum + s, 0);
  return { valid: totalSize <= MAX_TOTAL_BYTES, totalSize };
}

/**
 * Handles POST /documents/download requests.
 * Validates document IDs, checks total size, generates presigned URLs.
 * Single doc: returns presigned URL directly.
 * Batch: for now, returns presigned URL for first doc (ZIP logic stubbed).
 */
export async function handleDownload(
  event: ApiGatewayEvent,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // Parse and validate request body
  const body = parseBody(event);
  if (!body) {
    return badRequest('Request body is required');
  }

  const validation = downloadRequestSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Invalid download request', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { documentIds } = validation.data;

  // Aggregate documents for this user
  const { documents } = await aggregateDocuments(user);

  // Find all requested documents
  const documentMap = new Map(documents.map((doc) => [doc.id, doc]));
  const foundDocs = documentIds
    .map((id) => documentMap.get(id))
    .filter((doc): doc is NonNullable<typeof doc> => doc != null);

  if (foundDocs.length === 0) {
    return notFound('No accessible documents found');
  }

  // Verify tenant access for all found documents
  for (const doc of foundDocs) {
    if (doc.tenantId !== user.tenant_id) {
      return forbidden('Access denied');
    }
    if (
      (user.role === Role.SITE_ADMIN || user.role === Role.SUPERVISOR) &&
      user.assigned_sites &&
      !user.assigned_sites.includes(doc.siteId)
    ) {
      return forbidden('Access denied');
    }
  }

  // Validate total size
  const fileSizes = foundDocs.map((doc) => doc.fileSize);
  const { valid, totalSize } = validateBatchSize(fileSizes);

  if (!valid) {
    return createErrorResponse(
      413,
      'PAYLOAD_TOO_LARGE',
      'Total download size exceeds 500MB limit',
      { totalSize, maxSize: MAX_TOTAL_BYTES }
    );
  }

  const downloadId = uuidv4();

  // Single document: generate presigned URL directly
  if (foundDocs.length === 1) {
    const doc = foundDocs[0]!;
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: doc.s3Key,
    });

    const downloadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS,
    });

    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_EXPIRY_SECONDS * 1000).toISOString();

    // Track skipped documents (documents that were requested but not found)
    const skippedDocuments = documentIds
      .filter((id) => !documentMap.has(id))
      .map((id) => ({ id, name: 'Unknown', reason: 'Document not found or inaccessible' }));

    const response: DownloadInitResponse = {
      downloadId,
      downloadUrl,
      expiresAt,
      totalSize: doc.fileSize,
      fileCount: 1,
      ...(skippedDocuments.length > 0 && { skippedDocuments }),
    };

    return createSuccessResponse(200, response);
  }

  // Batch download: generate presigned URL for first doc (ZIP logic is complex, stubbed for now)
  const firstDoc = foundDocs[0]!;
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: firstDoc.s3Key,
  });

  const downloadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS,
  });

  const expiresAt = new Date(Date.now() + DOWNLOAD_URL_EXPIRY_SECONDS * 1000).toISOString();

  const skippedDocuments = documentIds
    .filter((id) => !documentMap.has(id))
    .map((id) => ({ id, name: 'Unknown', reason: 'Document not found or inaccessible' }));

  const response: DownloadInitResponse = {
    downloadId,
    downloadUrl,
    expiresAt,
    totalSize,
    fileCount: foundDocs.length,
    ...(skippedDocuments.length > 0 && { skippedDocuments }),
  };

  return createSuccessResponse(200, response);
}

/**
 * Handles GET /documents/download/{downloadId}/status requests.
 * Returns the status of a download operation.
 * For now, returns a stub response (ready status).
 */
export async function handleDownloadStatus(
  downloadId: string | undefined,
  _user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  if (!downloadId) {
    return badRequest('Download ID is required');
  }

  // Stub: return ready status for any valid download ID
  const response: BatchDownloadStatusResponse = {
    downloadId,
    status: 'ready',
    progress: 100,
  };

  return createSuccessResponse(200, response);
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
