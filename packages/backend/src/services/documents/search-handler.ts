/**
 * Search Handler for the Document Explorer service.
 * GET /documents/search — Full-text search with filters across all document sources.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import type { ApiGatewayEvent, AuthenticatedUser } from '../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { createSuccessResponse, badRequest } from '../../shared/error-handler.js';
import { searchRequestSchema } from './schemas.js';
import { aggregateDocuments } from './aggregator.js';
import { computeFolderPath } from './folder-path.js';
import { paginate } from './pagination.js';
import type { SearchResponse, UnifiedDocument, DocumentCategory, OrganizationMode } from './types.js';

/**
 * Handles GET /documents/search requests.
 * Validates query params, aggregates documents, applies name/date filters,
 * paginates results, and returns with matchFolderPath per result.
 */
export async function handleSearch(
  event: ApiGatewayEvent,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // Parse and validate query parameters
  const queryParams =
    (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;

  const validation = searchRequestSchema.safeParse(queryParams ?? {});
  if (!validation.success) {
    return badRequest('Invalid search parameters', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { q, category, date_from, date_to, site_id, page, page_size } = validation.data;

  // Aggregate documents with optional category/site filter
  const { documents } = await aggregateDocuments(user, {
    category: category as DocumentCategory | undefined,
    siteId: site_id,
  });

  // Apply case-insensitive partial name matching
  const searchLower = q.toLowerCase();
  let filtered = documents.filter((doc) =>
    doc.name.toLowerCase().includes(searchLower)
  );

  // Apply date_from filter (inclusive)
  if (date_from) {
    const fromDate = new Date(date_from);
    filtered = filtered.filter((doc) => new Date(doc.createdAt) >= fromDate);
  }

  // Apply date_to filter (inclusive, end of day)
  if (date_to) {
    const toDate = new Date(date_to + 'T23:59:59.999Z');
    filtered = filtered.filter((doc) => new Date(doc.createdAt) <= toDate);
  }

  // Paginate results
  const paginated = paginate(filtered, page, page_size);

  // Default org mode for folder path computation in search results
  const defaultOrgMode: OrganizationMode = 'category_site_year_month';

  // Build search response with matchFolderPath and stripped sensitive fields
  const results = paginated.data.map(({ tenantId, s3Key, sha256Hash, ...rest }) => ({
    ...rest,
    matchFolderPath: computeFolderPath(rest, defaultOrgMode),
  }));

  const response: SearchResponse = {
    results,
    total: paginated.total,
    page: paginated.page,
    pageSize: paginated.pageSize,
  };

  return createSuccessResponse(200, response);
}
