/**
 * Regulatory Mapping Layer Lambda Handler.
 * SQS consumer triggered by SceneClassified event.
 * Processes scene classification results, maps to regulations, generates findings.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 11.6
 */

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { createLogger } from '../../shared/logger.js';
import { EventTypes } from '../../shared/types/events.js';
import { mapToRegulations, RegulatoryMappingError } from './mapper.js';
import type { RegulatoryMappingSqsMessage } from './types.js';

const logger = createLogger('regulatory-mapping-handler');

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
 * Lambda handler for SQS-triggered regulatory mapping processing.
 * Processes each message from the AI pipeline queue (SceneClassified events).
 */
export async function handler(event: SqsEvent): Promise<void> {
  logger.info('Regulatory mapping handler invoked', {
    recordCount: event.Records.length,
  });

  for (const record of event.Records) {
    await processRecord(record);
  }
}

/**
 * Processes a single SQS record containing a SceneClassified event.
 * Requirement 11.6: If pipeline fails, halt subsequent stages and record failure.
 */
async function processRecord(record: SqsRecord): Promise<void> {
  const log = logger.child({ messageId: record.messageId });

  try {
    // Parse the platform event from the SQS message body
    const platformEvent = JSON.parse(record.body);
    const payload = platformEvent.payload as RegulatoryMappingSqsMessage;

    if (
      !payload?.inspection_id ||
      !payload?.tenant_id ||
      !payload?.interpretation_id ||
      !payload?.detection_id
    ) {
      log.error('Invalid message payload', { body: record.body });
      return; // Skip invalid messages — they'll go to DLQ after retries
    }

    const {
      inspection_id: inspectionId,
      media_asset_id: mediaAssetId,
      tenant_id: tenantId,
      site_id: siteId,
      detection_id: detectionId,
      interpretation_id: interpretationId,
      scene_type: sceneType,
      confidence: sceneConfidence,
    } = payload;

    log.info('Processing regulatory mapping', {
      inspectionId,
      interpretationId,
      detectionId,
      tenantId,
      siteId,
      sceneType,
    });

    // Run the regulatory mapping pipeline
    const mappingOutput = await mapToRegulations({
      inspectionId,
      interpretationId,
      detectionId,
      mediaAssetId,
      tenantId,
      siteId,
      sceneType,
      sceneConfidence,
    });

    // Publish FindingGenerated events for each violation finding
    const violationMappings = mappingOutput.mappings.filter((m) => m.violation_flag);

    for (const mapping of violationMappings) {
      await publishEvent({
        event_type: EventTypes.FINDING_GENERATED,
        source_service: 'regulatory-mapping-layer',
        tenant_id: tenantId,
        correlation_id: platformEvent.correlation_id,
        payload: {
          inspection_id: inspectionId,
          media_asset_id: mediaAssetId,
          tenant_id: tenantId,
          site_id: siteId,
          mapping_id: mappingOutput.mapping_id,
          severity: mapping.severity,
          violation_flag: mapping.violation_flag,
          regulatory_basis: mapping.regulatory_basis,
          detection_type: mapping.detection_type,
          policy_version_id: mappingOutput.policy_version_id,
          jurisdiction_id: mappingOutput.jurisdiction_id,
        },
      });
    }

    log.info('Regulatory mapping completed, FindingGenerated events published', {
      inspectionId,
      mappingId: mappingOutput.mapping_id,
      violationCount: violationMappings.length,
      totalMappings: mappingOutput.mappings.length,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    log.error('Regulatory mapping processing failed', { error: errorMessage });

    // Requirement 11.6: Record failure stage on the inspection
    try {
      const platformEvent = JSON.parse(record.body);
      const payload = platformEvent.payload as RegulatoryMappingSqsMessage;

      if (payload?.inspection_id && payload?.tenant_id) {
        await recordPipelineFailure(
          payload.tenant_id,
          payload.inspection_id,
          'regulatory_mapping',
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

    // Requirement 8.7: If policy/jurisdiction unavailable, don't retry (it won't help)
    if (error instanceof RegulatoryMappingError) {
      log.warn('Regulatory mapping rejected due to unavailable resource', {
        code: error.code,
        message: error.message,
      });
      // Don't re-throw — message will be consumed (not retried)
      return;
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
