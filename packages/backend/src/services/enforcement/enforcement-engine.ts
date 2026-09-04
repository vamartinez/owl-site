/**
 * Enforcement Engine — Core enforcement logic.
 *
 * Responsibilities:
 * 1. Create EnforcementActions linked to DecisionRecords within 5 seconds
 * 2. Determine appropriate action type based on decision result
 * 3. Handle auto-escalation for unresolved actions (> 30 min)
 * 4. Manage revalidation attempts (max 3 per decision per 24h)
 * 5. Manage override requests with immutable original decisions
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { EventTypes } from '../../shared/types/events.js';
import { EnforcementActionType } from '../../shared/types/common.js';
import {
  EnforcementActionStatus,
  ESCALATION_SEQUENCE,
  DECISION_TO_ACTION_TYPE,
  ESCALATION_TIMEOUT_MS,
} from './types.js';
import type {
  EnforcementAction,
  CreateEnforcementActionInput,
} from './types.js';

/**
 * Creates an EnforcementAction linked to a DecisionRecord.
 * Requirement 10.1: Created within 5 seconds of a denied/conditional decision.
 * Requirement 10.2: Supports all defined action types.
 */
export async function createEnforcementAction(
  input: CreateEnforcementActionInput
): Promise<EnforcementAction> {
  const now = new Date().toISOString();
  const actionId = uuidv4();

  // Determine action type based on decision result
  const actionType = determineActionType(input.decision_result);

  // Calculate escalation deadline (30 min from now for escalatable types)
  const deadline = isEscalatable(actionType)
    ? new Date(Date.now() + ESCALATION_TIMEOUT_MS).toISOString()
    : undefined;

  const action: EnforcementAction = {
    action_id: actionId,
    tenant_id: input.tenant_id,
    decision_id: input.decision_id,
    action_type: actionType,
    status: EnforcementActionStatus.PENDING,
    worker_id: input.worker_id,
    site_id: input.site_id,
    reason: input.reasons.length > 0 ? input.reasons[0]! : 'Compliance decision enforcement',
    created_at: now,
    updated_at: now,
    escalation_level: 0,
    deadline,
  };

  // Store in DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: getTableName('EnforcementActions'),
      Item: {
        PK: `TENANT#${input.tenant_id}`,
        SK: `ACTION#${actionId}`,
        GSI1PK: `DECISION#${input.decision_id}`,
        GSI1SK: `ACTION#${now}`,
        GSI2PK: `SITE#${input.site_id}`,
        GSI2SK: `ACTION#${now}`,
        ...action,
      },
    })
  );

  // Publish enforcement action created event for notification service
  try {
    await publishEvent({
      event_type: 'EnforcementActionCreated',
      source_service: 'enforcement-service',
      tenant_id: input.tenant_id,
      correlation_id: input.correlation_id,
      payload: {
        action_id: actionId,
        action_type: actionType,
        decision_id: input.decision_id,
        worker_id: input.worker_id,
        site_id: input.site_id,
        status: EnforcementActionStatus.PENDING,
      },
    });
  } catch (error) {
    console.error('Failed to publish EnforcementActionCreated event:', error);
  }

  return action;
}

/**
 * Determines the initial enforcement action type based on the decision result.
 * Requirement 10.2: Maps denied → deny_entry, conditional → require_manual_review_at_gate.
 */
export function determineActionType(decisionResult: string): EnforcementActionType {
  const mapped = DECISION_TO_ACTION_TYPE[decisionResult];
  if (mapped) return mapped;

  // Default to notify_supervisor for unknown decision results
  return EnforcementActionType.NOTIFY_SUPERVISOR;
}

/**
 * Checks if an action type is subject to auto-escalation.
 * Requirement 10.8: Only deny_entry and require_manual_review_at_gate escalate.
 */
export function isEscalatable(actionType: EnforcementActionType): boolean {
  return (
    actionType === EnforcementActionType.DENY_ENTRY ||
    actionType === EnforcementActionType.REQUIRE_MANUAL_REVIEW_AT_GATE
  );
}

/**
 * Gets the next action type in the escalation sequence.
 * Requirement 10.8: Escalate to next action type in sequence.
 */
export function getNextEscalationAction(
  currentActionType: EnforcementActionType
): EnforcementActionType | null {
  const currentIndex = ESCALATION_SEQUENCE.indexOf(currentActionType);

  if (currentIndex === -1) {
    // Not in escalation sequence — cannot escalate
    return null;
  }

  if (currentIndex >= ESCALATION_SEQUENCE.length - 1) {
    // Already at the highest escalation level
    return null;
  }

  return ESCALATION_SEQUENCE[currentIndex + 1]!;
}

/**
 * Escalates an enforcement action to the next level.
 * Requirement 10.8: If unresolved > 30 min, escalate to next action type.
 */
export async function escalateAction(
  tenantId: string,
  actionId: string
): Promise<EnforcementAction | null> {
  // Retrieve the current action
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('EnforcementActions'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `ACTION#${actionId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const currentAction = result.Items[0] as unknown as EnforcementAction & { PK: string; SK: string };

  // Only escalate pending/in_progress actions
  if (
    currentAction.status !== EnforcementActionStatus.PENDING &&
    currentAction.status !== EnforcementActionStatus.IN_PROGRESS
  ) {
    return null;
  }

  // Get next escalation action type
  const nextActionType = getNextEscalationAction(currentAction.action_type);
  if (!nextActionType) {
    return null; // Already at highest level
  }

  const now = new Date().toISOString();

  // Mark current action as escalated
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('EnforcementActions'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `ACTION#${actionId}`,
      },
      UpdateExpression: 'SET #status = :status, updated_at = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': EnforcementActionStatus.ESCALATED,
        ':updatedAt': now,
      },
    })
  );

  // Create new escalated action
  const newActionId = uuidv4();
  const newDeadline = isEscalatable(nextActionType)
    ? new Date(Date.now() + ESCALATION_TIMEOUT_MS).toISOString()
    : undefined;

  const escalatedAction: EnforcementAction = {
    action_id: newActionId,
    tenant_id: tenantId,
    decision_id: currentAction.decision_id,
    action_type: nextActionType,
    status: EnforcementActionStatus.PENDING,
    worker_id: currentAction.worker_id,
    site_id: currentAction.site_id,
    reason: `Escalated from ${currentAction.action_type}: ${currentAction.reason}`,
    created_at: now,
    updated_at: now,
    escalated_from: actionId,
    escalation_level: currentAction.escalation_level + 1,
    deadline: newDeadline,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName('EnforcementActions'),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `ACTION#${newActionId}`,
        GSI1PK: `DECISION#${currentAction.decision_id}`,
        GSI1SK: `ACTION#${now}`,
        GSI2PK: `SITE#${currentAction.site_id}`,
        GSI2SK: `ACTION#${now}`,
        ...escalatedAction,
      },
    })
  );

  // Publish escalation event
  try {
    await publishEvent({
      event_type: 'EnforcementActionEscalated',
      source_service: 'enforcement-service',
      tenant_id: tenantId,
      payload: {
        original_action_id: actionId,
        new_action_id: newActionId,
        original_action_type: currentAction.action_type,
        new_action_type: nextActionType,
        decision_id: currentAction.decision_id,
        worker_id: currentAction.worker_id,
        site_id: currentAction.site_id,
        escalation_level: escalatedAction.escalation_level,
      },
    });
  } catch (error) {
    console.error('Failed to publish EnforcementActionEscalated event:', error);
  }

  return escalatedAction;
}

/**
 * Resolves an enforcement action.
 */
export async function resolveAction(
  tenantId: string,
  actionId: string,
  resolvedBy?: string
): Promise<boolean> {
  const now = new Date().toISOString();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: getTableName('EnforcementActions'),
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: `ACTION#${actionId}`,
        },
        UpdateExpression: 'SET #status = :status, updated_at = :updatedAt, resolved_at = :resolvedAt, assigned_to = :assignedTo',
        ConditionExpression: '#status IN (:pending, :inProgress)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': EnforcementActionStatus.RESOLVED,
          ':updatedAt': now,
          ':resolvedAt': now,
          ':assignedTo': resolvedBy ?? 'system',
          ':pending': EnforcementActionStatus.PENDING,
          ':inProgress': EnforcementActionStatus.IN_PROGRESS,
        },
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Retrieves enforcement actions for a decision.
 */
export async function getActionsForDecision(
  tenantId: string,
  decisionId: string
): Promise<EnforcementAction[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('EnforcementActions'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `DECISION#${decisionId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items as unknown as EnforcementAction[];
}

/**
 * Retrieves unresolved enforcement actions for a site that have exceeded their deadline.
 * Used by the auto-escalation scheduled process.
 * Requirement 10.8.
 */
export async function getOverdueActions(
  tenantId: string,
  siteId: string
): Promise<EnforcementAction[]> {
  const now = new Date().toISOString();

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('EnforcementActions'),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :sitePk',
      FilterExpression: '#status IN (:pending, :inProgress) AND deadline < :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':sitePk': `SITE#${siteId}`,
        ':pending': EnforcementActionStatus.PENDING,
        ':inProgress': EnforcementActionStatus.IN_PROGRESS,
        ':now': now,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items as unknown as EnforcementAction[];
}

/**
 * Processes auto-escalation for overdue enforcement actions.
 * Requirement 10.8: If deny_entry or require_manual_review_at_gate unresolved > 30 min,
 * escalate to next action type.
 */
export async function processAutoEscalation(
  tenantId: string,
  siteId: string
): Promise<EnforcementAction[]> {
  const overdueActions = await getOverdueActions(tenantId, siteId);
  const escalatedActions: EnforcementAction[] = [];

  for (const action of overdueActions) {
    if (isEscalatable(action.action_type)) {
      const escalated = await escalateAction(tenantId, action.action_id);
      if (escalated) {
        escalatedActions.push(escalated);
      }
    }
  }

  return escalatedActions;
}
