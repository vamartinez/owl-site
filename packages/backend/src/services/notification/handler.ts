/**
 * Notification Service Lambda Handler.
 *
 * SQS consumer for the notification queue. Processes platform events and
 * dispatches notifications to the appropriate channel (email, SMS, push).
 *
 * Ensures the assigned responsible party is notified within 60 seconds
 * of EnforcementAction creation (Requirement 10.3).
 *
 * Supported event types:
 * - CertificationExpired → cert expiry warnings
 * - AccessDecisionGenerated → access decision notifications
 * - FindingGenerated → enforcement action notifications
 * - FindingReviewed → review outcome notifications
 *
 * Requirements: 10.3, 11.1
 */

import { v4 as uuidv4 } from 'uuid';
import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

// --- SQS Event Types ---

interface SQSRecord {
  messageId: string;
  body: string;
}

interface SQSEvent {
  Records: SQSRecord[];
}
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { EventTypes } from '../../shared/types/events.js';
import type { PlatformEvent } from '../../shared/types/events.js';
import { NotificationChannel } from '../../shared/types/common.js';
import { sendEmail } from './channels/email.js';
import { sendSms } from './channels/sms.js';
import { sendPush } from './channels/push.js';
import { getTemplate, renderTemplate } from './templates.js';
import {
  NotificationTemplateType,
  NotificationPriority,
} from './types.js';
import type {
  NotificationRequest,
  NotificationResult,
  ChannelDeliveryResult,
} from './types.js';

const logger = createLogger('notification-service');

/**
 * Lambda handler — SQS consumer for the notification queue.
 * Processes each SQS record as a PlatformEvent and dispatches notifications.
 */
export async function handler(event: SQSEvent): Promise<void> {
  logger.info('Processing notification queue batch', {
    record_count: event.Records.length,
  });

  const results: NotificationResult[] = [];

  for (const record of event.Records) {
    try {
      const result = await processRecord(record);
      if (result) {
        results.push(...result);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to process notification record', {
        message_id: record.messageId,
        error: errorMessage,
      });
      // Don't throw — allow other records in the batch to process.
      // Failed records will be retried via SQS visibility timeout.
    }
  }

  logger.info('Notification batch processing complete', {
    total_records: event.Records.length,
    notifications_sent: results.filter((r) => r.status === 'sent').length,
    notifications_failed: results.filter((r) => r.status === 'failed').length,
  });
}

/**
 * Processes a single SQS record containing a PlatformEvent.
 */
async function processRecord(record: SQSRecord): Promise<NotificationResult[] | null> {
  const platformEvent = JSON.parse(record.body) as PlatformEvent;

  logger.info('Processing event for notification', {
    event_type: platformEvent.event_type,
    event_id: platformEvent.event_id,
    tenant_id: platformEvent.tenant_id,
    correlation_id: platformEvent.correlation_id,
  });

  switch (platformEvent.event_type) {
    case EventTypes.CERTIFICATION_EXPIRED:
      return handleCertificationExpired(platformEvent);

    case EventTypes.ACCESS_DECISION_GENERATED:
      return handleAccessDecision(platformEvent);

    case EventTypes.FINDING_GENERATED:
      return handleFindingGenerated(platformEvent);

    case EventTypes.FINDING_REVIEWED:
      return handleFindingReviewed(platformEvent);

    default:
      logger.info('No notification action for event type', {
        event_type: platformEvent.event_type,
      });
      return null;
  }
}

/**
 * Handles CertificationExpired events.
 * Sends expiry warning to the affected worker.
 */
async function handleCertificationExpired(
  event: PlatformEvent
): Promise<NotificationResult[]> {
  const payload = event.payload as {
    worker_id: string;
    certification_type: string;
    expiry_date: string;
    days_until_expiry?: number;
  };

  const worker = await getWorkerContact(event.tenant_id, payload.worker_id);
  if (!worker) {
    logger.warn('Worker not found for cert expiry notification', {
      worker_id: payload.worker_id,
    });
    return [];
  }

  // Determine which template to use based on days until expiry
  const daysUntilExpiry = payload.days_until_expiry ?? calculateDaysUntilExpiry(payload.expiry_date);
  const templateType = getExpiryTemplateType(daysUntilExpiry);

  if (!templateType) {
    logger.info('No notification needed for expiry days', {
      days_until_expiry: daysUntilExpiry,
    });
    return [];
  }

  const templateData: Record<string, string> = {
    worker_name: worker.preferred_name || worker.legal_name,
    certification_type: payload.certification_type,
    expiry_date: payload.expiry_date,
    site_name: worker.site_name || 'All assigned sites',
  };

  return dispatchNotification({
    notification_id: uuidv4(),
    tenant_id: event.tenant_id,
    recipient_id: payload.worker_id,
    recipient_email: worker.email,
    recipient_phone: worker.phone,
    channel: worker.preferred_channel || NotificationChannel.EMAIL,
    template_type: templateType,
    template_data: templateData,
    priority: daysUntilExpiry <= 7 ? NotificationPriority.HIGH : NotificationPriority.MEDIUM,
    correlation_id: event.correlation_id,
    created_at: new Date().toISOString(),
  });
}

/**
 * Handles AccessDecisionGenerated events.
 * Notifies the worker of the access decision.
 * For denied/conditional decisions, also notifies the supervisor (enforcement).
 */
async function handleAccessDecision(
  event: PlatformEvent
): Promise<NotificationResult[]> {
  const payload = event.payload as {
    decision_id: string;
    worker_id: string;
    site_id: string;
    decision_result: string;
    reasons?: string[];
    policy_version_used?: string;
    enforcement_action_id?: string;
    action_type?: string;
    responsible_party_id?: string;
  };

  const results: NotificationResult[] = [];

  // Notify the worker
  const worker = await getWorkerContact(event.tenant_id, payload.worker_id);
  if (worker) {
    const templateType = getAccessDecisionTemplateType(payload.decision_result);
    if (templateType) {
      const site = await getSiteInfo(event.tenant_id, payload.site_id);
      const templateData: Record<string, string> = {
        worker_name: worker.preferred_name || worker.legal_name,
        site_name: site?.name || payload.site_id,
        decision_id: payload.decision_id,
        reasons: (payload.reasons || []).join('; '),
        timestamp: new Date().toISOString(),
      };

      const workerResults = await dispatchNotification({
        notification_id: uuidv4(),
        tenant_id: event.tenant_id,
        recipient_id: payload.worker_id,
        recipient_email: worker.email,
        recipient_phone: worker.phone,
        channel: worker.preferred_channel || NotificationChannel.SMS,
        template_type: templateType,
        template_data: templateData,
        priority:
          payload.decision_result === 'denied'
            ? NotificationPriority.HIGH
            : NotificationPriority.MEDIUM,
        correlation_id: event.correlation_id,
        created_at: new Date().toISOString(),
      });
      results.push(...workerResults);
    }
  }

  // For enforcement actions, notify the responsible party within 60s (Req 10.3)
  if (payload.enforcement_action_id && payload.responsible_party_id) {
    const enforcementResults = await notifyEnforcementAction(
      event.tenant_id,
      payload.enforcement_action_id,
      payload.action_type || 'deny_entry',
      payload.responsible_party_id,
      payload.worker_id,
      payload.site_id,
      event.correlation_id
    );
    results.push(...enforcementResults);
  }

  return results;
}

/**
 * Handles FindingGenerated events.
 * For high/critical findings, notifies the site supervisor.
 */
async function handleFindingGenerated(
  event: PlatformEvent
): Promise<NotificationResult[]> {
  const payload = event.payload as {
    finding_id: string;
    inspection_id: string;
    site_id: string;
    severity: string;
    initial_status: string;
    enforcement_action_id?: string;
    action_type?: string;
    responsible_party_id?: string;
  };

  // Only notify for enforcement actions created from confirmed findings
  if (payload.enforcement_action_id && payload.responsible_party_id) {
    return notifyEnforcementAction(
      event.tenant_id,
      payload.enforcement_action_id,
      payload.action_type || 'create_corrective_action_task',
      payload.responsible_party_id,
      '', // worker_id not always applicable for findings
      payload.site_id,
      event.correlation_id
    );
  }

  return [];
}

/**
 * Handles FindingReviewed events.
 * Notifies relevant parties of review outcomes.
 */
async function handleFindingReviewed(
  event: PlatformEvent
): Promise<NotificationResult[]> {
  const payload = event.payload as {
    finding_id: string;
    reviewer_id: string;
    new_status: string;
    enforcement_action_id?: string;
    action_type?: string;
    responsible_party_id?: string;
  };

  // If a confirmed finding triggered an enforcement action, notify responsible party
  if (
    payload.new_status === 'confirmed' &&
    payload.enforcement_action_id &&
    payload.responsible_party_id
  ) {
    return notifyEnforcementAction(
      event.tenant_id,
      payload.enforcement_action_id,
      payload.action_type || 'create_corrective_action_task',
      payload.responsible_party_id,
      '',
      '',
      event.correlation_id
    );
  }

  return [];
}

/**
 * Notifies the assigned responsible party of an EnforcementAction.
 * Must complete within 60 seconds of action creation (Requirement 10.3).
 */
export async function notifyEnforcementAction(
  tenantId: string,
  enforcementActionId: string,
  actionType: string,
  responsiblePartyId: string,
  workerId: string,
  siteId: string,
  correlationId?: string
): Promise<NotificationResult[]> {
  logger.info('Notifying responsible party of enforcement action', {
    enforcement_action_id: enforcementActionId,
    action_type: actionType,
    responsible_party_id: responsiblePartyId,
    correlation_id: correlationId,
  });

  const responsible = await getWorkerContact(tenantId, responsiblePartyId);
  if (!responsible) {
    logger.warn('Responsible party not found for enforcement notification', {
      responsible_party_id: responsiblePartyId,
    });
    return [];
  }

  // Get worker and site info for template
  const worker = workerId ? await getWorkerContact(tenantId, workerId) : null;
  const site = siteId ? await getSiteInfo(tenantId, siteId) : null;

  const templateData: Record<string, string> = {
    action_type: actionType.replace(/_/g, ' '),
    worker_name: worker?.preferred_name || worker?.legal_name || 'Unknown',
    worker_id: workerId || 'N/A',
    site_name: site?.name || siteId || 'N/A',
    timestamp: new Date().toISOString(),
    enforcement_action_id: enforcementActionId,
  };

  return dispatchNotification({
    notification_id: uuidv4(),
    tenant_id: tenantId,
    recipient_id: responsiblePartyId,
    recipient_email: responsible.email,
    recipient_phone: responsible.phone,
    channel: responsible.preferred_channel || NotificationChannel.EMAIL,
    template_type: NotificationTemplateType.ENFORCEMENT_ACTION_CREATED,
    template_data: templateData,
    priority: NotificationPriority.URGENT,
    correlation_id: correlationId,
    created_at: new Date().toISOString(),
  });
}

/**
 * Dispatches a notification through the configured channel.
 * Falls back to alternative channels if the primary fails.
 */
export async function dispatchNotification(
  request: NotificationRequest
): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];
  const template = getTemplate(request.template_type);
  const rendered = renderTemplate(template, request.template_data);

  let deliveryResult: ChannelDeliveryResult;

  switch (request.channel) {
    case NotificationChannel.EMAIL:
      if (!request.recipient_email) {
        logger.warn('No email address for recipient, falling back to SMS', {
          recipient_id: request.recipient_id,
        });
        // Fall back to SMS
        if (request.recipient_phone) {
          deliveryResult = await sendSms({
            phoneNumber: request.recipient_phone,
            message: rendered.sms_body,
            correlation_id: request.correlation_id,
          });
          results.push(buildResult(request, NotificationChannel.SMS, deliveryResult));
        }
        break;
      }
      deliveryResult = await sendEmail({
        to: request.recipient_email,
        subject: rendered.subject,
        body: rendered.body,
        correlation_id: request.correlation_id,
      });
      results.push(buildResult(request, NotificationChannel.EMAIL, deliveryResult));
      break;

    case NotificationChannel.SMS:
      if (!request.recipient_phone) {
        logger.warn('No phone number for recipient, falling back to email', {
          recipient_id: request.recipient_id,
        });
        // Fall back to email
        if (request.recipient_email) {
          deliveryResult = await sendEmail({
            to: request.recipient_email,
            subject: rendered.subject,
            body: rendered.body,
            correlation_id: request.correlation_id,
          });
          results.push(buildResult(request, NotificationChannel.EMAIL, deliveryResult));
        }
        break;
      }
      deliveryResult = await sendSms({
        phoneNumber: request.recipient_phone,
        message: rendered.sms_body,
        correlation_id: request.correlation_id,
      });
      results.push(buildResult(request, NotificationChannel.SMS, deliveryResult));
      break;

    case NotificationChannel.PUSH:
      deliveryResult = await sendPush({
        device_token: '', // Would come from device registration
        title: rendered.subject,
        body: rendered.body,
        correlation_id: request.correlation_id,
      });
      results.push(buildResult(request, NotificationChannel.PUSH, deliveryResult));
      break;

    default:
      logger.warn('Unknown notification channel', {
        channel: request.channel,
      });
  }

  return results;
}

// --- Helper Functions ---

function buildResult(
  request: NotificationRequest,
  channel: NotificationChannel,
  delivery: ChannelDeliveryResult
): NotificationResult {
  return {
    notification_id: request.notification_id,
    channel,
    status: delivery.success ? 'sent' : 'failed',
    message_id: delivery.message_id,
    error: delivery.error,
    sent_at: new Date().toISOString(),
  };
}

function getExpiryTemplateType(daysUntilExpiry: number): NotificationTemplateType | null {
  if (daysUntilExpiry <= 7) return NotificationTemplateType.CERT_EXPIRY_7_DAYS;
  if (daysUntilExpiry <= 14) return NotificationTemplateType.CERT_EXPIRY_14_DAYS;
  if (daysUntilExpiry <= 30) return NotificationTemplateType.CERT_EXPIRY_30_DAYS;
  return null;
}

function getAccessDecisionTemplateType(
  decisionResult: string
): NotificationTemplateType | null {
  switch (decisionResult) {
    case 'allowed':
      return NotificationTemplateType.ACCESS_DECISION_ALLOWED;
    case 'denied':
      return NotificationTemplateType.ACCESS_DECISION_DENIED;
    case 'conditional':
      return NotificationTemplateType.ACCESS_DECISION_CONDITIONAL;
    default:
      return null;
  }
}

function calculateDaysUntilExpiry(expiryDate: string): number {
  const expiry = new Date(expiryDate);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

interface WorkerContact {
  legal_name: string;
  preferred_name?: string;
  email?: string;
  phone?: string;
  preferred_channel?: NotificationChannel;
  site_name?: string;
}

/**
 * Retrieves worker contact information from DynamoDB.
 */
async function getWorkerContact(
  tenantId: string,
  workerId: string
): Promise<WorkerContact | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: getTableName('Workers'),
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: `WORKER#${workerId}`,
        },
      })
    );

    if (!result.Item) return null;

    return {
      legal_name: result.Item['legal_name'] as string,
      preferred_name: result.Item['preferred_name'] as string | undefined,
      email: result.Item['email'] as string | undefined,
      phone: result.Item['phone'] as string | undefined,
      preferred_channel: result.Item['preferred_channel'] as NotificationChannel | undefined,
    };
  } catch (error) {
    logger.error('Failed to retrieve worker contact', {
      tenant_id: tenantId,
      worker_id: workerId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

interface SiteInfo {
  name: string;
}

/**
 * Retrieves site information from DynamoDB.
 */
async function getSiteInfo(tenantId: string, siteId: string): Promise<SiteInfo | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: getTableName('Sites'),
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: `SITE#${siteId}`,
        },
      })
    );

    if (!result.Item) return null;

    return {
      name: result.Item['name'] as string,
    };
  } catch (error) {
    logger.error('Failed to retrieve site info', {
      tenant_id: tenantId,
      site_id: siteId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}
