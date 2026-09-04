/**
 * Audit Trail: Records all admin actions for compliance and regulatory purposes.
 *
 * Records audit trail entries for:
 * - Role assignments
 * - Policy changes
 * - Override approvals
 * - Any other admin actions
 *
 * Each entry includes: acting_user, target_resource, action, timestamp.
 * Audit records are retained for a minimum of 90 days (enforced via DynamoDB TTL).
 *
 * Requirements: 14.7, 14.8
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from './dynamo-client.js';
import { createLogger } from './logger.js';

const AUDIT_TRAIL_TABLE = 'AuditTrail';
const logger = createLogger('audit-trail');

/** Minimum retention period in days */
export const AUDIT_RETENTION_DAYS = 90;

export interface AuditEntry {
  audit_id: string;
  tenant_id: string;
  acting_user: string;
  action: AuditAction;
  target_resource: string;
  target_resource_type: string;
  details?: Record<string, unknown>;
  timestamp: string;
  ttl?: number; // DynamoDB TTL (epoch seconds) — minimum 90 days from creation
}

export type AuditAction =
  | 'role_assignment'
  | 'role_removal'
  | 'policy_created'
  | 'policy_version_published'
  | 'policy_updated'
  | 'override_requested'
  | 'override_approved'
  | 'override_rejected'
  | 'worker_created'
  | 'worker_updated'
  | 'worker_deleted'
  | 'certification_validated'
  | 'certification_rejected'
  | 'finding_confirmed'
  | 'finding_dismissed'
  | 'enforcement_action_created'
  | 'enforcement_action_resolved'
  | 'contractor_created'
  | 'contractor_updated'
  | 'site_created'
  | 'site_updated'
  | 'tenant_configured';

/**
 * Records an audit trail entry.
 * TTL is set to 90 days minimum from creation (can be extended but never shortened).
 */
export async function recordAuditEntry(params: {
  tenant_id: string;
  acting_user: string;
  action: AuditAction;
  target_resource: string;
  target_resource_type: string;
  details?: Record<string, unknown>;
}): Promise<AuditEntry> {
  const now = new Date();
  const timestamp = now.toISOString();
  const auditId = uuidv4();

  // TTL: minimum 90 days from now (in epoch seconds)
  const ttlEpochSeconds = Math.floor(now.getTime() / 1000) + AUDIT_RETENTION_DAYS * 24 * 60 * 60;

  const entry: AuditEntry = {
    audit_id: auditId,
    tenant_id: params.tenant_id,
    acting_user: params.acting_user,
    action: params.action,
    target_resource: params.target_resource,
    target_resource_type: params.target_resource_type,
    details: params.details,
    timestamp,
    ttl: ttlEpochSeconds,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(AUDIT_TRAIL_TABLE),
      Item: {
        PK: `TENANT#${params.tenant_id}`,
        SK: `AUDIT#${timestamp}#${auditId}`,
        GSI1PK: `TENANT#${params.tenant_id}#USER#${params.acting_user}`,
        GSI1SK: timestamp,
        ...entry,
      },
    })
  );

  logger.info('Audit entry recorded', {
    audit_id: auditId,
    tenant_id: params.tenant_id,
    acting_user: params.acting_user,
    action: params.action,
    target_resource: params.target_resource,
  });

  return entry;
}

/**
 * Queries audit trail entries for a tenant within a time range.
 */
export async function queryAuditTrail(
  tenantId: string,
  options?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    cursor?: string;
  }
): Promise<{ entries: AuditEntry[]; nextCursor?: string }> {
  const limit = options?.limit ?? 50;

  let keyConditionExpression = '#pk = :pk';
  const expressionAttributeNames: Record<string, string> = { '#pk': 'PK' };
  const expressionAttributeValues: Record<string, unknown> = {
    ':pk': `TENANT#${tenantId}`,
  };

  if (options?.startDate && options?.endDate) {
    keyConditionExpression += ' AND #sk BETWEEN :start AND :end';
    expressionAttributeNames['#sk'] = 'SK';
    expressionAttributeValues[':start'] = `AUDIT#${options.startDate}`;
    expressionAttributeValues[':end'] = `AUDIT#${options.endDate}~`;
  } else if (options?.startDate) {
    keyConditionExpression += ' AND #sk >= :start';
    expressionAttributeNames['#sk'] = 'SK';
    expressionAttributeValues[':start'] = `AUDIT#${options.startDate}`;
  } else {
    keyConditionExpression += ' AND begins_with(#sk, :prefix)';
    expressionAttributeNames['#sk'] = 'SK';
    expressionAttributeValues[':prefix'] = 'AUDIT#';
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(AUDIT_TRAIL_TABLE),
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      Limit: limit,
      ScanIndexForward: false, // Most recent first
      ExclusiveStartKey: options?.cursor
        ? JSON.parse(Buffer.from(options.cursor, 'base64').toString())
        : undefined,
    })
  );

  const entries = (result.Items ?? []) as AuditEntry[];
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { entries, nextCursor };
}

/**
 * Queries audit trail entries by a specific user.
 */
export async function queryAuditTrailByUser(
  tenantId: string,
  userId: string,
  options?: {
    limit?: number;
    cursor?: string;
  }
): Promise<{ entries: AuditEntry[]; nextCursor?: string }> {
  const limit = options?.limit ?? 50;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(AUDIT_TRAIL_TABLE),
      IndexName: 'GSI1',
      KeyConditionExpression: '#gsi1pk = :pk',
      ExpressionAttributeNames: {
        '#gsi1pk': 'GSI1PK',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#USER#${userId}`,
      },
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey: options?.cursor
        ? JSON.parse(Buffer.from(options.cursor, 'base64').toString())
        : undefined,
    })
  );

  const entries = (result.Items ?? []) as AuditEntry[];
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { entries, nextCursor };
}
