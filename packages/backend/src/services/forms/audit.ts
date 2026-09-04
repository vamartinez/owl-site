/**
 * Forms Audit Module.
 * Records audit entries for all form-related actions in the FormAuditLog table.
 *
 * Key behaviors:
 * - Generates ISO 8601 UTC timestamp
 * - Generates a short UUID suffix for SK uniqueness
 * - Sets TTL (expiresAt) to 365 days from creation
 * - If the write fails, throws the error to reject the parent operation (Req 16.5)
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import {
  AuditEntityType,
  AuditAction,
  AUDIT_TTL_SECONDS,
} from './types.js';
import type { AuditEntry } from './types.js';

const FORM_AUDIT_LOG_TABLE = 'FormAuditLog';
const logger = createLogger('forms-audit');

/**
 * Parameters for logging an audit entry.
 */
export interface LogAuditParams {
  entity_type: AuditEntityType;
  entity_id: string;
  action: AuditAction;
  actor_id: string;
  ip_address: string;
  metadata: Record<string, unknown>;
  tenant_id: string;
  /** Used for PK construction (FORM#{form_id}) */
  form_id: string;
}

/**
 * Logs an audit entry to the FormAuditLog table.
 *
 * - Generates timestamp as ISO 8601 UTC
 * - Generates a short UUID suffix (first 8 chars) for SK uniqueness
 * - Calculates expiresAt as current epoch seconds + 365 days
 * - Writes to DynamoDB using PutCommand
 * - If the write fails, throws the error (caller must handle — rejects parent operation per Req 16.5)
 */
export async function logAuditEntry(params: LogAuditParams): Promise<AuditEntry> {
  const now = new Date();
  const timestamp = now.toISOString();
  const shortUuid = uuidv4().replace(/-/g, '').substring(0, 8);
  const expiresAt = Math.floor(now.getTime() / 1000) + AUDIT_TTL_SECONDS;

  const entry: AuditEntry = {
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    action: params.action,
    actor_id: params.actor_id,
    timestamp,
    ip_address: params.ip_address,
    metadata: params.metadata,
    tenant_id: params.tenant_id,
    expiresAt,
  };

  // Write to DynamoDB — if this fails, the error propagates to reject the parent operation
  await docClient.send(
    new PutCommand({
      TableName: getTableName(FORM_AUDIT_LOG_TABLE),
      Item: {
        PK: `FORM#${params.form_id}`,
        SK: `AUDIT#${timestamp}#${shortUuid}`,
        GSI1PK: `TENANT#${params.tenant_id}`,
        GSI1SK: `AUDIT#${timestamp}`,
        ...entry,
      },
    })
  );

  logger.info('Form audit entry recorded', {
    action: params.action,
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    actor_id: params.actor_id,
    form_id: params.form_id,
    tenant_id: params.tenant_id,
  });

  return entry;
}

// ─── Audit Query ──────────────────────────────────────────────────────────────

/** Maximum audit entries per page */
const AUDIT_PAGE_LIMIT = 50;

/**
 * Result of querying audit entries for a form.
 */
export interface QueryAuditResult {
  entries: AuditEntry[];
  cursor?: string;
}

/**
 * Queries audit entries for a specific form, ordered by timestamp descending.
 *
 * - Queries FormAuditLog table by PK = FORM#{form_id}
 * - ScanIndexForward = false for descending order
 * - Limits to 50 items per page
 * - Supports cursor-based pagination via LastEvaluatedKey/ExclusiveStartKey
 *
 * Requirements: 16.6
 */
export async function queryAuditLog(
  formId: string,
  cursor?: string
): Promise<QueryAuditResult> {
  const exclusiveStartKey = cursor ? decodeCursor(cursor) : undefined;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(FORM_AUDIT_LOG_TABLE),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `FORM#${formId}`,
      },
      ScanIndexForward: false,
      Limit: AUDIT_PAGE_LIMIT,
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    })
  );

  const entries: AuditEntry[] = (result.Items ?? []).map((item) => ({
    entity_type: item['entity_type'] as AuditEntityType,
    entity_id: item['entity_id'] as string,
    action: item['action'] as AuditAction,
    actor_id: item['actor_id'] as string,
    timestamp: item['timestamp'] as string,
    ip_address: item['ip_address'] as string,
    metadata: (item['metadata'] as Record<string, unknown>) ?? {},
    tenant_id: item['tenant_id'] as string,
    expiresAt: item['expiresAt'] as number,
  }));

  const nextCursor = result.LastEvaluatedKey
    ? encodeCursor(result.LastEvaluatedKey)
    : undefined;

  logger.info('Audit log queried', {
    form_id: formId,
    entries_returned: entries.length,
    has_more: !!nextCursor,
  });

  return { entries, cursor: nextCursor };
}

/**
 * Encodes a DynamoDB LastEvaluatedKey as a base64 cursor string.
 */
function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

/**
 * Decodes a base64 cursor string back to a DynamoDB ExclusiveStartKey.
 */
function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as Record<string, unknown>;
}
