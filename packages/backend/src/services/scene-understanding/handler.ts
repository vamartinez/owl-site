/**
 * Scene Understanding Layer Lambda Handler.
 * SQS consumer triggered by DetectionCompleted event.
 * Processes detection results, runs scene classification, publishes SceneClassified.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 11.6
 */

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { createLogger } from '../../shared/logger.js';
import { EventTypes } from '../../shared/types/events.js';
import { classifyScene } from './classifier.js';
import type { SceneUnderstandingSqsMessage } from './types.js';

const logger = createLogger('scene-understanding-handler');

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
 * Lambda handler for SQS-triggered scene understanding processing.
 * Processes each message from the AI pipeline queue (DetectionCompleted events).
 */
export async function handler(event: SqsEvent): Promise<void> {
  logger.info('Scene understanding handler invoked', {
    recordCount: event.Records.length,
  });

  for (const record of event.Records) {
    await processRecord(record);
  }
}

/**
 * Processes a single SQS record containing a DetectionCompleted event.
 * Requirement 11.6: If pipeline fails, halt subsequent stages and record failure.
 */
async function processRecord(record: SqsRecord): Promise<void> {
  const log = logger.child({ messageId: record.messageId });

  try {
    // Parse the platform event from the SQS message body
    const platformEvent = JSON.parse(record.body);
    const payload = platformEvent.payload as SceneUnderstandingSqsMessage;

    if (!payload?.inspection_id || !payload?.tenant_id || !payload?.detection_id) {
      log.error('Invalid message payload', { body: record.body });
      return; // Skip invalid messages — they'll go to DLQ after retries
    }

    const {
      inspection_id: inspectionId,
      media_asset_id: mediaAssetId,
      tenant_id: tenantId,
      site_id: siteId,
      detection_id: detectionId,
    } = payload;

    log.info('Processing scene classification', {
      inspectionId,
      detectionId,
      mediaAssetId,
      tenantId,
      siteId,
    });

    // Run the scene classification pipeline
    const interpretationRecord = await classifyScene({
      inspectionId,
      detectionId,
      mediaAssetId,
      tenantId,
      siteId,
    });

    // Publish SceneClassified event for downstream processing
    await publishEvent({
      event_type: EventTypes.SCENE_CLASSIFIED,
      source_service: 'scene-understanding-layer',
      tenant_id: tenantId,
      correlation_id: platformEvent.correlation_id,
      payload: {
        inspection_id: inspectionId,
        media_asset_id: mediaAssetId,
        tenant_id: tenantId,
        site_id: siteId,
        detection_id: detectionId,
        interpretation_id: interpretationRecord.interpretation_id,
        scene_type: interpretationRecord.scene_type,
        confidence: interpretationRecord.confidence,
        model_version: interpretationRecord.model_version,
      },
    });

    log.info('SceneClassified event published', {
      inspectionId,
      sceneType: interpretationRecord.scene_type,
      confidence: interpretationRecord.confidence,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    log.error('Scene understanding processing failed', { error: errorMessage });

    // Requirement 11.6: Record failure stage on the inspection
    try {
      const platformEvent = JSON.parse(record.body);
      const payload = platformEvent.payload as SceneUnderstandingSqsMessage;

      if (payload?.inspection_id && payload?.tenant_id) {
        await recordPipelineFailure(
          payload.tenant_id,
          payload.inspection_id,
          'scene_understanding',
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
