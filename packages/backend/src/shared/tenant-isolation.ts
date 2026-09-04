/**
 * Tenant Isolation: Enforces tenant_id filtering on all DynamoDB queries.
 *
 * - All queries MUST include tenant_id in the partition key or filter expression
 * - Cross-tenant access returns 403 without revealing resource existence
 * - Platform admins can access any tenant's data
 *
 * Requirements: 14.1, 14.2
 */

import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from './dynamo-client.js';
import { forbidden } from './error-handler.js';
import type { ApiGatewayResponse } from './error-handler.js';
import type { AuthenticatedUser } from './auth-middleware.js';
import { Role } from './types/common.js';
import { createLogger } from './logger.js';

const logger = createLogger('tenant-isolation');

/**
 * Validates that the authenticated user has access to the specified tenant's data.
 * Returns null if access is allowed, or a 403 response if denied.
 *
 * Cross-tenant access returns 403 without revealing resource existence (Req 14.2).
 */
export function validateTenantAccess(
  user: AuthenticatedUser,
  resourceTenantId: string
): ApiGatewayResponse | null {
  // Platform admins can access any tenant
  if (user.role === Role.PLATFORM_ADMIN) {
    return null;
  }

  if (user.tenant_id !== resourceTenantId) {
    logger.warn('Cross-tenant access attempt blocked', {
      user_id: user.user_id,
      user_tenant: user.tenant_id,
      target_tenant: resourceTenantId,
    });
    // Return generic 403 without revealing resource existence
    return forbidden('Access denied');
  }

  return null;
}

/**
 * Builds a tenant-scoped partition key for DynamoDB queries.
 * Ensures all queries are scoped to the correct tenant.
 */
export function tenantScopedPK(tenantId: string, prefix?: string): string {
  if (prefix) {
    return `TENANT#${tenantId}#${prefix}`;
  }
  return `TENANT#${tenantId}`;
}

/**
 * Performs a tenant-isolated get operation.
 * Returns null if the item doesn't exist OR belongs to a different tenant.
 * This prevents information leakage about resource existence across tenants.
 */
export async function tenantIsolatedGet<T>(
  tableName: string,
  tenantId: string,
  pk: string,
  sk: string
): Promise<T | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(tableName),
      Key: { PK: pk, SK: sk },
    })
  );

  if (!result.Item) return null;

  // Verify tenant ownership
  const itemTenantId = (result.Item as Record<string, unknown>)['tenant_id'] as string | undefined;
  if (itemTenantId && itemTenantId !== tenantId) {
    logger.warn('Tenant isolation violation detected in get', {
      table: tableName,
      requested_tenant: tenantId,
      item_tenant: itemTenantId,
    });
    return null; // Return null as if resource doesn't exist
  }

  return result.Item as T;
}

/**
 * Performs a tenant-isolated query operation.
 * Ensures the partition key includes the tenant scope.
 */
export async function tenantIsolatedQuery<T>(
  tableName: string,
  tenantId: string,
  keyConditionExpression: string,
  expressionAttributeValues: Record<string, unknown>,
  options?: {
    indexName?: string;
    expressionAttributeNames?: Record<string, string>;
    filterExpression?: string;
    limit?: number;
    scanIndexForward?: boolean;
    exclusiveStartKey?: Record<string, unknown>;
  }
): Promise<{ items: T[]; lastEvaluatedKey?: Record<string, unknown> }> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(tableName),
      IndexName: options?.indexName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: options?.expressionAttributeNames,
      FilterExpression: options?.filterExpression,
      Limit: options?.limit,
      ScanIndexForward: options?.scanIndexForward,
      ExclusiveStartKey: options?.exclusiveStartKey,
    })
  );

  // Double-check tenant isolation on results
  const items = (result.Items ?? []).filter((item) => {
    const itemTenantId = (item as Record<string, unknown>)['tenant_id'] as string | undefined;
    if (itemTenantId && itemTenantId !== tenantId) {
      logger.warn('Tenant isolation violation detected in query results', {
        table: tableName,
        requested_tenant: tenantId,
        item_tenant: itemTenantId,
      });
      return false;
    }
    return true;
  }) as T[];

  return {
    items,
    lastEvaluatedKey: result.LastEvaluatedKey,
  };
}

/**
 * Verifies that a resource belongs to the specified tenant.
 * Returns true if the resource belongs to the tenant, false otherwise.
 * Used as a guard before performing operations on resources.
 */
export function verifyResourceOwnership(
  resource: Record<string, unknown>,
  tenantId: string
): boolean {
  const resourceTenantId = resource['tenant_id'] as string | undefined;
  return resourceTenantId === tenantId;
}
