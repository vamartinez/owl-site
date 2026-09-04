/**
 * Integrity Verification Handler for the Document Explorer service.
 * POST /documents/{id}/verify-integrity — Verifies document SHA-256 hash integrity.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import type { Readable } from 'stream';
import type { AuthenticatedUser } from '../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  forbidden,
  serviceUnavailable,
} from '../../shared/error-handler.js';
import { Role } from '../../shared/types/common.js';
import { aggregateDocuments } from './aggregator.js';
import type { IntegrityVerificationResponse } from './types.js';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env['DOCUMENTS_BUCKET_NAME'] || process.env['MEDIA_BUCKET_NAME'] || '';

/**
 * Handles POST /documents/{id}/verify-integrity requests.
 * Downloads the file from S3, computes SHA-256 hash, and compares
 * it against the stored hash value.
 */
export async function handleVerifyIntegrity(
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

  // Check if stored hash is available
  if (!document.sha256Hash) {
    return createSuccessResponse(200, {
      documentId: document.id,
      storedHash: null,
      computedHash: null,
      match: false,
      verifiedAt: new Date().toISOString(),
      message: 'No stored hash available for this document',
    });
  }

  // Download file from S3 and compute SHA-256
  let computedHash: string;
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: document.s3Key,
    });

    const s3Response = await s3Client.send(command);
    const body = s3Response.Body as Readable;

    computedHash = await computeSha256(body);
  } catch (error) {
    return serviceUnavailable('Unable to retrieve document from storage for verification');
  }

  const match = computedHash === document.sha256Hash;
  const verifiedAt = new Date().toISOString();

  const response: IntegrityVerificationResponse = {
    documentId: document.id,
    storedHash: document.sha256Hash,
    computedHash,
    match,
    verifiedAt,
  };

  return createSuccessResponse(200, response);
}

/**
 * Computes the SHA-256 hash of a readable stream.
 */
async function computeSha256(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
