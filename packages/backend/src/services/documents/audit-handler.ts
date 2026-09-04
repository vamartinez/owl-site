/**
 * Audit Log Handler for the Document Explorer service.
 * POST /documents/audit-log — Records document access events for compliance.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */

import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import type { ApiGatewayEvent, AuthenticatedUser } from '../../shared/auth-middleware.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { createSuccessResponse, badRequest, internalError } from '../../shared/error-handler.js';
import { auditLogRequestSchema } from './schemas.js';
import type { AuditLogEntry } from './types.js';

const TABLE_NAME = getTableName('AuditTrail');

/** TTL: 365 days in seconds */
const TTL_DAYS = 365;
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

/**
 * Computes the DynamoDB TTL value for an audit log entry.
 * Returns epoch seconds representing creation time + 365 days.
 * Pure function — suitable for property testing.
 */
export function computeAuditTtl(nowMs: number): number {
  return Math.floor(nowMs / 1000) + TTL_SECONDS;
}

/**
 * Handles POST /documents/audit-log requests.
 * Validates the request body and stores an audit entry in the AuditTrail table.
 * Uses PK: TENANT#{tenant_id}#AUDIT, SK: {timestamp}#{uuid} with 365-day TTL.
 */
export async function handleAuditLog(
  event: ApiGatewayEvent,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // Parse and validate request body
  const body = parseBody(event);
  if (!body) {
    return badRequest('Request body is required');
  }

  const validation = auditLogRequestSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Invalid audit log request', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { eventType, documentIds, userId } = validation.data;

  const timestamp = new Date().toISOString();
  const entryId = uuidv4();
  const ttl = computeAuditTtl(Date.now());

  const auditEntry: AuditLogEntry = {
    eventType,
    documentIds,
    userId,
    tenantId: user.tenant_id,
    timestamp,
    ttl,
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `TENANT#${user.tenant_id}#AUDIT`,
          SK: `${timestamp}#${entryId}`,
          ...auditEntry,
        },
      })
    );

    return createSuccessResponse(201, { message: 'Audit log entry created' });
  } catch (error) {
    return internalError('Failed to create audit log entry');
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function parseBody(event: ApiGatewayEvent): Record<string, unknown> | null {
  const body = (event as Record<string, unknown>)['body'];
  if (!body) return null;

  try {
    if (typeof body === 'string') {
      return JSON.parse(body) as Record<string, unknown>;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
