/**
 * Notification Service Lambda Handler.
 *
 * Receives events from EventBridge/SNS and determines notification recipients
 * based on incident severity and user roles, then sends notifications via SNS.
 *
 * Supported events:
 * - incident.created (Critical severity → notify site supervisor + CSO)
 * - incident.updated (regulatory flag changes → notify CSO + tenant_admin)
 * - regulatory.immediate_notification (→ notify CSO + tenant_admin)
 *
 * After sending notifications, records a NOTIFICATION_SENT timeline event
 * for audit trail purposes.
 *
 * Environment variables:
 * - NOTIFICATION_TOPIC_ARN: SNS topic ARN for sending notifications
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../shared/logger.js';
import { appendEvent } from './timeline-repository.js';
import { TimelineEventType, OperationalSeverity, RegulatoryFlag } from './types.js';
import type { TimelineEvent } from './types.js';

const logger = createLogger('notification-service');
const snsClient = new SNSClient({});

/**
 * Notification recipient determined by severity/role logic.
 */
export interface NotificationRecipient {
  role: string;
  reason: string;
}

/**
 * Structure of the incoming event from EventBridge/SNS.
 */
export interface NotificationEvent {
  event_type: string;
  source_service: string;
  tenant_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
}

/**
 * Result of processing a notification event.
 */
export interface NotificationResult {
  event_type: string;
  incident_id: string;
  recipients: NotificationRecipient[];
  notifications_sent: number;
  timeline_recorded: boolean;
}

/**
 * Lambda handler that receives EventBridge events and dispatches notifications.
 *
 * Supports both direct EventBridge invocation and SNS-wrapped messages.
 */
export async function handler(event: unknown): Promise<NotificationResult> {
  logger.info('Notification handler invoked', { event: JSON.stringify(event) });

  const notificationEvent = parseIncomingEvent(event);
  if (!notificationEvent) {
    logger.warn('Could not parse incoming event, skipping');
    return {
      event_type: 'unknown',
      incident_id: 'unknown',
      recipients: [],
      notifications_sent: 0,
      timeline_recorded: false,
    };
  }

  const { event_type, payload, tenant_id } = notificationEvent;
  const incidentId = payload['incident_id'] as string;

  logger.info('Processing notification event', {
    event_type,
    incident_id: incidentId,
    tenant_id,
  });

  // Determine recipients based on event type and payload
  const recipients = determineRecipients(event_type, payload);

  if (recipients.length === 0) {
    logger.info('No recipients determined for event, skipping notification', {
      event_type,
      incident_id: incidentId,
    });
    return {
      event_type,
      incident_id: incidentId,
      recipients: [],
      notifications_sent: 0,
      timeline_recorded: false,
    };
  }

  // Send notifications via SNS
  const notificationsSent = await sendNotifications(
    event_type,
    incidentId,
    tenant_id,
    payload,
    recipients
  );

  // Record NOTIFICATION_SENT timeline event (Req 18.4)
  const timelineRecorded = await recordNotificationTimeline(
    incidentId,
    tenant_id,
    event_type,
    recipients
  );

  logger.info('Notification processing complete', {
    event_type,
    incident_id: incidentId,
    recipients_count: recipients.length,
    notifications_sent: notificationsSent,
    timeline_recorded: timelineRecorded,
  });

  return {
    event_type,
    incident_id: incidentId,
    recipients,
    notifications_sent: notificationsSent,
    timeline_recorded: timelineRecorded,
  };
}

/**
 * Parses the incoming event from various sources (direct EventBridge, SNS wrapper, etc.).
 */
export function parseIncomingEvent(event: unknown): NotificationEvent | null {
  if (!event || typeof event !== 'object') return null;

  const record = event as Record<string, unknown>;

  // Direct invocation with event structure (EventBridge detail or direct payload)
  if (record['event_type'] && record['payload']) {
    return {
      event_type: record['event_type'] as string,
      source_service: (record['source_service'] as string) ?? 'unknown',
      tenant_id: (record['tenant_id'] as string) ?? 'unknown',
      timestamp: (record['timestamp'] as string) ?? new Date().toISOString(),
      payload: record['payload'] as Record<string, unknown>,
      correlation_id: record['correlation_id'] as string | undefined,
    };
  }

  // SNS event wrapper (Records[0].Sns.Message)
  const records = record['Records'] as Array<Record<string, unknown>> | undefined;
  if (records && records.length > 0) {
    const snsRecord = records[0]?.['Sns'] as Record<string, unknown> | undefined;
    if (snsRecord?.['Message']) {
      try {
        const message = JSON.parse(snsRecord['Message'] as string) as Record<string, unknown>;
        if (message['event_type'] && message['payload']) {
          return {
            event_type: message['event_type'] as string,
            source_service: (message['source_service'] as string) ?? 'unknown',
            tenant_id: (message['tenant_id'] as string) ?? 'unknown',
            timestamp: (message['timestamp'] as string) ?? new Date().toISOString(),
            payload: message['payload'] as Record<string, unknown>,
            correlation_id: message['correlation_id'] as string | undefined,
          };
        }
      } catch {
        logger.warn('Failed to parse SNS message body');
      }
    }
  }

  // EventBridge event wrapper (detail field)
  if (record['detail'] && record['detail-type']) {
    const detail = record['detail'] as Record<string, unknown>;
    return {
      event_type: record['detail-type'] as string,
      source_service: (record['source'] as string) ?? 'unknown',
      tenant_id: (detail['tenant_id'] as string) ?? 'unknown',
      timestamp: (record['time'] as string) ?? new Date().toISOString(),
      payload: detail as Record<string, unknown>,
      correlation_id: detail['correlation_id'] as string | undefined,
    };
  }

  return null;
}

/**
 * Determines notification recipients based on event type and payload.
 *
 * Req 18.1: Critical severity → site supervisor + CSO
 * Req 18.2: Immediately/potentially reportable → CSO + tenant_admin
 */
export function determineRecipients(
  eventType: string,
  payload: Record<string, unknown>
): NotificationRecipient[] {
  const recipients: NotificationRecipient[] = [];
  const severity = payload['severity'] as string | undefined;
  const regulatoryFlag = payload['regulatory_flag'] as string | undefined;

  switch (eventType) {
    case 'incident.created': {
      // Req 18.1: Critical severity → notify site supervisor + CSO
      if (severity === OperationalSeverity.CRITICAL) {
        recipients.push({
          role: 'supervisor',
          reason: 'Critical severity incident created at assigned site',
        });
        recipients.push({
          role: 'cso',
          reason: 'Critical severity incident created — compliance review required',
        });
      }
      break;
    }

    case 'incident.updated': {
      // Req 18.2: Regulatory flag change to immediately/potentially reportable
      if (
        regulatoryFlag === RegulatoryFlag.IMMEDIATELY_REPORTABLE ||
        regulatoryFlag === RegulatoryFlag.POTENTIALLY_REPORTABLE
      ) {
        recipients.push({
          role: 'cso',
          reason: `Incident regulatory flag changed to ${regulatoryFlag}`,
        });
        recipients.push({
          role: 'tenant_admin',
          reason: `Incident regulatory flag changed to ${regulatoryFlag}`,
        });
      }
      break;
    }

    case 'regulatory.immediate_notification': {
      // Req 18.2: Immediate regulatory notification → CSO + tenant_admin
      const authority = payload['authority'] as string | undefined;
      const deadlineHours = payload['deadline_hours'] as number | undefined;

      recipients.push({
        role: 'cso',
        reason: `Immediate regulatory notification: ${authority ?? 'unknown'} ${deadlineHours ?? 0}h deadline`,
      });
      recipients.push({
        role: 'tenant_admin',
        reason: `Immediate regulatory notification: ${authority ?? 'unknown'} ${deadlineHours ?? 0}h deadline`,
      });
      break;
    }

    default:
      logger.warn('Unrecognized event type for notification routing', { eventType });
      break;
  }

  return recipients;
}

/**
 * Sends notifications to determined recipients via SNS.
 *
 * @returns Number of notifications successfully sent
 */
async function sendNotifications(
  eventType: string,
  incidentId: string,
  tenantId: string,
  payload: Record<string, unknown>,
  recipients: NotificationRecipient[]
): Promise<number> {
  const topicArn = process.env['NOTIFICATION_TOPIC_ARN'];
  if (!topicArn) {
    logger.error('NOTIFICATION_TOPIC_ARN environment variable is not configured');
    return 0;
  }

  const title = (payload['title'] as string) ?? 'Incident notification';
  const siteId = (payload['site_id'] as string) ?? 'unknown';

  let sentCount = 0;

  for (const recipient of recipients) {
    const message = buildNotificationMessage(eventType, title, incidentId, siteId, recipient);

    try {
      await snsClient.send(
        new PublishCommand({
          TopicArn: topicArn,
          Subject: message.subject,
          Message: JSON.stringify(message.body),
          MessageAttributes: {
            event_type: {
              DataType: 'String',
              StringValue: eventType,
            },
            tenant_id: {
              DataType: 'String',
              StringValue: tenantId,
            },
            recipient_role: {
              DataType: 'String',
              StringValue: recipient.role,
            },
            incident_id: {
              DataType: 'String',
              StringValue: incidentId,
            },
          },
        })
      );

      sentCount++;
      logger.info('Notification sent', {
        incident_id: incidentId,
        recipient_role: recipient.role,
        event_type: eventType,
      });
    } catch (error) {
      logger.error('Failed to send notification', {
        incident_id: incidentId,
        recipient_role: recipient.role,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return sentCount;
}

/**
 * Builds the notification message content for a recipient.
 */
function buildNotificationMessage(
  eventType: string,
  title: string,
  incidentId: string,
  siteId: string,
  recipient: NotificationRecipient
): { subject: string; body: Record<string, unknown> } {
  let subject: string;

  switch (eventType) {
    case 'incident.created':
      subject = `[ClearSite] Critical Incident Created: ${title}`;
      break;
    case 'incident.updated':
      subject = `[ClearSite] Incident Updated - Regulatory Attention Required: ${title}`;
      break;
    case 'regulatory.immediate_notification':
      subject = `[ClearSite] URGENT: Immediate Regulatory Notification Required: ${title}`;
      break;
    default:
      subject = `[ClearSite] Incident Notification: ${title}`;
  }

  return {
    subject,
    body: {
      notification_type: eventType,
      incident_id: incidentId,
      site_id: siteId,
      title,
      recipient_role: recipient.role,
      reason: recipient.reason,
      timestamp: new Date().toISOString(),
      action_required: eventType === 'regulatory.immediate_notification'
        ? 'Review incident immediately and determine regulatory reporting obligations'
        : 'Review incident details and take appropriate action',
    },
  };
}

/**
 * Records a NOTIFICATION_SENT timeline event for audit trail.
 *
 * Req 18.4: Record notification in audit trail with recipient, type, channel, timestamp.
 *
 * @returns true if timeline event was recorded successfully
 */
async function recordNotificationTimeline(
  incidentId: string,
  tenantId: string,
  eventType: string,
  recipients: NotificationRecipient[]
): Promise<boolean> {
  const now = new Date().toISOString();

  const timelineEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: tenantId,
    event_type: TimelineEventType.NOTIFICATION_SENT,
    actor_id: 'system',
    actor_name: 'Notification Service',
    data: {
      notification_type: eventType,
      recipients: recipients.map((r) => ({
        role: r.role,
        reason: r.reason,
      })),
      channel: 'sns',
      recipients_count: recipients.length,
    },
    timestamp: now,
  };

  try {
    await appendEvent(timelineEvent);
    logger.info('Notification timeline event recorded', {
      incident_id: incidentId,
      event_id: timelineEvent.event_id,
    });
    return true;
  } catch (error) {
    logger.error('Failed to record notification timeline event', {
      incident_id: incidentId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}
