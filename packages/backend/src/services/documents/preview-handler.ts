/**
 * Preview Handler for the Document Explorer service.
 * GET /documents/{id}/preview — Generates presigned S3 URL for in-browser preview.
 *
 * Requirements: 6.1, 6.2, 6.3
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AuthenticatedUser } from '../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { createSuccessResponse, badRequest, notFound, forbidden } from '../../shared/error-handler.js';
import { Role } from '../../shared/types/common.js';
import { aggregateDocuments } from './aggregator.js';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env['DOCUMENTS_BUCKET_NAME'] || process.env['MEDIA_BUCKET_NAME'] || '';

/** MIME types eligible for in-browser preview */
const PREVIEWABLE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

/** Presigned URL expiration for preview: 15 minutes */
const PREVIEW_URL_EXPIRY_SECONDS = 15 * 60;

/**
 * Handles GET /documents/{id}/preview requests.
 * Verifies document access, checks MIME type eligibility,
 * and generates a presigned S3 URL for preview.
 */
export async function handlePreview(
  id: string | undefined,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  if (!id) {
    return badRequest('Document ID is required');
  }

  // Aggregate all documents for this user (respects tenant/site scoping)
  const { documents } = await aggregateDocuments(user);

  // Find the document by ID
  const document = documents.find((doc) => doc.id === id);

  if (!document) {
    return notFound('Document not found');
  }

  // Verify tenant access
  if (document.tenantId !== user.tenant_id) {
    return forbidden('Access denied');
  }

  // Verify site access for site-scoped roles
  if (
    (user.role === Role.SITE_ADMIN || user.role === Role.SUPERVISOR) &&
    user.assigned_sites &&
    !user.assigned_sites.includes(document.siteId)
  ) {
    return forbidden('Access denied');
  }

  // Check MIME type eligibility
  if (!PREVIEWABLE_MIME_TYPES.has(document.mimeType)) {
    return badRequest('Document type is not previewable. Only PDF, JPEG, and PNG files can be previewed.');
  }

  // Generate presigned S3 URL
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: document.s3Key,
  });

  const previewUrl = await getSignedUrl(s3Client, command, {
    expiresIn: PREVIEW_URL_EXPIRY_SECONDS,
  });

  const expiresAt = new Date(Date.now() + PREVIEW_URL_EXPIRY_SECONDS * 1000).toISOString();

  return createSuccessResponse(200, { previewUrl, expiresAt });
}
