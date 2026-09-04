/**
 * Folder Navigation Handler for the Document Explorer service.
 * GET /documents/folders — Returns folder tree structure and documents at a given path.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */

import type { ApiGatewayEvent, AuthenticatedUser } from '../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { createSuccessResponse, badRequest, internalError } from '../../shared/error-handler.js';
import { folderRequestSchema } from './schemas.js';
import { aggregateDocuments } from './aggregator.js';
import { computeFolderPath, getItemsAtPath } from './folder-path.js';
import { paginate } from './pagination.js';
import type { FolderContentsResponse, OrganizationMode, UnifiedDocument } from './types.js';

/**
 * Handles GET /documents/folders requests.
 * Parses query params, aggregates documents, computes folder paths,
 * and returns folders + paginated documents at the requested path level.
 */
export async function handleFolders(
  event: ApiGatewayEvent,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // Parse and validate query parameters
  const queryParams =
    (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;

  const validation = folderRequestSchema.safeParse(queryParams ?? {});
  if (!validation.success) {
    return badRequest('Invalid request parameters', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { path, org_mode, page, page_size } = validation.data;
  const orgMode = org_mode as OrganizationMode;

  // Parse path segments (empty string = root)
  const pathSegments = path ? path.split('/').filter((s) => s.length > 0) : [];

  // Aggregate documents from all source tables
  const { documents, unavailableSources } = await aggregateDocuments(user);

  // Compute folder paths for each document
  const docsWithPaths: UnifiedDocument[] = documents.map((doc) => ({
    ...doc,
    folderPath: computeFolderPath(doc, orgMode),
  }));

  // Get folders and documents at the requested path level
  const { folders, documentsAtPath } = getItemsAtPath(docsWithPaths, pathSegments);

  // Paginate the documents at this path level
  const paginated = paginate(documentsAtPath, page, page_size);

  // Strip sensitive fields (tenantId, s3Key, sha256Hash) from documents
  const sanitizedDocuments = paginated.data.map(
    ({ tenantId, s3Key, sha256Hash, ...rest }) => rest
  );

  const response: FolderContentsResponse = {
    currentPath: pathSegments,
    folders,
    documents: sanitizedDocuments,
    totalDocuments: paginated.total,
    page: paginated.page,
    pageSize: paginated.pageSize,
    totalPages: paginated.totalPages,
    ...(unavailableSources.length > 0 && { unavailableSources }),
  };

  return createSuccessResponse(200, response);
}
