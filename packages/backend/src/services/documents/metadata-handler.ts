/**
 * Metadata Handler for the Document Explorer service.
 * GET /documents/{id}/metadata — Returns full document metadata with access verification.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

import type { AuthenticatedUser } from '../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { createSuccessResponse, badRequest, notFound, forbidden } from '../../shared/error-handler.js';
import { Role } from '../../shared/types/common.js';
import { aggregateDocuments } from './aggregator.js';
import type { DocumentDetail, IntegrityStatus } from './types.js';

/**
 * Handles GET /documents/{id}/metadata requests.
 * Finds a document by ID across all source tables, verifies tenant/site access,
 * and returns the full DocumentDetail response.
 */
export async function handleMetadata(
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

  // Build DocumentDetail response (some fields may not be available from source tables)
  const detail: DocumentDetail = {
    ...document,
    creatorUserId: '',       // Not available from source tables
    creatorUserName: '',     // Not available from source tables
    downloadCount: 0,        // Not tracked in source tables
    lastDownloadedAt: null,  // Not tracked in source tables
    integrityStatus: document.sha256Hash ? 'pending' as IntegrityStatus : 'unavailable' as IntegrityStatus,
    lastVerifiedAt: null,    // Not tracked without separate verification store
  };

  return createSuccessResponse(200, { document: detail });
}
