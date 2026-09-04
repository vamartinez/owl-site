/**
 * Scan Session Manager.
 * Records scan sessions and implements QR replay detection.
 *
 * Business Rules:
 * - Records: worker, site, timestamp, scanner_type, device_id, token_ref, decision_ref, result
 * - QR replay detection: same token reused OR different device → replay_risk_flag + deny
 *
 * Requirements: 4.8, 4.9, 4.11
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import type { ScanSession } from './types.js';

/**
 * Records a new scan session in DynamoDB.
 */
export async function recordScanSession(
  session: Omit<ScanSession, 'session_id'>
): Promise<ScanSession> {
  const sessionId = uuidv4();
  const fullSession: ScanSession = {
    session_id: sessionId,
    ...session,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName('ScanSessions'),
      Item: {
        PK: `TENANT#${session.tenant_id}`,
        SK: `SESSION#${sessionId}`,
        GSI1PK: `WORKER#${session.worker_id}`,
        GSI1SK: `SESSION#${session.timestamp}`,
        GSI2PK: `SITE#${session.site_id}`,
        GSI2SK: `SESSION#${session.timestamp}`,
        GSI3PK: `TOKEN#${session.token_ref}`,
        GSI3SK: `SESSION#${session.timestamp}`,
        ...fullSession,
      },
    })
  );

  return fullSession;
}

/**
 * Checks for QR replay risk.
 * A replay is detected when:
 * 1. The same token has already been used in a previous scan session, OR
 * 2. The token is being presented from a different device than the original
 *
 * Returns true if replay risk is detected.
 */
export async function detectReplay(
  tenantId: string,
  tokenId: string,
  deviceId: string
): Promise<{ isReplay: boolean; reason?: string }> {
  // Query existing scan sessions for this token
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('ScanSessions'),
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :tokenPk',
      ExpressionAttributeValues: {
        ':tokenPk': `TOKEN#${tokenId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    // No previous scans with this token — not a replay
    return { isReplay: false };
  }

  // Token has been used before — this is a replay
  const previousSession = result.Items[0] as Record<string, unknown>;
  const previousDeviceId = previousSession['device_id'] as string;

  if (previousDeviceId !== deviceId) {
    return {
      isReplay: true,
      reason: 'Token presented from a different device than the original scan',
    };
  }

  return {
    isReplay: true,
    reason: 'Token has already been used in a previous scan session',
  };
}

/**
 * Gets scan sessions for a specific worker at a site.
 */
export async function getScanSessionsForWorker(
  tenantId: string,
  workerId: string,
  limit = 20
): Promise<ScanSession[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('ScanSessions'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :workerPk',
      ExpressionAttributeValues: {
        ':workerPk': `WORKER#${workerId}`,
      },
      ScanIndexForward: false,
      Limit: limit,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items as unknown as ScanSession[];
}

/**
 * Gets scan sessions for a specific site.
 */
export async function getScanSessionsForSite(
  tenantId: string,
  siteId: string,
  limit = 50
): Promise<ScanSession[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('ScanSessions'),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :sitePk',
      ExpressionAttributeValues: {
        ':sitePk': `SITE#${siteId}`,
      },
      ScanIndexForward: false,
      Limit: limit,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items as unknown as ScanSession[];
}
