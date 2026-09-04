/**
 * Deadline Scheduler: Creates and cancels EventBridge Scheduler one-time schedules
 * for regulatory deadline notifications.
 *
 * When the Regulatory Engine identifies a time-sensitive obligation (e.g., OSHA 8h/24h,
 * WorkSafeBC 72h), this module creates a one-time EventBridge schedule that triggers
 * the notification-service Lambda at the deadline time.
 *
 * Environment variables:
 * - SCHEDULER_ROLE_ARN: IAM role ARN that EventBridge Scheduler assumes to invoke the target
 * - NOTIFICATION_FUNCTION_ARN: ARN of the notification-service Lambda function
 * - SCHEDULER_GROUP_NAME: EventBridge Scheduler group name for incident deadline schedules
 *
 * Requirements: 7.1, 18.2
 */

import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ResourceNotFoundException,
  FlexibleTimeWindowMode,
  ActionAfterCompletion,
} from '@aws-sdk/client-scheduler';
import { createLogger } from '../../shared/logger.js';
import type { RegulatoryDeadline } from './types.js';

const logger = createLogger('deadline-scheduler');

const schedulerClient = new SchedulerClient({});

/**
 * Result of creating a deadline schedule.
 */
export interface DeadlineScheduleResult {
  scheduleName: string;
  scheduleArn: string;
}

/**
 * Creates a one-time EventBridge Scheduler schedule that triggers the notification-service
 * Lambda at the regulatory deadline time.
 *
 * The schedule is configured to auto-delete after completion to avoid stale schedules.
 *
 * @param incidentId - The incident identifier this deadline belongs to
 * @param deadline - The regulatory deadline from the evaluation engine
 * @returns The schedule name and ARN for later cancellation
 */
export async function createDeadlineSchedule(
  incidentId: string,
  deadline: RegulatoryDeadline
): Promise<DeadlineScheduleResult> {
  const schedulerRoleArn = process.env.SCHEDULER_ROLE_ARN;
  const notificationFunctionArn = process.env.NOTIFICATION_FUNCTION_ARN;
  const schedulerGroupName = process.env.SCHEDULER_GROUP_NAME || 'incident-deadlines';

  if (!schedulerRoleArn) {
    throw new Error('SCHEDULER_ROLE_ARN environment variable is not configured');
  }

  if (!notificationFunctionArn) {
    throw new Error('NOTIFICATION_FUNCTION_ARN environment variable is not configured');
  }

  // Generate a unique schedule name based on incident and deadline info
  const scheduleName = `incident-${incidentId}-${deadline.authority.toLowerCase()}-${deadline.deadline_hours}h`;

  // Format the deadline as an EventBridge Scheduler at() expression
  // The absolute_deadline is already an ISO 8601 datetime string
  const scheduleExpression = `at(${deadline.absolute_deadline})`;

  const payload = JSON.stringify({
    event_type: 'regulatory.deadline_reached',
    incident_id: incidentId,
    authority: deadline.authority,
    deadline_hours: deadline.deadline_hours,
    deadline_from: deadline.deadline_from,
    absolute_deadline: deadline.absolute_deadline,
    description: deadline.description,
  });

  logger.info('Creating deadline schedule', {
    incident_id: incidentId,
    schedule_name: scheduleName,
    schedule_expression: scheduleExpression,
    authority: deadline.authority,
    deadline_hours: deadline.deadline_hours,
  });

  const result = await schedulerClient.send(
    new CreateScheduleCommand({
      Name: scheduleName,
      GroupName: schedulerGroupName,
      ScheduleExpression: scheduleExpression,
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: {
        Mode: FlexibleTimeWindowMode.OFF,
      },
      Target: {
        Arn: notificationFunctionArn,
        RoleArn: schedulerRoleArn,
        Input: payload,
      },
      ActionAfterCompletion: ActionAfterCompletion.DELETE,
      Description: `Regulatory deadline: ${deadline.authority} ${deadline.deadline_hours}h for incident ${incidentId}`,
    })
  );

  const scheduleArn = result.ScheduleArn || '';

  logger.info('Deadline schedule created', {
    incident_id: incidentId,
    schedule_name: scheduleName,
    schedule_arn: scheduleArn,
  });

  return {
    scheduleName,
    scheduleArn,
  };
}

/**
 * Cancels (deletes) an existing deadline schedule by name.
 *
 * Handles the case where the schedule has already fired and been auto-deleted
 * by gracefully catching ResourceNotFoundException.
 *
 * @param scheduleName - The name of the schedule to cancel
 */
export async function cancelSchedule(scheduleName: string): Promise<void> {
  const schedulerGroupName = process.env.SCHEDULER_GROUP_NAME || 'incident-deadlines';

  logger.info('Cancelling deadline schedule', {
    schedule_name: scheduleName,
    group_name: schedulerGroupName,
  });

  try {
    await schedulerClient.send(
      new DeleteScheduleCommand({
        Name: scheduleName,
        GroupName: schedulerGroupName,
      })
    );

    logger.info('Deadline schedule cancelled', {
      schedule_name: scheduleName,
    });
  } catch (error: unknown) {
    if (error instanceof ResourceNotFoundException) {
      // Schedule already fired and was auto-deleted, or was manually removed
      logger.info('Schedule not found (may have already fired)', {
        schedule_name: scheduleName,
      });
      return;
    }

    logger.error('Failed to cancel deadline schedule', {
      schedule_name: scheduleName,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}
