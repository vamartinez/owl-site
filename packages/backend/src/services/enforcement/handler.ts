/**
 * Enforcement Service Lambda Handler.
 * Handles enforcement action creation, resolution, escalation,
 * and integrates with the decision engine for real-time enforcement.
 *
 * Endpoints:
 * - GET /enforcement/actions — List enforcement actions (filtered by site/status)
 * - GET /enforcement/actions/{id} — Get enforcement action details
 * - PATCH /enforcement/actions/{id} — Resolve an enforcement action
 * - POST /enforcement/escalate — Trigger manual escalation
 *
 * SQS Consumer:
 * - Processes AccessDecisionGenerated events to create enforcement actions
 * - Processes auto-escalation checks
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
 */

import { z } from 'zod';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import {
  createEnforcementAction,
  resolveAction,
  escalateAction,
  getActionsForDecision,
  processAutoEscalation,
} from './enforcement-engine.js';
import { EnforcementActionStatus } from './types.js';
import type { EnforcementAction } from './types.js';

// --- Zod Schemas ---

const resolveActionSchema = z.object({
  resolved_by: z.string().min(1).optional(),
});

const escalateSchema = z.object({
  action_id: z.string().uuid('action_id must be a valid UUID'),
});

// --- SQS Event Types ---

interface SQSEvent {
  Records: SQSRecord[];
}

interface SQSRecord {
  messageId: string;
  body: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, { stringValue?: string }>;
}

// --- Lambda Handler ---

/**
 * Main Lambda handler supporting both API Gateway and SQS event sources.
 */
export async function handler(
  event: ApiGatewayEvent | SQSEvent
): Promise<ApiGatewayResponse | void> {
  if (isSQSEvent(event)) {
    return handleSQSEvent(event as SQSEvent);
  }

  return handleApiEvent(event as ApiGatewayEvent);
}

/**
 * Handles API Gateway requests.
 */
async function handleApiEvent(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;
    const pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;
    const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;

    // Authenticate
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    // Route to appropriate handler
    if (httpMethod === 'GET' && resource === '/enforcement/actions') {
      return handleListActions(queryStringParameters, user);
    }

    if (httpMethod === 'GET' && resource === '/enforcement/actions/{id}') {
      const actionId = pathParameters?.['id'];
      if (!actionId) return badRequest('Action ID is required');
      return handleGetAction(actionId, user);
    }

    if (httpMethod === 'PATCH' && resource === '/enforcement/actions/{id}') {
      const actionId = pathParameters?.['id'];
      if (!actionId) return badRequest('Action ID is required');
      return handleResolveAction(event, actionId, user);
    }

    if (httpMethod === 'POST' && resource === '/enforcement/escalate') {
      return handleManualEscalation(event, user);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Enforcement handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

/**
 * Handles SQS events — processes decision events to create enforcement actions
 * and handles auto-escalation checks.
 */
async function handleSQSEvent(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body) as {
        event_type: string;
        tenant_id: string;
        payload: Record<string, unknown>;
        correlation_id?: string;
      };

      if (message.event_type === 'AccessDecisionGenerated') {
        await handleDecisionEvent(message);
      } else if (message.event_type === 'AutoEscalationCheck') {
        await handleAutoEscalationCheck(message);
      }
    } catch (error) {
      console.error(`Failed to process SQS message ${record.messageId}:`, error);
      throw error; // Let it go to DLQ
    }
  }
}

/**
 * Processes an AccessDecisionGenerated event.
 * Requirement 10.1: Create EnforcementAction within 5s of denied/conditional decision.
 */
async function handleDecisionEvent(message: {
  event_type: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
}): Promise<void> {
  const { tenant_id, payload, correlation_id } = message;
  const decisionResult = payload['decision_result'] as string;

  // Only create enforcement actions for denied or conditional decisions
  if (decisionResult !== 'denied' && decisionResult !== 'conditional') {
    return;
  }

  const decisionId = payload['decision_id'] as string;
  const workerId = payload['worker_id'] as string;
  const siteId = payload['site_id'] as string;

  await createEnforcementAction({
    tenant_id,
    decision_id: decisionId,
    decision_result: decisionResult,
    worker_id: workerId,
    site_id: siteId,
    reasons: (payload['reasons'] as string[]) ?? ['Compliance decision enforcement'],
    correlation_id,
  });
}

/**
 * Processes auto-escalation checks for a site.
 * Requirement 10.8.
 */
async function handleAutoEscalationCheck(message: {
  tenant_id: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { tenant_id, payload } = message;
  const siteId = payload['site_id'] as string;

  if (!siteId) {
    console.error('AutoEscalationCheck missing site_id');
    return;
  }

  const escalated = await processAutoEscalation(tenant_id, siteId);
  if (escalated.length > 0) {
    console.info(`Auto-escalated ${escalated.length} actions for site ${siteId}`);
  }
}

// --- API Route Handlers ---

/**
 * GET /enforcement/actions — List enforcement actions filtered by site and/or status.
 */
async function handleListActions(
  queryParams: Record<string, string> | null,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

  const siteId = queryParams?.['site_id'];
  const status = queryParams?.['status'];
  const decisionId = queryParams?.['decision_id'];

  let actions: EnforcementAction[];

  if (decisionId) {
    actions = await getActionsForDecision(user.tenant_id, decisionId);
  } else if (siteId) {
    const result = await docClient.send(
      new QueryCommand({
        TableName: getTableName('EnforcementActions'),
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :sitePk',
        ...(status
          ? {
              FilterExpression: '#status = :status',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':sitePk': `SITE#${siteId}`,
                ':status': status,
              },
            }
          : {
              ExpressionAttributeValues: {
                ':sitePk': `SITE#${siteId}`,
              },
            }),
      })
    );
    actions = (result.Items ?? []) as unknown as EnforcementAction[];
  } else {
    // List all actions for tenant
    const result = await docClient.send(
      new QueryCommand({
        TableName: getTableName('EnforcementActions'),
        KeyConditionExpression: 'PK = :pk',
        ...(status
          ? {
              FilterExpression: '#status = :status',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':pk': `TENANT#${user.tenant_id}`,
                ':status': status,
              },
            }
          : {
              ExpressionAttributeValues: {
                ':pk': `TENANT#${user.tenant_id}`,
              },
            }),
      })
    );
    actions = (result.Items ?? []) as unknown as EnforcementAction[];
  }

  return createSuccessResponse(200, { actions });
}

/**
 * GET /enforcement/actions/{id} — Get enforcement action details.
 */
async function handleGetAction(
  actionId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('EnforcementActions'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':sk': `ACTION#${actionId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return notFound('Enforcement action not found');
  }

  return createSuccessResponse(200, { action: result.Items[0] });
}

/**
 * PATCH /enforcement/actions/{id} — Resolve an enforcement action.
 */
async function handleResolveAction(
  event: ApiGatewayEvent,
  actionId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:override'
  );
  if (permError) return permError;

  const body = parseBody(event);
  const resolvedBy = body?.['resolved_by'] as string | undefined ?? user.user_id;

  const success = await resolveAction(user.tenant_id, actionId, resolvedBy);

  if (!success) {
    return notFound('Enforcement action not found or already resolved');
  }

  return createSuccessResponse(200, {
    action_id: actionId,
    status: EnforcementActionStatus.RESOLVED,
    resolved_by: resolvedBy,
  });
}

/**
 * POST /enforcement/escalate — Trigger manual escalation.
 */
async function handleManualEscalation(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:override'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = escalateSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { action_id } = validation.data;

  const escalated = await escalateAction(user.tenant_id, action_id);

  if (!escalated) {
    return notFound('Action not found, already resolved, or cannot be escalated further');
  }

  return createSuccessResponse(200, { escalated_action: escalated });
}

// --- Helper Functions ---

function isSQSEvent(event: unknown): boolean {
  return (
    typeof event === 'object' &&
    event !== null &&
    'Records' in event &&
    Array.isArray((event as Record<string, unknown>)['Records'])
  );
}

function parseBody(event: ApiGatewayEvent): Record<string, unknown> | null {
  const body = (event as Record<string, unknown>)['body'];
  if (!body) return null;

  try {
    if (typeof body === 'string') {
      return JSON.parse(body) as Record<string, unknown>;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
