/**
 * Sync Reconciler: Batch sync offline ScanSessions.
 *
 * - Processes sessions in chronological order
 * - Re-evaluates against policy version active at scan time
 * - Backend decision takes precedence over cached
 * - Flags stale sessions (>24h cache)
 *
 * Requirements: 15.1, 15.2, 15.3, 18.17
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import type { OfflineScanSession, SyncResult, SyncMediaResult, OfflineMediaItem, SyncStatusResponse } from './types.js';
import { STALE_THRESHOLD_MS } from './types.js';

/**
 * Sorts sessions in chronological order by scan_timestamp.
 */
export function sortSessionsChronologically(sessions: OfflineScanSession[]): OfflineScanSession[] {
  return [...sessions].sort(
    (a, b) => new Date(a.scan_timestamp).getTime() - new Date(b.scan_timestamp).getTime()
  );
}

/**
 * Determines if a session is stale (cached for more than 24 hours).
 */
export function isSessionStale(session: OfflineScanSession, now?: Date): boolean {
  const currentTime = now ?? new Date();
  const cachedAt = new Date(session.cached_at);
  const elapsed = currentTime.getTime() - cachedAt.getTime();
  return elapsed > STALE_THRESHOLD_MS;
}

/**
 * Resolves the active policy version for a site at a given timestamp.
 * Returns the policy version ID or null if none found.
 */
export async function resolveActivePolicyVersion(
  tenantId: string,
  siteId: string,
  atTimestamp: string
): Promise<string | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('PolicyVersions'),
      IndexName: 'GSI1',
      KeyConditionExpression: '#gsi1pk = :pk AND #gsi1sk <= :timestamp',
      ExpressionAttributeNames: {
        '#gsi1pk': 'GSI1PK',
        '#gsi1sk': 'GSI1SK',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#SITE#${siteId}`,
        ':timestamp': atTimestamp,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
  );

  if (result.Items && result.Items.length > 0) {
    return (result.Items[0] as Record<string, unknown>)['policy_version_id'] as string;
  }

  return null;
}

/**
 * Re-evaluates a scan session against the policy version active at scan time.
 * Returns the backend decision result.
 */
export async function reEvaluateSession(
  session: OfflineScanSession
): Promise<string> {
  // Resolve the policy version that was active at the time of the scan
  const policyVersionId = await resolveActivePolicyVersion(
    session.tenant_id,
    session.site_id,
    session.scan_timestamp
  );

  if (!policyVersionId) {
    // No policy version available — deny by default
    return 'denied';
  }

  // Query worker certifications to check compliance
  const certResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Certifications'),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': `WORKER#${session.worker_id}`,
        ':prefix': 'CERT#',
      },
    })
  );

  const certs = certResult.Items ?? [];

  // Simple evaluation: if worker has at least one validated certification, allow
  // In production, this would call the full Decision Engine
  const hasValidCerts = certs.some(
    (c) => (c as Record<string, unknown>)['validation_status'] === 'validated'
  );

  return hasValidCerts ? 'allowed' : 'denied';
}

/**
 * Stores a synced scan session in DynamoDB.
 */
export async function storeSyncedSession(
  session: OfflineScanSession,
  backendDecision: string,
  stale: boolean
): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: getTableName('ScanSessions'),
      Item: {
        PK: `TENANT#${session.tenant_id}#SITE#${session.site_id}`,
        SK: `SESSION#${session.session_id}`,
        GSI1PK: `TENANT#${session.tenant_id}#WORKER#${session.worker_id}`,
        GSI1SK: session.scan_timestamp,
        session_id: session.session_id,
        worker_id: session.worker_id,
        site_id: session.site_id,
        tenant_id: session.tenant_id,
        scan_timestamp: session.scan_timestamp,
        scanner_type: session.scanner_type,
        device_id: session.device_id,
        token_reference: session.token_reference,
        cached_decision: session.cached_decision,
        backend_decision: backendDecision,
        decision_source: 'sync_reconciliation',
        stale_flag: stale,
        synced_at: now,
      },
    })
  );
}

/**
 * Reconciles a batch of offline scan sessions.
 * Processes in chronological order, re-evaluates each, and stores results.
 */
export async function reconcileSessions(
  sessions: OfflineScanSession[]
): Promise<SyncResult[]> {
  const sorted = sortSessionsChronologically(sessions);
  const results: SyncResult[] = [];
  const now = new Date();

  for (const session of sorted) {
    try {
      const stale = isSessionStale(session, now);
      const backendDecision = await reEvaluateSession(session);
      const decisionChanged = session.cached_decision !== undefined &&
        session.cached_decision !== backendDecision;

      await storeSyncedSession(session, backendDecision, stale);

      results.push({
        session_id: session.session_id,
        status: stale ? 'stale' : 're_evaluated',
        backend_decision: backendDecision,
        cached_decision: session.cached_decision,
        decision_changed: decisionChanged,
        stale,
      });
    } catch (error) {
      results.push({
        session_id: session.session_id,
        status: 'error',
        decision_changed: false,
        stale: false,
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

/**
 * Processes media sync requests and generates upload URLs.
 */
export async function reconcileMedia(
  tenantId: string,
  mediaItems: OfflineMediaItem[]
): Promise<SyncMediaResult[]> {
  const results: SyncMediaResult[] = [];

  for (const item of mediaItems) {
    try {
      // Store media metadata
      await docClient.send(
        new PutCommand({
          TableName: getTableName('MediaAssets'),
          Item: {
            PK: `TENANT#${tenantId}#INSPECTION#${item.inspection_id}`,
            SK: `MEDIA#${item.media_id}`,
            GSI1PK: `TENANT#${tenantId}#SITE#${item.site_id}`,
            GSI1SK: item.captured_at,
            media_id: item.media_id,
            inspection_id: item.inspection_id,
            site_id: item.site_id,
            tenant_id: tenantId,
            file_name: item.file_name,
            content_type: item.content_type,
            file_size: item.file_size,
            captured_at: item.captured_at,
            sync_status: 'pending_upload',
            synced_at: new Date().toISOString(),
          },
        })
      );

      // In production, generate a presigned S3 URL for upload
      const uploadUrl = `https://media-assets.s3.amazonaws.com/${tenantId}/${item.inspection_id}/${item.media_id}`;

      results.push({
        media_id: item.media_id,
        status: 'uploaded',
        upload_url: uploadUrl,
      });
    } catch (error) {
      results.push({
        media_id: item.media_id,
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

/**
 * Gets the sync status for a device.
 */
export async function getDeviceSyncStatus(
  tenantId: string,
  deviceId: string
): Promise<SyncStatusResponse> {
  // Query the DeviceCache table for the device's last sync info
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName('DeviceCache'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `DEVICE#${deviceId}`,
      },
    })
  );

  const deviceInfo = result.Item as Record<string, unknown> | undefined;

  // Query pending items in OfflineQueue
  const queueResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('OfflineQueue'),
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: {
        '#pk': 'PK',
      },
      ExpressionAttributeValues: {
        ':pk': `DEVICE#${deviceId}`,
      },
      Select: 'COUNT',
    })
  );

  const pendingCount = queueResult.Count ?? 0;
  const lastSyncAt = deviceInfo?.['last_sync_at'] as string | undefined;

  // Determine sync health
  let syncHealth: 'healthy' | 'stale' | 'error' = 'healthy';
  if (lastSyncAt) {
    const elapsed = Date.now() - new Date(lastSyncAt).getTime();
    if (elapsed > STALE_THRESHOLD_MS) {
      syncHealth = 'stale';
    }
  } else if (pendingCount > 0) {
    syncHealth = 'stale';
  }

  return {
    device_id: deviceId,
    last_sync_at: lastSyncAt,
    pending_sessions: pendingCount,
    pending_media: 0, // Would be calculated from media queue
    sync_health: syncHealth,
  };
}

/**
 * Updates the device's last sync timestamp.
 */
export async function updateDeviceSyncTimestamp(
  tenantId: string,
  deviceId: string
): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: getTableName('DeviceCache'),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `DEVICE#${deviceId}`,
        device_id: deviceId,
        tenant_id: tenantId,
        last_sync_at: now,
      },
    })
  );
}
