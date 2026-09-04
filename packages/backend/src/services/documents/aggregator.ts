/**
 * Document Aggregator: Multi-source DynamoDB query and normalization.
 *
 * Queries all five document source tables in parallel, normalizes records to
 * the UnifiedDocument schema, and applies tenant/site-level access scoping.
 * Provides graceful degradation when individual source tables are unavailable.
 *
 * Requirements: 2.4, 2.5, 2.6, 2.7, 11.1, 11.2, 11.3, 11.4, 12.2
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import type { AuthenticatedUser } from '../../shared/auth-middleware.js';
import { Role } from '../../shared/types/common.js';
import type { UnifiedDocument, DocumentCategory, SourceTableConfig } from './types.js';

/**
 * Source table configurations with field mappings from table-specific names
 * to the unified document schema.
 */
export const SOURCE_TABLES: SourceTableConfig[] = [
  {
    tableName: 'Reports',
    category: 'reports',
    fieldMap: {
      id: 'report_id',
      name: 'title',
      mimeType: 'mime_type',
      fileSize: 'file_size',
      createdAt: 'created_at',
      siteName: 'site_name',
      siteId: 'site_id',
      tenantId: 'tenant_id',
      s3Key: 's3_key',
      sha256Hash: 'sha256_hash',
    },
  },
  {
    tableName: 'Forms',
    category: 'forms',
    fieldMap: {
      id: 'form_id',
      name: 'name',
      mimeType: 'mime_type',
      fileSize: 'file_size',
      createdAt: 'created_at',
      siteName: 'site_name',
      siteId: 'site_id',
      tenantId: 'tenant_id',
      s3Key: 's3_key',
      sha256Hash: 'sha256_hash',
    },
  },
  {
    tableName: 'Certifications',
    category: 'certifications',
    fieldMap: {
      id: 'certification_id',
      name: 'document_name',
      mimeType: 'mime_type',
      fileSize: 'file_size',
      createdAt: 'created_at',
      siteName: 'site_name',
      siteId: 'site_id',
      tenantId: 'tenant_id',
      s3Key: 's3_key',
      sha256Hash: 'sha256_hash',
    },
  },
  {
    tableName: 'Incidents',
    category: 'incidents',
    fieldMap: {
      id: 'incident_id',
      name: 'title',
      mimeType: 'mime_type',
      fileSize: 'file_size',
      createdAt: 'created_at',
      siteName: 'site_name',
      siteId: 'site_id',
      tenantId: 'tenant_id',
      s3Key: 's3_key',
      sha256Hash: 'sha256_hash',
    },
  },
  {
    tableName: 'SafetyEvidence',
    category: 'safety_evidence',
    fieldMap: {
      id: 'evidence_id',
      name: 'title',
      mimeType: 'mime_type',
      fileSize: 'file_size',
      createdAt: 'created_at',
      siteName: 'site_name',
      siteId: 'site_id',
      tenantId: 'tenant_id',
      s3Key: 's3_key',
      sha256Hash: 'sha256_hash',
    },
  },
];

/**
 * Queries all source tables in parallel with tenant isolation.
 * Applies site-level filtering for site_admin/supervisor roles.
 * Returns unified documents + unavailable sources list.
 *
 * - For platform_admin: no tenant filtering (queries all)
 * - For tenant_admin/cso: tenant-scoped, no site filter
 * - For site_admin/supervisor: tenant-scoped + filter to assigned_sites
 */
export async function aggregateDocuments(
  user: AuthenticatedUser,
  options?: { category?: DocumentCategory; siteId?: string }
): Promise<{ documents: UnifiedDocument[]; unavailableSources: string[] }> {
  const sources = options?.category
    ? SOURCE_TABLES.filter((s) => s.category === options.category)
    : SOURCE_TABLES;

  const results = await Promise.allSettled(
    sources.map((source) => querySourceTable(source, user, options?.siteId))
  );

  const documents: UnifiedDocument[] = [];
  const unavailableSources: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      documents.push(...result.value);
    } else {
      unavailableSources.push(sources[index]!.tableName);
    }
  });

  // Apply site-level filtering for site_admin/supervisor
  if (
    (user.role === Role.SITE_ADMIN || user.role === Role.SUPERVISOR) &&
    user.assigned_sites
  ) {
    const siteSet = new Set(user.assigned_sites);
    return {
      documents: documents.filter((doc) => siteSet.has(doc.siteId)),
      unavailableSources,
    };
  }

  return { documents, unavailableSources };
}

/**
 * Queries a single source table for documents within the user's tenant scope.
 * Uses the TENANT#{tenant_id} partition key pattern with SK prefix filtering.
 */
async function querySourceTable(
  config: SourceTableConfig,
  user: AuthenticatedUser,
  siteId?: string
): Promise<UnifiedDocument[]> {
  const tableName = getTableName(config.tableName);

  // Build the query based on table-specific key patterns
  const skPrefix = getSkPrefix(config.tableName);

  const queryParams: Record<string, unknown> = {
    TableName: tableName,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
    ExpressionAttributeNames: {
      '#pk': 'PK',
      '#sk': 'SK',
    } as Record<string, string>,
    ExpressionAttributeValues: {
      ':pk': `TENANT#${user.tenant_id}`,
      ':skPrefix': skPrefix,
    } as Record<string, string>,
  };

  // Add site filter expression if siteId is provided
  if (siteId) {
    (queryParams['FilterExpression'] as string) = '#siteId = :siteId';
    (queryParams['ExpressionAttributeNames'] as Record<string, string>)['#siteId'] =
      config.fieldMap.siteId;
    (queryParams['ExpressionAttributeValues'] as Record<string, string>)[':siteId'] = siteId;
  }

  const result = await withRetry(() =>
    docClient.send(new QueryCommand(queryParams as ConstructorParameters<typeof QueryCommand>[0]))
  );

  const items = result.Items ?? [];
  return items.map((item) => normalizeDocument(item as Record<string, unknown>, config));
}

/**
 * Returns the sort key prefix for a given table name.
 * Each table uses a different SK prefix pattern.
 */
function getSkPrefix(tableName: string): string {
  switch (tableName) {
    case 'Reports':
      return 'REPORT#';
    case 'Forms':
      return 'FORM#';
    case 'Certifications':
      return 'CERT#';
    case 'Incidents':
      return 'INCIDENT#';
    case 'SafetyEvidence':
      return 'EVIDENCE#';
    default:
      return '';
  }
}

/**
 * Normalizes a raw DynamoDB record to the UnifiedDocument interface
 * using the source table's field mapping configuration.
 *
 * Sets folderPath to an empty array — it is computed later by folder-path.ts
 * based on the user's selected organization mode.
 */
export function normalizeDocument(
  raw: Record<string, unknown>,
  config: SourceTableConfig
): UnifiedDocument {
  return {
    id: String(raw[config.fieldMap.id] ?? ''),
    name: String(raw[config.fieldMap.name] ?? ''),
    category: config.category,
    mimeType: String(raw[config.fieldMap.mimeType] ?? 'application/octet-stream'),
    fileSize: Number(raw[config.fieldMap.fileSize] ?? 0),
    createdAt: String(raw[config.fieldMap.createdAt] ?? new Date().toISOString()),
    siteName: String(raw[config.fieldMap.siteName] ?? ''),
    siteId: String(raw[config.fieldMap.siteId] ?? ''),
    tenantId: String(raw[config.fieldMap.tenantId] ?? ''),
    s3Key: String(raw[config.fieldMap.s3Key] ?? ''),
    sha256Hash: raw[config.fieldMap.sha256Hash] != null
      ? String(raw[config.fieldMap.sha256Hash])
      : null,
    folderPath: [],
  };
}

/**
 * Wraps a DynamoDB operation with retry logic for throttling and timeout errors.
 * Retries once with exponential backoff (200ms base delay).
 *
 * Catches ProvisionedThroughputExceededException and timeout errors.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  retryCount = 1,
  baseDelayMs = 200
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    const isRetryable =
      error instanceof Error &&
      (('name' in error &&
        (error.name === 'ProvisionedThroughputExceededException' ||
          error.name === 'RequestTimeout' ||
          error.name === 'TimeoutError')) ||
        ('code' in error &&
          ((error as { code: string }).code === 'ProvisionedThroughputExceededException' ||
            (error as { code: string }).code === 'RequestTimeout')));

    if (isRetryable && retryCount > 0) {
      await sleep(baseDelayMs);
      return withRetry(operation, retryCount - 1, baseDelayMs * 2);
    }
    throw error;
  }
}

/**
 * Utility sleep function for retry delays.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
