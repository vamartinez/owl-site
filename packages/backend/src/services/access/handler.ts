/**
 * Access Service Lambda Handler.
 * Handles access request orchestration, token management, scan sessions,
 * revalidation, and override workflows.
 *
 * Endpoints:
 * - POST /access/request — Submit access request (QR/SMS)
 * - POST /access/scan — Record scan session
 * - GET /access/decisions/{id} — Get decision with explainability
 * - POST /access/tokens — Generate access token
 * - DELETE /access/tokens/{id} — Revoke access token
 * - POST /access/revalidate — Submit revalidation attempt
 * - POST /access/override — Request override
 * - PATCH /access/override/{id} — Approve/reject override
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  forbidden,
  conflict,
  internalError,
  serviceUnavailable,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { EventTypes } from '../../shared/types/events.js';
import { TokenType, OverrideStatus, DecisionType } from '../../shared/types/common.js';
import { evaluateDecision } from '../decision-engine/evaluator.js';
import { generateToken, getToken, validateToken, markTokenUsed, revokeToken } from './token-manager.js';
import { recordScanSession, detectReplay } from './scan-session.js';
import type { OverrideRequest, RevalidationAttempt } from './types.js';
import { checkInSchema } from './schemas.js';
import { buildFilterExpression } from '../../shared/filter-utils.js';

// --- Zod Schemas ---

const accessRequestSchema = z.object({
  worker_id: z.string().uuid('worker_id must be a valid UUID'),
  site_id: z.string().uuid('site_id must be a valid UUID'),
  token_type: z.nativeEnum(TokenType),
  device_id: z.string().min(1, 'device_id is required'),
  qr_payload: z.string().optional(),
});

const scanSchema = z.object({
  token_id: z.string().uuid('token_id must be a valid UUID'),
  device_id: z.string().min(1, 'device_id is required'),
  scanner_type: z.enum(['qr', 'sms', 'gate_pass', 'manual']),
});

const tokenCreateSchema = z.object({
  worker_id: z.string().uuid('worker_id must be a valid UUID'),
  site_id: z.string().uuid('site_id must be a valid UUID'),
  token_type: z.nativeEnum(TokenType),
  device_id: z.string().min(1, 'device_id is required'),
});

const revalidateSchema = z.object({
  original_decision_id: z.string().uuid('original_decision_id must be a valid UUID'),
  worker_id: z.string().uuid('worker_id must be a valid UUID'),
  site_id: z.string().uuid('site_id must be a valid UUID'),
});

const overrideCreateSchema = z.object({
  decision_id: z.string().uuid('decision_id must be a valid UUID'),
  reason: z.string().min(1, 'reason is required').max(1000),
  evidence: z.string().min(1, 'evidence is required').max(2000),
});

const overrideUpdateSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  expiration_date: z.string().optional(),
});


// --- Lambda Handler ---

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
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
    if (httpMethod === 'POST' && resource === '/access/request') {
      return handleAccessRequest(event, user);
    }

    if (httpMethod === 'POST' && resource === '/access/scan') {
      return handleScan(event, user);
    }

    if (httpMethod === 'GET' && resource === '/access/decisions/{id}') {
      const decisionId = pathParameters?.['id'];
      if (!decisionId) return badRequest('Decision ID is required');
      return handleGetDecision(decisionId, user);
    }

    if (httpMethod === 'POST' && resource === '/access/tokens') {
      return handleCreateToken(event, user);
    }

    if (httpMethod === 'DELETE' && resource === '/access/tokens/{id}') {
      const tokenId = pathParameters?.['id'];
      if (!tokenId) return badRequest('Token ID is required');
      return handleRevokeToken(tokenId, user);
    }

    if (httpMethod === 'POST' && resource === '/access/revalidate') {
      return handleRevalidate(event, user);
    }

    if (httpMethod === 'POST' && resource === '/access/override') {
      return handleCreateOverride(event, user);
    }

    if (httpMethod === 'PATCH' && resource === '/access/override/{id}') {
      const overrideId = pathParameters?.['id'];
      if (!overrideId) return badRequest('Override ID is required');
      return handleUpdateOverride(event, overrideId, user);
    }

    // --- Site Access endpoints ---

    if (httpMethod === 'GET' && resource === '/site-access/live') {
      return handleLiveAccess(user);
    }

    if (httpMethod === 'POST' && resource === '/site-access/check-in') {
      return handleCheckIn(event, user);
    }

    if (httpMethod === 'GET' && resource === '/site-access/recent-checkins') {
      return handleRecentCheckIns(user);
    }

    if (httpMethod === 'GET' && resource === '/site-access/rules') {
      return handleAccessRules(user);
    }

    if (httpMethod === 'GET' && resource === '/site-access/rejections') {
      const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;
      return handleRejections(user, queryStringParameters);
    }

    if (httpMethod === 'GET' && resource === '/site-access/visits') {
      const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;
      return handleVisits(user, queryStringParameters);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Access handler error:', error);
    return internalError('An unexpected error occurred');
  }
}


// --- Route Handlers ---

/**
 * POST /access/request
 * Orchestrates: decode QR → generate token → call Decision Engine → return decision.
 * If Decision Engine unavailable: deny with "system temporarily unable to evaluate".
 */
async function handleAccessRequest(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:request'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = accessRequestSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { worker_id, site_id, token_type, device_id } = validation.data;

  // Step 1: Generate access token (TTL max 10 min)
  const token = await generateToken(
    user.tenant_id,
    worker_id,
    site_id,
    token_type,
    device_id
  );

  // Step 2: Call Decision Engine to evaluate access eligibility
  let decisionResult: string;
  let decisionId: string;
  let reasons: string[] = [];
  let policyVersionUsed: string | undefined;

  try {
    const correlationId = extractCorrelationId(event) ?? uuidv4();
    const evalResult = await evaluateDecision(
      {
        decision_type: DecisionType.SITE_ACCESS,
        subject_type: 'worker',
        subject_id: worker_id,
        site_id,
        context: {
          token_type,
          device_id,
          jurisdiction: 'BC', // Default jurisdiction for BC construction
          certifications: [], // Decision engine will fetch from DB
        },
      },
      user.tenant_id,
      correlationId
    );

    if (evalResult.error) {
      // Decision Engine returned an error — deny access
      decisionResult = 'denied';
      decisionId = uuidv4();
      reasons = [evalResult.error.message];
    } else {
      decisionResult = evalResult.response!.decision;
      decisionId = evalResult.response!.decision_id;
      reasons = evalResult.response!.reasons;
      policyVersionUsed = evalResult.response!.policy_version_used;
    }
  } catch {
    // Decision Engine unavailable — deny with specific message (Requirement 4.10)
    decisionResult = 'denied';
    decisionId = uuidv4();
    reasons = ['system temporarily unable to evaluate'];
  }

  // Step 3: Record scan session
  const scanResult = decisionResult as 'allowed' | 'conditional' | 'denied';
  await recordScanSession({
    tenant_id: user.tenant_id,
    worker_id,
    site_id,
    timestamp: new Date().toISOString(),
    scanner_type: tokenTypeToScannerType(token_type),
    device_id,
    token_ref: token.token_id,
    decision_ref: decisionId,
    result: scanResult,
    replay_risk_flag: false,
    policy_version_used: policyVersionUsed,
  });

  // Mark token as used
  await markTokenUsed(user.tenant_id, token.token_id);

  // Publish AccessRequested event
  try {
    await publishEvent({
      event_type: EventTypes.ACCESS_REQUESTED,
      source_service: 'access-service',
      tenant_id: user.tenant_id,
      payload: {
        access_request_id: token.token_id,
        worker_id,
        site_id,
        tenant_id: user.tenant_id,
        token_type,
      },
    });
  } catch (error) {
    console.error('Failed to publish AccessRequested event:', error);
  }

  return createSuccessResponse(200, {
    decision: decisionResult,
    decision_id: decisionId,
    reasons,
    token_id: token.token_id,
    policy_version_used: policyVersionUsed,
    expires_at: token.expires_at,
  });
}

/**
 * POST /access/scan
 * Records a scan session with QR replay detection.
 */
async function handleScan(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:scan'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = scanSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { token_id, device_id, scanner_type } = validation.data;

  // Retrieve the token
  const token = await getToken(user.tenant_id, token_id);
  if (!token) {
    return notFound('Token not found');
  }

  // Validate the token
  const tokenValidation = validateToken(token, device_id);

  // Check for replay risk
  const replayCheck = await detectReplay(user.tenant_id, token_id, device_id);

  if (replayCheck.isReplay || tokenValidation.replay_risk) {
    // Replay detected — flag and deny (Requirement 4.9)
    const session = await recordScanSession({
      tenant_id: user.tenant_id,
      worker_id: token.worker_id,
      site_id: token.site_id,
      timestamp: new Date().toISOString(),
      scanner_type,
      device_id,
      token_ref: token_id,
      decision_ref: '',
      result: 'denied',
      replay_risk_flag: true,
    });

    return createSuccessResponse(200, {
      decision: 'denied',
      session_id: session.session_id,
      replay_risk_flag: true,
      reason: replayCheck.reason ?? tokenValidation.error ?? 'QR replay detected',
    });
  }

  if (!tokenValidation.valid) {
    // Token invalid but not a replay — just deny
    const session = await recordScanSession({
      tenant_id: user.tenant_id,
      worker_id: token.worker_id,
      site_id: token.site_id,
      timestamp: new Date().toISOString(),
      scanner_type,
      device_id,
      token_ref: token_id,
      decision_ref: '',
      result: 'denied',
      replay_risk_flag: false,
    });

    return createSuccessResponse(200, {
      decision: 'denied',
      session_id: session.session_id,
      replay_risk_flag: false,
      reason: tokenValidation.error,
    });
  }

  // Token is valid — mark as used and evaluate
  await markTokenUsed(user.tenant_id, token_id);

  // Call Decision Engine
  let decisionResult: string;
  let decisionId: string;
  let reasons: string[] = [];
  let policyVersionUsed: string | undefined;

  try {
    const correlationId = extractCorrelationId(event) ?? uuidv4();
    const evalResult = await evaluateDecision(
      {
        decision_type: DecisionType.SITE_ACCESS,
        subject_type: 'worker',
        subject_id: token.worker_id,
        site_id: token.site_id,
        context: {
          token_type: token.token_type,
          device_id,
          jurisdiction: 'BC',
          certifications: [],
        },
      },
      user.tenant_id,
      correlationId
    );

    if (evalResult.error) {
      decisionResult = 'denied';
      decisionId = uuidv4();
      reasons = [evalResult.error.message];
    } else {
      decisionResult = evalResult.response!.decision;
      decisionId = evalResult.response!.decision_id;
      reasons = evalResult.response!.reasons;
      policyVersionUsed = evalResult.response!.policy_version_used;
    }
  } catch {
    // Decision Engine unavailable (Requirement 4.10)
    decisionResult = 'denied';
    decisionId = uuidv4();
    reasons = ['system temporarily unable to evaluate'];
  }

  const scanResult = decisionResult as 'allowed' | 'conditional' | 'denied';
  const session = await recordScanSession({
    tenant_id: user.tenant_id,
    worker_id: token.worker_id,
    site_id: token.site_id,
    timestamp: new Date().toISOString(),
    scanner_type,
    device_id,
    token_ref: token_id,
    decision_ref: decisionId,
    result: scanResult,
    replay_risk_flag: false,
    policy_version_used: policyVersionUsed,
  });

  return createSuccessResponse(200, {
    decision: decisionResult,
    decision_id: decisionId,
    session_id: session.session_id,
    reasons,
    policy_version_used: policyVersionUsed,
    replay_risk_flag: false,
  });
}


/**
 * GET /access/decisions/{id}
 * Retrieves a decision record with explainability.
 */
async function handleGetDecision(
  decisionId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

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

  const explainabilityPayload = record['explainability_payload']
    ? JSON.parse(record['explainability_payload'] as string)
    : null;

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
      explainability: explainabilityPayload,
    },
  });
}

/**
 * POST /access/tokens
 * Generates a new access token.
 */
async function handleCreateToken(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:request'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = tokenCreateSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { worker_id, site_id, token_type, device_id } = validation.data;

  const token = await generateToken(
    user.tenant_id,
    worker_id,
    site_id,
    token_type,
    device_id
  );

  return createSuccessResponse(201, { token });
}

/**
 * DELETE /access/tokens/{id}
 * Revokes an access token.
 */
async function handleRevokeToken(
  tokenId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:request'
  );
  if (permError) return permError;

  const result = await revokeToken(user.tenant_id, tokenId);

  if (!result.success) {
    return notFound(result.error ?? 'Token not found');
  }

  return createSuccessResponse(200, { message: 'Token revoked successfully' });
}


/**
 * POST /access/revalidate
 * Submits a revalidation attempt (max 3 per original decision per 24h).
 */
async function handleRevalidate(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:request'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = revalidateSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { original_decision_id, worker_id, site_id } = validation.data;

  // Check revalidation attempt count (max 3 per 24h)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const attemptsResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('RevalidationAttempts'),
      KeyConditionExpression: 'PK = :pk AND SK > :since',
      ExpressionAttributeValues: {
        ':pk': `DECISION#${original_decision_id}`,
        ':since': `ATTEMPT#${twentyFourHoursAgo}`,
      },
    })
  );

  const attemptCount = attemptsResult.Items?.length ?? 0;
  if (attemptCount >= 3) {
    return conflict('Maximum revalidation attempts (3) reached for this decision within 24 hours');
  }

  // Trigger new evaluation with updated worker data
  let newDecisionResult: string;
  let newDecisionId: string;
  let reasons: string[] = [];

  try {
    const correlationId = extractCorrelationId(event) ?? uuidv4();
    const evalResult = await evaluateDecision(
      {
        decision_type: DecisionType.SITE_ACCESS,
        subject_type: 'worker',
        subject_id: worker_id,
        site_id,
        context: {
          revalidation: true,
          original_decision_id,
          jurisdiction: 'BC',
          certifications: [],
        },
      },
      user.tenant_id,
      correlationId
    );

    if (evalResult.error) {
      newDecisionResult = 'denied';
      newDecisionId = uuidv4();
      reasons = [evalResult.error.message];
    } else {
      newDecisionResult = evalResult.response!.decision;
      newDecisionId = evalResult.response!.decision_id;
      reasons = evalResult.response!.reasons;
    }
  } catch {
    newDecisionResult = 'denied';
    newDecisionId = uuidv4();
    reasons = ['system temporarily unable to evaluate'];
  }

  // Record the revalidation attempt
  const attemptId = uuidv4();
  const attemptedAt = new Date().toISOString();

  const attempt: RevalidationAttempt = {
    attempt_id: attemptId,
    tenant_id: user.tenant_id,
    original_decision_id,
    worker_id,
    site_id,
    new_decision_id: newDecisionId,
    new_result: newDecisionResult,
    attempted_at: attemptedAt,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName('RevalidationAttempts'),
      Item: {
        PK: `DECISION#${original_decision_id}`,
        SK: `ATTEMPT#${attemptedAt}`,
        GSI1PK: `TENANT#${user.tenant_id}`,
        GSI1SK: `ATTEMPT#${attemptedAt}`,
        ...attempt,
      },
    })
  );

  return createSuccessResponse(200, {
    attempt_id: attemptId,
    original_decision_id,
    new_decision_id: newDecisionId,
    new_result: newDecisionResult,
    reasons,
    attempts_remaining: 3 - (attemptCount + 1),
  });
}

/**
 * POST /access/override
 * Creates an override request (requester, reason, evidence).
 * Original DecisionRecord remains immutable.
 */
async function handleCreateOverride(
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

  const validation = overrideCreateSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { decision_id, reason, evidence } = validation.data;

  // Verify the decision exists
  const decisionResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('DecisionRecords'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':sk': `DECISION#${decision_id}`,
      },
    })
  );

  if (!decisionResult.Items || decisionResult.Items.length === 0) {
    return notFound('Decision record not found');
  }

  const now = new Date().toISOString();
  const overrideId = uuidv4();

  const override: OverrideRequest = {
    override_id: overrideId,
    tenant_id: user.tenant_id,
    decision_id,
    requester_id: user.user_id,
    reason,
    evidence,
    status: OverrideStatus.PENDING,
    created_at: now,
    updated_at: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName('OverrideRequests'),
      Item: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `OVERRIDE#${overrideId}`,
        GSI1PK: `DECISION#${decision_id}`,
        GSI1SK: `OVERRIDE#${now}`,
        ...override,
      },
    })
  );

  return createSuccessResponse(201, { override });
}


/**
 * PATCH /access/override/{id}
 * Approves or rejects an override request.
 * If approved, records approver, timestamp, and expiration (max 90 days).
 */
async function handleUpdateOverride(
  event: ApiGatewayEvent,
  overrideId: string,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:override'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = overrideUpdateSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { status, expiration_date } = validation.data;

  // Retrieve the override
  const overrideResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('OverrideRequests'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':sk': `OVERRIDE#${overrideId}`,
      },
    })
  );

  if (!overrideResult.Items || overrideResult.Items.length === 0) {
    return notFound('Override request not found');
  }

  const existingOverride = overrideResult.Items[0] as Record<string, unknown>;

  if (existingOverride['status'] !== OverrideStatus.PENDING) {
    return conflict('Override request has already been processed');
  }

  const now = new Date();
  const updateValues: Record<string, unknown> = {
    ':status': status === 'approved' ? OverrideStatus.APPROVED : OverrideStatus.REJECTED,
    ':updatedAt': now.toISOString(),
    ':approverId': user.user_id,
    ':approvedAt': now.toISOString(),
  };

  let updateExpression = 'SET #status = :status, updated_at = :updatedAt, approver_id = :approverId, approved_at = :approvedAt';

  // Validate and set expiration date for approvals
  if (status === 'approved') {
    if (!expiration_date) {
      return badRequest('expiration_date is required when approving an override');
    }

    const expirationDate = new Date(expiration_date);
    const maxExpiration = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    if (expirationDate > maxExpiration) {
      return badRequest('Expiration date cannot exceed 90 days from approval');
    }

    if (expirationDate <= now) {
      return badRequest('Expiration date must be in the future');
    }

    updateValues[':expirationDate'] = expiration_date;
    updateExpression += ', expiration_date = :expirationDate';
  }

  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('OverrideRequests'),
      Key: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `OVERRIDE#${overrideId}`,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: updateValues,
    })
  );

  return createSuccessResponse(200, {
    override_id: overrideId,
    status: status === 'approved' ? OverrideStatus.APPROVED : OverrideStatus.REJECTED,
    approver_id: user.user_id,
    approved_at: now.toISOString(),
    expiration_date: status === 'approved' ? expiration_date : undefined,
  });
}

// --- Site Access Handlers ---

/**
 * GET /site-access/live
 * Returns workers currently on site (checked in but not checked out).
 */
async function handleLiveAccess(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('ScanSessions'),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'attribute_exists(#checkIn) AND attribute_not_exists(#checkOut)',
      ExpressionAttributeNames: {
        '#checkIn': 'check_in_time',
        '#checkOut': 'check_out_time',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
      },
    })
  );

  const workers = (result.Items ?? []).map((item: Record<string, unknown>) => ({
    id: item['session_id'] as string ?? item['worker_id'] as string ?? '',
    workerName: item['worker_name'] as string ?? '',
    site: item['site_name'] as string ?? item['site_id'] as string ?? '',
    checkInTime: item['check_in_time'] as string ?? '',
    contractor: item['contractor'] as string ?? '',
    complianceStatus: item['compliance_status'] as string ?? item['result'] as string ?? '',
  }));

  return createSuccessResponse(200, {
    workers,
    totalOnSite: workers.length,
  });
}

/**
 * POST /site-access/check-in
 * Validates workerId, looks up worker, evaluates compliance against site policies,
 * records the decision, and returns the check-in result.
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
async function handleCheckIn(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:scan'
  );
  if (permError) return permError;

  // Validate request body with Zod schema
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = checkInSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('workerId is required');
  }

  const { workerId } = validation.data;

  // Look up worker
  const workerResult = await docClient.send(
    new GetCommand({
      TableName: getTableName('Workers'),
      Key: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `WORKER#${workerId}`,
      },
    })
  );

  const worker = workerResult.Item as Record<string, unknown> | undefined;
  const workerName = (worker?.['legal_name'] as string) ?? (worker?.['preferred_name'] as string) ?? 'Unknown Worker';

  // Evaluate compliance against site policies using the decision engine
  let decision: 'allowed' | 'conditional' | 'denied' = 'denied';
  let reasons: string[] = [];
  let missingCerts: string[] = [];

  try {
    const correlationId = extractCorrelationId(event) ?? uuidv4();

    // Get the worker's assigned site (use first assigned site or a default)
    const siteId = (worker?.['site_id'] as string) ?? '';

    const evalResult = await evaluateDecision(
      {
        decision_type: DecisionType.SITE_ACCESS,
        subject_type: 'worker',
        subject_id: workerId,
        site_id: siteId,
        context: {
          jurisdiction: 'BC',
          certifications: [],
        },
      },
      user.tenant_id,
      correlationId
    );

    if (evalResult.error) {
      decision = 'denied';
      reasons = [evalResult.error.message];
    } else if (evalResult.response) {
      decision = evalResult.response.decision as 'allowed' | 'conditional' | 'denied';
      reasons = evalResult.response.reasons;

      // Extract missing certs from reasons that mention certification requirements
      missingCerts = evalResult.response.reasons
        .filter((r: string) => r.includes('does not hold required certification') || r.includes('has expired'))
        .map((r: string) => {
          const match = r.match(/certification[:\s]+"?([^".]+)"?/i) ?? r.match(/required certification:\s*(.+?)\./i);
          return match?.[1] ?? r;
        });
    }
  } catch {
    decision = 'denied';
    reasons = ['system temporarily unable to evaluate'];
  }

  // Record the scan session
  const timestamp = new Date().toISOString();
  await recordScanSession({
    tenant_id: user.tenant_id,
    worker_id: workerId,
    site_id: (worker?.['site_id'] as string) ?? '',
    timestamp,
    scanner_type: 'manual',
    device_id: 'check-in-portal',
    token_ref: '',
    decision_ref: '',
    result: decision,
    replay_risk_flag: false,
  });

  return createSuccessResponse(200, {
    decision,
    workerName,
    reasons,
    missingCerts,
  });
}

/**
 * GET /site-access/recent-checkins
 * Returns the 10 most recent check-in events, ordered by timestamp descending.
 */
async function handleRecentCheckIns(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('ScanSessions'),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
      },
      ScanIndexForward: false,
      Limit: 10,
    })
  );

  const items = result.Items ?? [];

  // Collect unique worker_ids and site_ids for batch lookup
  const workerIds = Array.from(new Set(items.map((item: Record<string, unknown>) => item['worker_id'] as string).filter(Boolean)));
  const siteIds = Array.from(new Set(items.map((item: Record<string, unknown>) => item['site_id'] as string).filter(Boolean)));
  const decisionRefs = items
    .filter((item: Record<string, unknown>) => item['result'] === 'denied' && item['decision_ref'])
    .map((item: Record<string, unknown>) => item['decision_ref'] as string)
    .filter(Boolean);

  // Resolve worker names
  const workerNameMap: Record<string, string> = {};
  await Promise.all(
    workerIds.map(async (workerId) => {
      try {
        const workerResult = await docClient.send(
          new GetCommand({
            TableName: getTableName('Workers'),
            Key: {
              PK: `TENANT#${user.tenant_id}`,
              SK: `WORKER#${workerId}`,
            },
          })
        );
        const worker = workerResult.Item as Record<string, unknown> | undefined;
        workerNameMap[workerId] = (worker?.['legal_name'] as string) ?? (worker?.['preferred_name'] as string) ?? 'Unknown Worker';
      } catch {
        workerNameMap[workerId] = 'Unknown Worker';
      }
    })
  );

  // Resolve site names
  const siteNameMap: Record<string, string> = {};
  await Promise.all(
    siteIds.map(async (siteId) => {
      try {
        const siteResult = await docClient.send(
          new GetCommand({
            TableName: getTableName('Sites'),
            Key: {
              PK: `TENANT#${user.tenant_id}`,
              SK: `SITE#${siteId}`,
            },
          })
        );
        const site = siteResult.Item as Record<string, unknown> | undefined;
        siteNameMap[siteId] = (site?.['name'] as string) ?? 'Unknown Site';
      } catch {
        siteNameMap[siteId] = 'Unknown Site';
      }
    })
  );

  // Resolve denial reasons from decision records
  const denialReasonMap: Record<string, string> = {};
  await Promise.all(
    decisionRefs.map(async (decisionRef) => {
      try {
        const decisionResult = await docClient.send(
          new QueryCommand({
            TableName: getTableName('DecisionRecords'),
            KeyConditionExpression: 'PK = :pk AND SK = :sk',
            ExpressionAttributeValues: {
              ':pk': `TENANT#${user.tenant_id}`,
              ':sk': `DECISION#${decisionRef}`,
            },
          })
        );
        const record = decisionResult.Items?.[0] as Record<string, unknown> | undefined;
        if (record?.['reasons']) {
          const reasons = record['reasons'] as string[];
          denialReasonMap[decisionRef] = reasons.join('; ');
        }
      } catch {
        // Decision record not found — leave denial reason empty
      }
    })
  );

  const checkIns = items.map((item: Record<string, unknown>) => {
    const workerId = item['worker_id'] as string ?? '';
    const siteId = item['site_id'] as string ?? '';
    const decisionRef = item['decision_ref'] as string ?? '';
    const decision = item['result'] as string ?? '';

    let denialReason: string | undefined;
    if (decision === 'denied') {
      if (decisionRef && denialReasonMap[decisionRef]) {
        denialReason = denialReasonMap[decisionRef];
      } else {
        denialReason = 'Compliance check failed';
      }
    }

    return {
      id: item['session_id'] as string ?? '',
      workerName: workerNameMap[workerId] ?? 'Unknown Worker',
      decision,
      timestamp: item['timestamp'] as string ?? '',
      site: siteNameMap[siteId] ?? 'Unknown Site',
      denialReason,
    };
  });

  return createSuccessResponse(200, { checkIns });
}

/**
 * GET /site-access/rules
 * Returns configured access rules (policies of access rule type) for the tenant.
 */
async function handleAccessRules(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Policies'),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: '#policyType = :accessRule',
      ExpressionAttributeNames: {
        '#policyType': 'policy_type',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':prefix': 'POLICY#',
        ':accessRule': 'access_rule',
      },
    })
  );

  const rules = (result.Items ?? []).map((item: Record<string, unknown>) => ({
    id: item['policy_id'] as string ?? '',
    name: item['name'] as string ?? '',
    site: item['site_name'] as string ?? item['site_id'] as string ?? '',
    requiredCerts: (item['required_certs'] as string[]) ?? [],
    enforcementLevel: item['enforcement_level'] as string ?? '',
    isActive: (item['is_active'] as boolean) ?? true,
    createdAt: item['created_at'] as string ?? '',
  }));

  return createSuccessResponse(200, {
    rules,
    total: rules.length,
  });
}

/**
 * GET /site-access/rejections
 * Returns access rejection events with optional search/reason/period filters.
 */
async function handleRejections(
  user: { user_id: string; tenant_id: string; role: string },
  queryStringParameters: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

  const search = queryStringParameters?.['search'];
  const reason = queryStringParameters?.['reason'];
  const period = queryStringParameters?.['period'];

  const filterResult = buildFilterExpression({ search, reason, period });

  // Base filter: result = 'denied'
  const baseFilter = '#result = :denied';
  const baseNames: Record<string, string> = { '#result': 'result' };
  const baseValues: Record<string, unknown> = {
    ':pk': `TENANT#${user.tenant_id}`,
    ':denied': 'denied',
  };

  // Merge base filter with additional filters from the utility
  let combinedFilter = baseFilter;
  let combinedNames = { ...baseNames };
  let combinedValues = { ...baseValues };

  if (filterResult.filterExpression) {
    combinedFilter = `${baseFilter} AND ${filterResult.filterExpression}`;
    combinedNames = { ...combinedNames, ...filterResult.expressionAttributeNames };
    combinedValues = { ...combinedValues, ...filterResult.expressionAttributeValues };
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('ScanSessions'),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: combinedFilter,
      ExpressionAttributeNames: combinedNames,
      ExpressionAttributeValues: combinedValues,
    })
  );

  const rejections = (result.Items ?? []).map((item: Record<string, unknown>) => ({
    id: item['session_id'] as string ?? '',
    workerName: item['worker_name'] as string ?? '',
    site: item['site_name'] as string ?? item['site_id'] as string ?? '',
    reason: item['reason'] as string ?? item['reasons']?.[0] as string ?? '',
    timestamp: item['timestamp'] as string ?? item['check_in_time'] as string ?? '',
    missingRequirements: (item['missing_requirements'] as string[]) ?? (item['missing_certs'] as string[]) ?? [],
  }));

  return createSuccessResponse(200, {
    rejections,
    total: rejections.length,
  });
}

/**
 * GET /site-access/visits
 * Returns historical visit log with optional search/decision/period filters.
 */
async function handleVisits(
  user: { user_id: string; tenant_id: string; role: string },
  queryStringParameters: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'access:read_decisions'
  );
  if (permError) return permError;

  const search = queryStringParameters?.['search'];
  const decision = queryStringParameters?.['decision'];
  const period = queryStringParameters?.['period'];

  const filterResult = buildFilterExpression({ search, decision, period });

  const queryParams: Record<string, unknown> = {
    TableName: getTableName('ScanSessions'),
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `TENANT#${user.tenant_id}`,
    },
  };

  if (filterResult.filterExpression) {
    queryParams['FilterExpression'] = filterResult.filterExpression;
    queryParams['ExpressionAttributeNames'] = filterResult.expressionAttributeNames;
    queryParams['ExpressionAttributeValues'] = {
      ...(queryParams['ExpressionAttributeValues'] as Record<string, unknown>),
      ...filterResult.expressionAttributeValues,
    };
  }

  const result = await docClient.send(new QueryCommand(queryParams as ConstructorParameters<typeof QueryCommand>[0]));

  const visits = (result.Items ?? []).map((item: Record<string, unknown>) => {
    const checkInTime = item['check_in_time'] as string | undefined;
    const checkOutTime = item['check_out_time'] as string | undefined ?? null;

    let duration: string | null = null;
    if (checkInTime && checkOutTime) {
      const durationMs = new Date(checkOutTime).getTime() - new Date(checkInTime).getTime();
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      duration = `${hours}h ${minutes}m`;
    }

    return {
      id: item['session_id'] as string ?? '',
      workerName: item['worker_name'] as string ?? '',
      site: item['site_name'] as string ?? item['site_id'] as string ?? '',
      checkInTime: checkInTime ?? '',
      checkOutTime,
      duration,
      decision: item['result'] as string ?? '',
    };
  });

  return createSuccessResponse(200, {
    visits,
    total: visits.length,
  });
}

// --- Helper Functions ---

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

/**
 * Maps token type to scanner type for scan session recording.
 */
function tokenTypeToScannerType(tokenType: TokenType): 'qr' | 'sms' | 'gate_pass' | 'manual' {
  switch (tokenType) {
    case TokenType.QR_SESSION:
      return 'qr';
    case TokenType.SMS_MAGIC_LINK:
      return 'sms';
    case TokenType.GATE_PASS:
      return 'gate_pass';
    default:
      return 'manual';
  }
}
