/**
 * Scheduled Lambda: Certification Expiry Checker
 *
 * Runs daily at 00:00 UTC via EventBridge rule.
 * Scans the Certifications table GSI1 for certifications where the expiry date
 * has been reached (today or earlier), updates their status to 'expired',
 * and publishes CertificationExpired events to trigger eligibility recalculation.
 *
 * Requirements: 3.6, 3.7, 11.2
 */

import { QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../shared/dynamo-client.js';
import { publishEvent } from '../shared/event-publisher.js';
import { createLogger } from '../shared/logger.js';
import { EventTypes } from '../shared/types/events.js';
import { CertificationStatus } from '../shared/types/common.js';

const CERTIFICATIONS_TABLE = 'Certifications';
const GSI1_INDEX_NAME = 'GSI1';
const SOURCE_SERVICE = 'cert-expiry-checker';

const logger = createLogger(SOURCE_SERVICE);

/**
 * Represents a certification item as stored in DynamoDB.
 */
interface CertificationItem {
  PK: string; // WORKER#{workerId}
  SK: string; // CERT#{certId}
  GSI1PK: string; // tenantId
  GSI1SK: string; // expiryDate (ISO date string YYYY-MM-DD)
  certification_id: string;
  worker_id: string;
  tenant_id: string;
  certification_type: string;
  expiry_date: string;
  validation_status: string;
  [key: string]: unknown;
}

/**
 * Gets today's date in YYYY-MM-DD format (UTC).
 */
export function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Queries GSI1 for certifications expiring on or before the given date for a specific tenant.
 * Only returns certifications that are NOT already in 'expired' status.
 */
export async function queryExpiredCertifications(
  tenantId: string,
  expiryDateThreshold: string
): Promise<CertificationItem[]> {
  const expiredCerts: CertificationItem[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: getTableName(CERTIFICATIONS_TABLE),
        IndexName: GSI1_INDEX_NAME,
        KeyConditionExpression: '#gsi1pk = :tenantId AND #gsi1sk <= :expiryDate',
        FilterExpression: '#status <> :expiredStatus',
        ExpressionAttributeNames: {
          '#gsi1pk': 'GSI1PK',
          '#gsi1sk': 'GSI1SK',
          '#status': 'validation_status',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':expiryDate': expiryDateThreshold,
          ':expiredStatus': CertificationStatus.EXPIRED,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      expiredCerts.push(...(result.Items as CertificationItem[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return expiredCerts;
}

/**
 * Updates a certification's status to 'expired' in DynamoDB.
 */
export async function markCertificationExpired(cert: CertificationItem): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(CERTIFICATIONS_TABLE),
      Key: {
        PK: cert.PK,
        SK: cert.SK,
      },
      UpdateExpression: 'SET #status = :expired, #updated_at = :now',
      ConditionExpression: '#status <> :expired',
      ExpressionAttributeNames: {
        '#status': 'validation_status',
        '#updated_at': 'updated_at',
      },
      ExpressionAttributeValues: {
        ':expired': CertificationStatus.EXPIRED,
        ':now': now,
      },
    })
  );
}

/**
 * Publishes a CertificationExpired event for a given certification.
 * This triggers eligibility recalculation for the affected worker.
 */
export async function publishCertificationExpiredEvent(cert: CertificationItem): Promise<void> {
  await publishEvent({
    event_type: EventTypes.CERTIFICATION_EXPIRED,
    source_service: SOURCE_SERVICE,
    tenant_id: cert.tenant_id,
    payload: {
      certification_id: cert.certification_id,
      worker_id: cert.worker_id,
      tenant_id: cert.tenant_id,
      certification_type: cert.certification_type,
      expiry_date: cert.expiry_date,
    },
  });
}

/**
 * Processes a single expired certification: updates status and publishes event.
 * Returns true if processed successfully, false if skipped (e.g., already expired by another process).
 */
export async function processExpiredCertification(cert: CertificationItem): Promise<boolean> {
  try {
    await markCertificationExpired(cert);
    await publishCertificationExpiredEvent(cert);
    return true;
  } catch (error: unknown) {
    // ConditionalCheckFailedException means another process already expired it — safe to skip
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * Retrieves all unique tenant IDs from the Tenants table.
 * Uses a Scan since we need all tenants (PK is the partition key).
 */
export async function getAllTenantIds(): Promise<string[]> {
  const tenantIds: string[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: getTableName('Tenants'),
        FilterExpression: '#sk = :metadata',
        ExpressionAttributeNames: {
          '#sk': 'SK',
        },
        ExpressionAttributeValues: {
          ':metadata': 'METADATA',
        },
        ProjectionExpression: 'PK',
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      for (const item of result.Items) {
        const pk = item['PK'] as string;
        // Extract tenant ID from PK format: TENANT#{tenantId}
        const tenantId = pk.replace('TENANT#', '');
        if (tenantId) {
          tenantIds.push(tenantId);
        }
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return tenantIds;
}

/**
 * Main handler for the scheduled certification expiry checker Lambda.
 * Triggered daily at 00:00 UTC by EventBridge.
 */
export async function handler(): Promise<{
  statusCode: number;
  body: string;
}> {
  const today = getTodayDateString();
  logger.info('Running expiry check', { date: today });

  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    const tenantIds = await getAllTenantIds();
    logger.info('Tenants found', { tenant_count: tenantIds.length });

    for (const tenantId of tenantIds) {
      try {
        const expiredCerts = await queryExpiredCertifications(tenantId, today);
        logger.info('Expired certifications found for tenant', {
          tenant_id: tenantId,
          count: expiredCerts.length,
        });

        for (const cert of expiredCerts) {
          try {
            const processed = await processExpiredCertification(cert);
            if (processed) {
              totalProcessed++;
            } else {
              totalSkipped++;
            }
          } catch (error) {
            totalErrors++;
            logger.error('Error processing certification', {
              certification_id: cert.certification_id,
              worker_id: cert.worker_id,
              tenant_id: cert.tenant_id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        totalErrors++;
        logger.error('Error scanning tenant', {
          tenant_id: tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const summary = {
      date: today,
      total_processed: totalProcessed,
      total_skipped: totalSkipped,
      total_errors: totalErrors,
      tenants_scanned: tenantIds.length,
    };

    logger.info('Expiry check completed', summary);

    return {
      statusCode: 200,
      body: JSON.stringify(summary),
    };
  } catch (error) {
    logger.error('Fatal error in expiry check', {
      date: today,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Certification expiry check failed',
        date: today,
      }),
    };
  }
}
