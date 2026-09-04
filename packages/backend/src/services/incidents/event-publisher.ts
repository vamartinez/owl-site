/**
 * Incident Event Publisher: Publishes incident lifecycle events via the shared event-publisher.
 *
 * Events published:
 * - incident.created: When a new incident is created
 * - incident.updated: When an incident is modified (state, severity, fields, etc.)
 * - regulatory.immediate_notification: When an incident requires immediate regulatory notification
 *
 * Uses the shared event-publisher (SNS-based) with the INCIDENT_EVENT_BUS_NAME environment
 * variable for the topic ARN. Falls back to the default SNS_TOPIC_ARN if not set.
 *
 * Source: "incident-service"
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4
 */

import { publishToSns, buildPlatformEvent } from '../../shared/event-publisher.js';
import type { PublishEventParams } from '../../shared/event-publisher.js';
import type { PlatformEvent } from '../../shared/types/events.js';
import { createLogger } from '../../shared/logger.js';
import type { IncidentRecord, RegulatoryDeadline } from './types.js';

const logger = createLogger('incident-event-publisher');

const SOURCE_SERVICE = 'incident-service';

/**
 * Gets the SNS topic ARN for incident events.
 * Prefers INCIDENT_EVENT_BUS_NAME, falls back to SNS_TOPIC_ARN.
 */
function getTopicArn(): string {
  const topicArn = process.env['INCIDENT_EVENT_BUS_NAME'] ?? process.env['SNS_TOPIC_ARN'];
  if (!topicArn) {
    throw new Error(
      'INCIDENT_EVENT_BUS_NAME or SNS_TOPIC_ARN environment variable is not configured'
    );
  }
  return topicArn;
}

/**
 * Publishes an "incident.created" event when a new incident is created.
 *
 * Triggers notification-service to determine recipients by severity/role
 * and send notifications for Critical severity incidents.
 *
 * Requirement 18.1: Send notification when Critical severity incident is created.
 *
 * @param incident - The newly created incident record
 * @returns The published platform event
 */
export async function publishIncidentCreated(
  incident: IncidentRecord
): Promise<PlatformEvent> {
  const params: PublishEventParams = {
    event_type: 'incident.created',
    source_service: SOURCE_SERVICE,
    tenant_id: incident.tenant_id,
    payload: {
      incident_id: incident.incident_id,
      site_id: incident.site_id,
      title: incident.title,
      incident_type: incident.incident_type,
      severity: incident.severity,
      regulatory_flag: incident.regulatory_flag,
      status: incident.status,
      reporting_user_id: incident.reporting_user_id,
      reporting_user_name: incident.reporting_user_name,
      jurisdiction: incident.jurisdiction,
      created_at: incident.created_at,
    },
  };

  logger.info('Publishing incident.created event', {
    incident_id: incident.incident_id,
    tenant_id: incident.tenant_id,
    severity: incident.severity,
  });

  const event = await publishToSns(getTopicArn(), params);

  logger.info('Published incident.created event', {
    incident_id: incident.incident_id,
    event_id: event.event_id,
  });

  return event;
}

/**
 * Publishes an "incident.updated" event when an incident is modified.
 *
 * The changeType parameter indicates what kind of change occurred
 * (e.g., "state_change", "severity_change", "field_update", "regulatory_flag_change").
 *
 * Requirement 18.2: Notify on regulatory flag changes.
 *
 * @param incident - The updated incident record (post-update state)
 * @param changeType - The type of change that triggered this event
 * @returns The published platform event
 */
export async function publishIncidentUpdated(
  incident: IncidentRecord,
  changeType: string
): Promise<PlatformEvent> {
  const params: PublishEventParams = {
    event_type: 'incident.updated',
    source_service: SOURCE_SERVICE,
    tenant_id: incident.tenant_id,
    payload: {
      incident_id: incident.incident_id,
      site_id: incident.site_id,
      title: incident.title,
      severity: incident.severity,
      regulatory_flag: incident.regulatory_flag,
      status: incident.status,
      change_type: changeType,
      updated_at: incident.updated_at,
    },
  };

  logger.info('Publishing incident.updated event', {
    incident_id: incident.incident_id,
    tenant_id: incident.tenant_id,
    change_type: changeType,
  });

  const event = await publishToSns(getTopicArn(), params);

  logger.info('Published incident.updated event', {
    incident_id: incident.incident_id,
    event_id: event.event_id,
    change_type: changeType,
  });

  return event;
}

/**
 * Publishes a "regulatory.immediate_notification" event when an incident
 * requires immediate regulatory notification (e.g., OSHA 8h fatality, WorkSafeBC immediate).
 *
 * This event triggers the notification-service to alert CSO and tenant_admin
 * about the regulatory obligation.
 *
 * Requirement 18.2: Notify compliance reviewer for immediately reportable incidents.
 *
 * @param incident - The incident requiring immediate notification
 * @param deadline - The regulatory deadline details from the evaluation engine
 * @returns The published platform event
 */
export async function publishRegulatoryImmediateNotification(
  incident: IncidentRecord,
  deadline: RegulatoryDeadline
): Promise<PlatformEvent> {
  const params: PublishEventParams = {
    event_type: 'regulatory.immediate_notification',
    source_service: SOURCE_SERVICE,
    tenant_id: incident.tenant_id,
    payload: {
      incident_id: incident.incident_id,
      site_id: incident.site_id,
      title: incident.title,
      severity: incident.severity,
      regulatory_flag: incident.regulatory_flag,
      jurisdiction: incident.jurisdiction,
      authority: deadline.authority,
      deadline_hours: deadline.deadline_hours,
      deadline_from: deadline.deadline_from,
      absolute_deadline: deadline.absolute_deadline,
      description: deadline.description,
      reporting_user_name: incident.reporting_user_name,
      created_at: incident.created_at,
    },
  };

  logger.info('Publishing regulatory.immediate_notification event', {
    incident_id: incident.incident_id,
    tenant_id: incident.tenant_id,
    authority: deadline.authority,
    deadline_hours: deadline.deadline_hours,
  });

  const event = await publishToSns(getTopicArn(), params);

  logger.info('Published regulatory.immediate_notification event', {
    incident_id: incident.incident_id,
    event_id: event.event_id,
    authority: deadline.authority,
  });

  return event;
}
