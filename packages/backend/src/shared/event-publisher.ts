/**
 * SNS/SQS publish helper with PlatformEvent schema.
 * Provides a unified interface for publishing events to the Event Bus.
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import type { PlatformEvent } from './types/events.js';

const snsClient = new SNSClient({});
const sqsClient = new SQSClient({});

export interface PublishEventParams {
  event_type: string;
  source_service: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
  version?: string;
}

/**
 * Builds a PlatformEvent from the given parameters.
 */
export function buildPlatformEvent(params: PublishEventParams): PlatformEvent {
  return {
    event_id: uuidv4(),
    event_type: params.event_type,
    source_service: params.source_service,
    tenant_id: params.tenant_id,
    timestamp: new Date().toISOString(),
    payload: params.payload,
    correlation_id: params.correlation_id ?? uuidv4(),
    version: params.version ?? '1.0',
  };
}

/**
 * Publishes an event to an SNS topic.
 */
export async function publishToSns(
  topicArn: string,
  params: PublishEventParams
): Promise<PlatformEvent> {
  const event = buildPlatformEvent(params);

  await snsClient.send(
    new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(event),
      MessageAttributes: {
        event_type: {
          DataType: 'String',
          StringValue: event.event_type,
        },
        tenant_id: {
          DataType: 'String',
          StringValue: event.tenant_id,
        },
        source_service: {
          DataType: 'String',
          StringValue: event.source_service,
        },
      },
    })
  );

  return event;
}

/**
 * Publishes an event to an SQS queue.
 */
export async function publishToSqs(
  queueUrl: string,
  params: PublishEventParams
): Promise<PlatformEvent> {
  const event = buildPlatformEvent(params);

  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(event),
      MessageAttributes: {
        event_type: {
          DataType: 'String',
          StringValue: event.event_type,
        },
        tenant_id: {
          DataType: 'String',
          StringValue: event.tenant_id,
        },
      },
    })
  );

  return event;
}

/**
 * Convenience function to publish to the default platform SNS topic.
 * Uses the SNS_TOPIC_ARN environment variable.
 */
export async function publishEvent(params: PublishEventParams): Promise<PlatformEvent> {
  const topicArn = process.env['SNS_TOPIC_ARN'];
  if (!topicArn) {
    throw new Error('SNS_TOPIC_ARN environment variable is not configured');
  }
  return publishToSns(topicArn, params);
}
