/**
 * Detection Layer Lambda Handler.
 * SQS consumer triggered by AI pipeline queue.
 * Processes InspectionUploaded events, runs detection, publishes DetectionCompleted.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.8, 11.6
 */

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { createLogger } from '../../shared/logger.js';
import { EventTypes } from '../../shared/types/events.js';
import { runDetection } from './detector.js';
import { DetectionStatus } from './types.js';
import type { DetectionSqsMessage } from './types.js';

const logger = createLogger('detection-handler');

/**
 * SQS event record shape from AWS Lambda.
 */
interface SqsRecord {
  messageId: string;
  body: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, { stringValue?: string }>;
}

interface SqsEvent {
  Records: SqsRecord[];
}

/**
 * Lambda handler for SQS-triggered detection processing.
 * Processes each message from the AI pipeline queue.
 */
export async function handler(event: SqsEvent): Promise<void> {
  logger.info('Detection handler invoked', {
    recordCount: event.Records.length,
  });

  for (const record of event.Records) {
    await processRecord(record);
  }
}

/**
 * Processes a single SQS record containing an InspectionUploaded event.
 * Requirement 11.6: If pipeline fails, halt subsequent stages and record failure.
 */
async function processRecord(record: SqsRecord): Promise<void> {
  const log = logger.child({ messageId: record.messageId });

  try {
    // Parse the platform event from the SQS message body
    const platformEvent = JSON.parse(record.body);
    const payload = platformEvent.payload as DetectionSqsMessage;

    if (!payload?.inspection_id || !payload?.tenant_id) {
      log.error('Invalid message payload', { body: record.body });
      return; // Skip invalid messages — they'll go to DLQ after retries
    }

    const {
      inspection_id: inspectionId,
      media_asset_id: mediaAssetId,
      tenant_id: tenantId,
      site_id: siteId,
      s3_key: s3Key,
    } = payload;

    log.info('Processing detection', {
      inspectionId,
      mediaAssetId,
      tenantId,
      siteId,
    });

    // Run the detection pipeline
    const detectionRecord = await runDetection({
      inspectionId,
      mediaAssetId,
      tenantId,
      siteId,
      s3Key,
    });

    // Publish DetectionCompleted event for downstream processing
    await publishEvent({
      event_type: EventTypes.DETECTION_COMPLETED,
      source_service: 'detection-layer',
      tenant_id: tenantId,
      correlation_id: platformEvent.correlation_id,
      payload: {
        inspection_id: inspectionId,
        media_asset_id: mediaAssetId,
        tenant_id: tenantId,
        site_id: siteId,
        detection_id: detectionRecord.detection_id,
        detection_count: detectionRecord.detection_count,
        model_version: detectionRecord.model_version,
      },
    });

    log.info('DetectionCompleted event published', {
      inspectionId,
      detectionCount: detectionRecord.detection_count,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    log.error('Detection processing failed', { error: errorMessage });

    // Requirement 11.6: Record failure stage on the inspection
    try {
      const platformEvent = JSON.parse(record.body);
      const payload = platformEvent.payload as DetectionSqsMessage;

      if (payload?.inspection_id && payload?.tenant_id) {
        await recordPipelineFailure(
          payload.tenant_id,
          payload.inspection_id,
          'detection',
          errorMessage
        );
      }
    } catch (recordError) {
      log.error('Failed to record pipeline failure', {
        error:
          recordError instanceof Error
            ? recordError.message
            : 'Unknown error',
      });
    }

    // Re-throw to let SQS retry (will eventually go to DLQ)
    throw error;
  }
}

/**
 * Records a pipeline failure on the inspection record.
 * Requirement 11.6: Halt subsequent stages, record failure stage.
 */
async function recordPipelineFailure(
  tenantId: string,
  inspectionId: string,
  failedStage: string,
  errorMessage: string
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('Inspections'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `INSPECTION#${inspectionId}`,
      },
      UpdateExpression:
        'SET #status = :status, failed_stage = :stage, error_message = :error, updated_at = :now',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':stage': failedStage,
        ':error': errorMessage,
        ':now': new Date().toISOString(),
      },
    })
  );
}
