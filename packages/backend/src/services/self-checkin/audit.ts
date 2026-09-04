/**
 * Self Check-In audit module.
 *
 * Writes an immutable audit entry for every check-in attempt — allowed, denied,
 * or rejected — capturing action, origin channel, token reference, outcome,
 * origin IP, timestamp, and tenant. Modeled on the FormAuditLog pattern
 * (PK/SK + tenant GSI + 365-day expiresAt TTL, RemovalPolicy.RETAIN).
 *
 * Requirements: 7.6
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import {
  SELF_CHECKIN_AUDIT_TABLE,
  AUDIT_TTL_SECONDS,
  type SelfCheckinAuditEntry,
} from './types.js';

const logger = createLogger('self-checkin-audit');

/**
 * Writes one immutable audit entry. Best-effort: an audit write failure is
 * logged but never blocks the check-in flow (the attempt still completes).
 */
export async function logCheckinAudit(entry: SelfCheckinAuditEntry): Promise<void> {
  const timestamp = entry.timestamp ?? new Date().toISOString();
  const shortUuid = uuidv4().slice(0, 8);
  const expiresAt = Math.floor(Date.now() / 1000) + AUDIT_TTL_SECONDS;

  try {
    await docClient.send(
      new PutCommand({
        TableName: getTableName(SELF_CHECKIN_AUDIT_TABLE),
        Item: {
          PK: `SITE#${entry.site_id}`,
          SK: `AUDIT#${timestamp}#${shortUuid}`,
          GSI1PK: `TENANT#${entry.tenant_id}`,
          GSI1SK: `AUDIT#${timestamp}`,
          action: entry.action,
          origin_channel: entry.origin_channel,
          token_ref: entry.token_ref,
          outcome: entry.outcome,
          ip_address: entry.ip_address,
          timestamp,
          tenant_id: entry.tenant_id,
          site_id: entry.site_id,
          expiresAt,
        },
      })
    );
  } catch (err) {
    logger.error('Failed to write self-checkin audit entry', {
      action: entry.action,
      token_ref: entry.token_ref,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
