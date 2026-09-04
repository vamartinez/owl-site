/**
 * Compliance Decision Engine Lambda Handler.
 * Supports both synchronous API Gateway invocations and asynchronous SQS message consumption.
 *
 * Endpoints:
 * - POST /decisions/evaluate — Synchronous decision evaluation
 * - GET /decisions/{id} — Get decision record with role-based explainability filtering
 * - GET /decisions/{id}/history — Get decision history with PolicyVersion details
 * - POST /decisions/{id}/replay — Replay a historical decision
 *
 * SQS Consumer:
 * - Processes decision evaluation requests from the decision queue
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.5, 2.6, 12.1, 12.3, 12.4, 12.6, 12.7
 */

import { z } from 'zod';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission, enforceTenantIsolation } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  internalError,
  unprocessableEntity,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { evaluateDecision } from './evaluator.js';
import { getDecisionHistory, replayDecision, filterExplainabilityByRole } from './replay.js';
import type { DecisionRequest } from './types.js';
import { Role } from '../../shared/types/common.js';

// --- Zod Schemas ---

const evaluateDecisionSchema = z.object({
  decision_type: z.enum(['site_access', 'certification_compliance', 'ai_finding', 'corrective_action']),
  subject_type: z.enum(['worker', 'inspection', 'finding']),
  subject_id: z.string().min(1, 'subject_id is required'),
  site_id: z.string().min(1, 'site_id is required').optional(),
  context: z.record(z.unknown()),
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
  // Determine if this is an SQS event or API Gateway event
  if (isSQSEvent(event)) {
    return handleSQSEvent(event as SQSEvent);
  }

  return handleApiEvent(event as ApiGatewayEvent);
}

/**
 * Handles API Gateway requests (synchronous evaluation).
 */
async function handleApiEvent(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;
    const pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;

    // Authenticate
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    // Route to appropriate handler
    if (httpMethod === 'POST' && resource === '/decisions/evaluate') {
      return handleEvaluateDecision(event, user);
    }

    if (httpMethod === 'GET' && resource === '/decisions/{id}') {
      const decisionId = pathParameters?.['id'];
      if (!decisionId) return badRequest('Decision ID is required');
      return handleGetDecision(decisionId, user);
    }

    if (httpMethod === 'GET' && resource === '/decisions/{id}/history') {
      const decisionId = pathParameters?.['id'];
      if (!decisionId) return badRequest('Decision ID is required');
      return handleGetDecisionHistory(decisionId, user);
    }

    if (httpMethod === 'POST' && resource === '/decisions/{id}/replay') {
      const decisionId = pathParameters?.['id'];
      if (!decisionId) return badRequest('Decision ID is required');
      return handleReplayDecision(decisionId, user);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Decision engine handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

/**
 * Handles SQS events (asynchronous evaluation).
 */
async function handleSQSEvent(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body) as {
        request: DecisionRequest;
        tenant_id: string;
        correlation_id?: string;
      };

      const result = await evaluateDecision(
        message.request,
        message.tenant_id,
        message.correlation_id
      );

      if (result.error) {
        console.error(
          `Decision evaluation failed for message ${record.messageId}:`,
          result.error
        );
      } else {
        console.info(
          `Decision ${result.response!.decision_id} produced: ${result.response!.decision}`
        );
      }
    } catch (error) {
      console.error(`Failed to process SQS message ${record.messageId}:`, error);
      // Let the message go to DLQ after max retries
      throw error;
    }
  }
}

// --- Route Handlers ---

/**
 * POST /decisions/evaluate — Synchronous decision evaluation.
 */
async function handleEvaluateDecision(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  // Check permission
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:request'
  );
  if (permError) return permError;

  // Parse and validate body
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = evaluateDecisionSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const request: DecisionRequest = validation.data as DecisionRequest;
  const correlationId = extractCorrelationId(event);

  // Execute evaluation
  const result = await evaluateDecision(request, user.tenant_id, correlationId);

  if (result.error) {
    if (result.error.code === 'INCOMPLETE_INPUT') {
      return badRequest(result.error.message, {
        missing_inputs: result.error.missing_inputs,
      });
    }
    if (result.error.code === 'EXPLAINABILITY_INCOMPLETE') {
      return unprocessableEntity(result.error.message);
    }
    return internalError(result.error.message);
  }

  return createSuccessResponse(200, { decision: result.response });
}

/**
 * GET /decisions/{id} — Retrieve a decision record with role-based explainability filtering.
 * Requirement 12.4: Enforce explanation visibility levels based on requesting role.
 * Requirement 12.7: Retrieve and return within 10 seconds.
 */
async function handleGetDecision(
  decisionId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  // Check permission
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

  // Query the decision record
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('DecisionRecords'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':sk': `DECISION#${decisionId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return notFound('Decision record not found');
  }

  const record = result.Items[0] as Record<string, unknown>;

  // Enforce tenant isolation
  const tenantError = enforceTenantIsolation(
    user as Parameters<typeof enforceTenantIsolation>[0],
    record['tenant_id'] as string
  );
  if (tenantError) return tenantError;

  // Parse the explainability payload and filter by role
  const rawExplainability = record['explainability_payload']
    ? JSON.parse(record['explainability_payload'] as string)
    : null;

  const filteredExplainability = filterExplainabilityByRole(
    rawExplainability,
    user.role as Role
  );

  return createSuccessResponse(200, {
    decision: {
      decision_id: record['decision_id'],
      decision_result: record['decision_result'],
      decision_type: record['decision_type'],
      subject_type: record['subject_type'],
      subject_id: record['subject_id'],
      site_id: record['site_id'],
      reasons: record['reasons'],
      rules_applied: record['rules_applied'],
      policy_version_used: record['policy_version_used'],
      jurisdiction: record['jurisdiction'],
      timestamp: record['timestamp'],
      explainability: filteredExplainability,
    },
  });
}

/**
 * GET /decisions/{id}/history — Retrieve decision history with PolicyVersion details.
 * Requirement 2.5: Display PolicyVersion effective at decision time.
 * Requirement 12.7: Retrieve and return within 10 seconds.
 */
async function handleGetDecisionHistory(
  decisionId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  // Check permission
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

  const result = await getDecisionHistory(
    decisionId,
    user.tenant_id,
    user.role as Role
  );

  if (result.error) {
    return notFound(result.error);
  }

  return createSuccessResponse(200, { decision_history: result.data });
}

/**
 * POST /decisions/{id}/replay — Replay a historical decision.
 * Requirement 2.6: Re-evaluate original inputs against the PolicyVersion active
 * at original evaluation time, return new result alongside original.
 */
async function handleReplayDecision(
  decisionId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  // Only admins can replay decisions
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

  const result = await replayDecision(decisionId, user.tenant_id);

  if (result.error) {
    return badRequest(result.error);
  }

  return createSuccessResponse(200, { replay: result.data });
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

function extractCorrelationId(event: ApiGatewayEvent): string | undefined {
  return (
    event.headers['X-Correlation-Id'] ??
    event.headers['x-correlation-id'] ??
    undefined
  );
}
