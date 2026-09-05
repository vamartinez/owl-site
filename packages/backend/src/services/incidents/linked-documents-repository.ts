/**
 * Linked Documents Repository: CRUD operations for the IncidentLinkedDocuments DynamoDB table.
 *
 * Manages the relationship between incidents and form responses (investigations,
 * corrective actions, inspections, etc.). Supports soft-delete for unlinking,
 * duplicate prevention, and cross-table queries to FormResponses for linkable responses.
 *
 * Table: IncidentLinkedDocuments
 * PK: INCIDENT#{incident_id}
 * SK: LINK#{linked_at}#{link_id}
 * GSI-1 (tenant-response-index): PK: tenant_id, SK: response_id
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 5.2, 5.3, 5.4, 6.1, 6.2, 6.4
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import type {
  LinkedDocumentInput,
  LinkedDocumentRecord,
  LinkableResponseResult,
  DocumentCategory,
} from './types.js';

const LINKED_DOCUMENTS_TABLE = 'IncidentLinkedDocuments';
const FORM_RESPONSES_TABLE = 'FormResponses';

// ─── Create Linked Document ─────────────────────────────────────────────────

/**
 * Creates a new linked document record, establishing a relationship between
 * an incident and a form response.
 *
 * Generates a UUID v4 for link_id and records the current UTC timestamp.
 *
 * @param input - The linked document input data
 * @returns The created linked document record with generated link_id and linked_at
 *
 * Requirements: 1.2
 */
export async function createLinkedDocument(
  input: LinkedDocumentInput & {
    form_name: string;
    folio: string;
    response_submitted_at: string;
    response_submitted_by: string;
  }
): Promise<LinkedDocumentRecord> {
  const linkId = uuidv4();
  const linkedAt = new Date().toISOString();

  const record: LinkedDocumentRecord = {
    ...input,
    link_id: linkId,
    linked_at: linkedAt,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(LINKED_DOCUMENTS_TABLE),
      Item: {
        PK: `INCIDENT#${input.incident_id}`,
        SK: `LINK#${linkedAt}#${linkId}`,
        // GSI-1 keys for tenant-response-index (duplicate check across incidents)
        tenant_id: input.tenant_id,
        response_id: input.response_id,
        ...record,
      },
    })
  );

  return record;
}

// ─── Get Linked Documents ───────────────────────────────────────────────────

/**
 * Retrieves all active (non-unlinked) linked documents for an incident.
 * Optionally filters by document categories.
 *
 * Results are returned in chronological order by linked_at (ascending SK sort).
 * Soft-deleted items (where unlinked_at is set) are excluded.
 *
 * @param incidentId - The incident identifier
 * @param filters - Optional filter parameters
 * @returns Array of active linked document records and total count
 *
 * Requirements: 3.1, 4.1, 4.2, 5.3
 */
export async function getLinkedDocuments(
  incidentId: string,
  filters?: { categories?: DocumentCategory[] }
): Promise<{ linked_documents: LinkedDocumentRecord[]; total_count: number }> {
  // Build filter expression to exclude soft-deleted items
  const filterExpressions: string[] = ['attribute_not_exists(#unlinked_at)'];
  const expressionAttributeNames: Record<string, string> = {
    '#pk': 'PK',
    '#sk': 'SK',
    '#unlinked_at': 'unlinked_at',
  };
  const expressionAttributeValues: Record<string, unknown> = {
    ':pk': `INCIDENT#${incidentId}`,
    ':skPrefix': 'LINK#',
  };

  // Add category filter if provided
  if (filters?.categories && filters.categories.length > 0) {
    const categoryPlaceholders = filters.categories.map((_, idx) => `:cat${idx}`);
    filterExpressions.push(`document_category IN (${categoryPlaceholders.join(', ')})`);
    filters.categories.forEach((cat, idx) => {
      expressionAttributeValues[`:cat${idx}`] = cat;
    });
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(LINKED_DOCUMENTS_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      FilterExpression: filterExpressions.join(' AND '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: false, // Most recent links first
    })
  );

  const linkedDocuments = (result.Items ?? []) as LinkedDocumentRecord[];

  return {
    linked_documents: linkedDocuments,
    total_count: linkedDocuments.length,
  };
}

// ─── Unlink Document ────────────────────────────────────────────────────────

/**
 * Soft-deletes a linked document by setting unlinked_at, unlinked_by,
 * unlinked_by_name, and unlink_justification fields.
 *
 * The record is preserved for audit trail integrity but will be excluded
 * from active queries.
 *
 * @param incidentId - The incident identifier
 * @param linkId - The link identifier (UUID)
 * @param unlinkData - Data about who is unlinking and why
 * @returns The updated linked document record, or undefined if not found
 *
 * Requirements: 5.2, 5.3, 5.4
 */
export async function unlinkDocument(
  incidentId: string,
  linkId: string,
  unlinkData: {
    unlinked_by: string;
    unlinked_by_name: string;
    unlink_justification: string;
  }
): Promise<LinkedDocumentRecord | undefined> {
  // First, find the document by link_id to get the full SK
  const queryResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName(LINKED_DOCUMENTS_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      FilterExpression: 'link_id = :linkId AND attribute_not_exists(#unlinked_at)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
        '#unlinked_at': 'unlinked_at',
      },
      ExpressionAttributeValues: {
        ':pk': `INCIDENT#${incidentId}`,
        ':skPrefix': 'LINK#',
        ':linkId': linkId,
      },
    })
  );

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return undefined;
  }

  const item = queryResult.Items[0] as LinkedDocumentRecord & { PK: string; SK: string };
  const unlinkedAt = new Date().toISOString();

  // Perform the soft delete update
  const updateResult = await docClient.send(
    new UpdateCommand({
      TableName: getTableName(LINKED_DOCUMENTS_TABLE),
      Key: {
        PK: item.PK,
        SK: item.SK,
      },
      UpdateExpression: 'SET #unlinked_at = :unlinked_at, #unlinked_by = :unlinked_by, #unlinked_by_name = :unlinked_by_name, #unlink_justification = :unlink_justification',
      ExpressionAttributeNames: {
        '#unlinked_at': 'unlinked_at',
        '#unlinked_by': 'unlinked_by',
        '#unlinked_by_name': 'unlinked_by_name',
        '#unlink_justification': 'unlink_justification',
      },
      ExpressionAttributeValues: {
        ':unlinked_at': unlinkedAt,
        ':unlinked_by': unlinkData.unlinked_by,
        ':unlinked_by_name': unlinkData.unlinked_by_name,
        ':unlink_justification': unlinkData.unlink_justification,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return updateResult.Attributes as LinkedDocumentRecord;
}

// ─── Check Already Linked ───────────────────────────────────────────────────

/**
 * Checks whether a form response is already actively linked to an incident.
 * Excludes soft-deleted (unlinked) records from the check.
 *
 * @param incidentId - The incident identifier
 * @param responseId - The form response identifier to check
 * @returns true if an active link exists, false otherwise
 *
 * Requirements: 1.4
 */
export async function isAlreadyLinked(
  incidentId: string,
  responseId: string
): Promise<boolean> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(LINKED_DOCUMENTS_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      FilterExpression: 'response_id = :responseId AND attribute_not_exists(#unlinked_at)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
        '#unlinked_at': 'unlinked_at',
      },
      ExpressionAttributeValues: {
        ':pk': `INCIDENT#${incidentId}`,
        ':skPrefix': 'LINK#',
        ':responseId': responseId,
      },
    })
  );

  return (result.Items ?? []).length > 0;
}

// ─── Get Linkable Responses ─────────────────────────────────────────────────

/**
 * Queries the FormResponses table to find responses available for linking.
 * Filters by tenant_id for tenant isolation, and optionally applies:
 * - Search: partial case-insensitive match on form_name, folio, or submitted_by
 * - Date range: filter by submitted_at between dateFrom and dateTo
 * - Pagination: max pageSize items per page (capped at 20)
 *
 * Note: DynamoDB does not natively support case-insensitive contains. The search
 * filter is applied post-query on the returned items. For large datasets, consider
 * using a search service (OpenSearch/Elasticsearch).
 *
 * @param tenantId - The tenant identifier for isolation
 * @param options - Optional search, date, and pagination parameters
 * @returns Paginated list of linkable form responses
 *
 * Requirements: 1.1, 6.1, 6.2, 6.4
 */
export async function getLinkableResponses(
  tenantId: string,
  options?: {
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<{ responses: LinkableResponseResult[]; total_count: number; page: number; page_size: number }> {
  const page = options?.page ?? 1;
  const pageSize = Math.min(options?.pageSize ?? 20, 20);

  // Query FormResponses by tenant_id using GSI
  // The FormResponses table uses PK: FORM#{form_id}, SK: RESPONSE#{response_id}
  // We need to scan/query by tenant_id — use a filter on tenant_id
  // In the existing system, responses are queried per form. For cross-form search,
  // we query using the tenant_id GSI if available, or scan with filter.

  // Build key condition and filter expressions
  const keyConditionExpression = 'tenant_id = :tenantId';
  const expressionAttributeValues: Record<string, unknown> = {
    ':tenantId': tenantId,
  };
  const filterExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};

  // Date range filter on submitted_at
  if (options?.dateFrom && options?.dateTo) {
    filterExpressions.push('submitted_at BETWEEN :dateFrom AND :dateTo');
    expressionAttributeValues[':dateFrom'] = options.dateFrom;
    expressionAttributeValues[':dateTo'] = options.dateTo;
  } else if (options?.dateFrom) {
    filterExpressions.push('submitted_at >= :dateFrom');
    expressionAttributeValues[':dateFrom'] = options.dateFrom;
  } else if (options?.dateTo) {
    filterExpressions.push('submitted_at <= :dateTo');
    expressionAttributeValues[':dateTo'] = options.dateTo;
  }

  const queryInput: Record<string, unknown> = {
    TableName: getTableName(FORM_RESPONSES_TABLE),
    IndexName: 'tenant-index',
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ScanIndexForward: false, // Most recent first
  };

  if (filterExpressions.length > 0) {
    queryInput['FilterExpression'] = filterExpressions.join(' AND ');
  }

  if (Object.keys(expressionAttributeNames).length > 0) {
    queryInput['ExpressionAttributeNames'] = expressionAttributeNames;
  }

  const result = await docClient.send(new QueryCommand(queryInput as any));
  let items = (result.Items ?? []) as Array<{
    response_id: string;
    form_id: string;
    form_name?: string;
    folio: string;
    submitted_at: string;
    submitted_by_name?: string;
    tenant_id: string;
  }>;

  // Apply search filter in-memory (case-insensitive partial match)
  if (options?.search) {
    const searchLower = options.search.toLowerCase();
    items = items.filter((item) => {
      const formName = (item.form_name ?? '').toLowerCase();
      const folio = (item.folio ?? '').toLowerCase();
      const submittedBy = (item.submitted_by_name ?? '').toLowerCase();
      return (
        formName.includes(searchLower) ||
        folio.includes(searchLower) ||
        submittedBy.includes(searchLower)
      );
    });
  }

  // Calculate pagination
  const totalCount = items.length;
  const startIndex = (page - 1) * pageSize;
  const paginatedItems = items.slice(startIndex, startIndex + pageSize);

  // Map to LinkableResponseResult
  const responses: LinkableResponseResult[] = paginatedItems.map((item) => ({
    response_id: item.response_id,
    form_id: item.form_id,
    form_name: item.form_name ?? '',
    folio: item.folio,
    submitted_at: item.submitted_at,
    submitted_by_name: item.submitted_by_name ?? '',
  }));

  return {
    responses,
    total_count: totalCount,
    page,
    page_size: pageSize,
  };
}
