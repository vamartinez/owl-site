/**
 * Finding Review Business Logic.
 * Handles the finding lifecycle: generated → pending_review → confirmed/dismissed/corrected.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { EventTypes } from '../../shared/types/events.js';
import { FindingStatus, Severity, EnforcementActionType } from '../../shared/types/common.js';
import {
  MIN_DISMISSAL_REASON_LENGTH,
  UNREVIEWED_STATUSES,
  HIGH_SEVERITY_LEVELS,
} from './types.js';
import type {
  Finding,
  ReviewFindingInput,
  EnforcementAction,
} from './types.js';

/**
 * Determines the initial status for a finding based on severity.
 * Requirement 9.2: high/critical → pending_review
 * Requirement 9.3: low/medium → generated
 */
export function determineInitialStatus(severity: Severity): FindingStatus {
  if (HIGH_SEVERITY_LEVELS.includes(severity)) {
    return FindingStatus.PENDING_REVIEW;
  }
  return FindingStatus.GENERATED;
}

/**
 * Checks if a finding can be reviewed (must be in generated or pending_review status).
 */
export function canBeReviewed(status: FindingStatus): boolean {
  return UNREVIEWED_STATUSES.includes(status);
}

/**
 * Checks if a finding status prevents enforcement actions.
 * Requirement 9.6: Unreviewed findings cannot trigger EnforcementActions.
 */
export function isUnreviewed(status: FindingStatus): boolean {
  return UNREVIEWED_STATUSES.includes(status);
}

/**
 * Validates a dismissal reason.
 * Requirement 9.5: reason ≥ 10 chars.
 */
export function validateDismissalReason(reason: string | undefined): string | null {
  if (!reason) {
    return 'Dismissal reason is required';
  }
  if (reason.length < MIN_DISMISSAL_REASON_LENGTH) {
    return `Dismissal reason must be at least ${MIN_DISMISSAL_REASON_LENGTH} characters`;
  }
  return null;
}

/**
 * Retrieves a finding by ID.
 */
export async function getFinding(
  tenantId: string,
  findingId: string
): Promise<Finding | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName('Findings'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `FINDING#${findingId}`,
      },
    })
  );

  if (!result.Item) return null;
  return result.Item as unknown as Finding;
}

/**
 * Lists findings for a tenant with optional filters.
 */
export async function listFindings(
  tenantId: string,
  filters?: {
    site_id?: string;
    status?: FindingStatus;
    severity?: Severity;
    limit?: number;
    next_token?: string;
  }
): Promise<{ findings: Finding[]; next_token?: string }> {
  // If filtering by site, use GSI1
  if (filters?.site_id) {
    const params: Record<string, unknown> = {
      TableName: getTableName('Findings'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `SITE#${filters.site_id}`,
      } as Record<string, unknown>,
      Limit: filters?.limit ?? 50,
      ScanIndexForward: false, // newest first
    };

    // Add filter expressions for status and severity
    const filterExpressions: string[] = [];
    if (filters?.status) {
      filterExpressions.push('#status = :status');
      (params['ExpressionAttributeValues'] as Record<string, unknown>)[':status'] = filters.status;
      params['ExpressionAttributeNames'] = { ...(params['ExpressionAttributeNames'] as Record<string, string> || {}), '#status': 'status' };
    }
    if (filters?.severity) {
      filterExpressions.push('severity = :severity');
      (params['ExpressionAttributeValues'] as Record<string, unknown>)[':severity'] = filters.severity;
    }
    if (filterExpressions.length > 0) {
      params['FilterExpression'] = filterExpressions.join(' AND ');
    }

    if (filters?.next_token) {
      params['ExclusiveStartKey'] = JSON.parse(
        Buffer.from(filters.next_token, 'base64').toString('utf-8')
      );
    }

    const result = await docClient.send(new QueryCommand(params as Parameters<typeof docClient.send>[0] extends { input: infer I } ? I : never));
    const findings = (result.Items ?? []) as unknown as Finding[];
    let nextToken: string | undefined;
    if (result.LastEvaluatedKey) {
      nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }
    return { findings, next_token: nextToken };
  }

  // Default: query by tenant
  const params: Record<string, unknown> = {
    TableName: getTableName('Findings'),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `TENANT#${tenantId}`,
      ':skPrefix': 'FINDING#',
    } as Record<string, unknown>,
    Limit: filters?.limit ?? 50,
    ScanIndexForward: false,
  };

  // Add filter expressions
  const filterExpressions: string[] = [];
  if (filters?.status) {
    filterExpressions.push('#status = :status');
    (params['ExpressionAttributeValues'] as Record<string, unknown>)[':status'] = filters.status;
    params['ExpressionAttributeNames'] = { ...(params['ExpressionAttributeNames'] as Record<string, string> || {}), '#status': 'status' };
  }
  if (filters?.severity) {
    filterExpressions.push('severity = :severity');
    (params['ExpressionAttributeValues'] as Record<string, unknown>)[':severity'] = filters.severity;
  }
  if (filterExpressions.length > 0) {
    params['FilterExpression'] = filterExpressions.join(' AND ');
  }

  if (filters?.next_token) {
    params['ExclusiveStartKey'] = JSON.parse(
      Buffer.from(filters.next_token, 'base64').toString('utf-8')
    );
  }

  const result = await docClient.send(new QueryCommand(params as Parameters<typeof docClient.send>[0] extends { input: infer I } ? I : never));
  const findings = (result.Items ?? []) as unknown as Finding[];
  let nextToken: string | undefined;
  if (result.LastEvaluatedKey) {
    nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }
  return { findings, next_token: nextToken };
}

/**
 * Reviews a finding: confirm or dismiss.
 * Requirement 9.4: Confirm updates status, records reviewer_id and timestamp.
 * Requirement 9.5: Dismiss requires reason ≥ 10 chars, records reviewer_id and timestamp.
 * Requirement 9.7: On confirm (high/critical), create EnforcementAction within 60s.
 */
export async function reviewFinding(
  tenantId: string,
  findingId: string,
  reviewerId: string,
  input: ReviewFindingInput
): Promise<{ finding: Finding; enforcement_action?: EnforcementAction }> {
  // Get the finding
  const finding = await getFinding(tenantId, findingId);
  if (!finding) {
    throw new FindingNotFoundError(findingId);
  }

  // Verify finding can be reviewed
  if (!canBeReviewed(finding.status)) {
    throw new FindingNotReviewableError(finding.status);
  }

  const now = new Date().toISOString();

  if (input.action === 'confirm') {
    return confirmFinding(tenantId, findingId, finding, reviewerId, now);
  } else if (input.action === 'dismiss') {
    return dismissFinding(tenantId, findingId, finding, reviewerId, input.reason, now);
  }

  throw new InvalidReviewActionError(input.action);
}

/**
 * Confirms a finding.
 * Requirement 9.4: Update status to confirmed, record reviewer_id and timestamp.
 * Requirement 9.7: If high/critical, create EnforcementAction within 60s.
 */
async function confirmFinding(
  tenantId: string,
  findingId: string,
  finding: Finding,
  reviewerId: string,
  timestamp: string
): Promise<{ finding: Finding; enforcement_action?: EnforcementAction }> {
  // Update finding status to confirmed
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('Findings'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `FINDING#${findingId}`,
      },
      UpdateExpression:
        'SET #status = :status, reviewer_id = :reviewerId, reviewed_at = :reviewedAt, updated_at = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': FindingStatus.CONFIRMED,
        ':reviewerId': reviewerId,
        ':reviewedAt': timestamp,
        ':updatedAt': timestamp,
      },
    })
  );

  const updatedFinding: Finding = {
    ...finding,
    status: FindingStatus.CONFIRMED,
    reviewer_id: reviewerId,
    reviewed_at: timestamp,
    updated_at: timestamp,
  };

  // Publish FindingReviewed event
  await publishEvent({
    event_type: EventTypes.FINDING_REVIEWED,
    source_service: 'findings',
    tenant_id: tenantId,
    payload: {
      finding_id: findingId,
      tenant_id: tenantId,
      reviewer_id: reviewerId,
      new_status: FindingStatus.CONFIRMED,
      severity: finding.severity,
      site_id: finding.site_id,
    },
  });

  // Requirement 9.7: On confirm (high/critical), create EnforcementAction
  let enforcementAction: EnforcementAction | undefined;
  if (HIGH_SEVERITY_LEVELS.includes(finding.severity)) {
    enforcementAction = await createEnforcementActionForFinding(
      tenantId,
      findingId,
      finding,
      timestamp
    );

    // Update finding with enforcement action reference
    await docClient.send(
      new UpdateCommand({
        TableName: getTableName('Findings'),
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: `FINDING#${findingId}`,
        },
        UpdateExpression: 'SET enforcement_action_id = :eaId',
        ExpressionAttributeValues: {
          ':eaId': enforcementAction.enforcement_action_id,
        },
      })
    );

    updatedFinding.enforcement_action_id = enforcementAction.enforcement_action_id;
  }

  return { finding: updatedFinding, enforcement_action: enforcementAction };
}

/**
 * Dismisses a finding.
 * Requirement 9.5: Require reason ≥ 10 chars, record reviewer_id and timestamp.
 */
async function dismissFinding(
  tenantId: string,
  findingId: string,
  finding: Finding,
  reviewerId: string,
  reason: string | undefined,
  timestamp: string
): Promise<{ finding: Finding }> {
  // Validate dismissal reason
  const reasonError = validateDismissalReason(reason);
  if (reasonError) {
    throw new InvalidDismissalReasonError(reasonError);
  }

  // Update finding status to dismissed
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName('Findings'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `FINDING#${findingId}`,
      },
      UpdateExpression:
        'SET #status = :status, reviewer_id = :reviewerId, reviewed_at = :reviewedAt, dismissal_reason = :reason, updated_at = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': FindingStatus.DISMISSED,
        ':reviewerId': reviewerId,
        ':reviewedAt': timestamp,
        ':reason': reason,
        ':updatedAt': timestamp,
      },
    })
  );

  const updatedFinding: Finding = {
    ...finding,
    status: FindingStatus.DISMISSED,
    reviewer_id: reviewerId,
    reviewed_at: timestamp,
    dismissal_reason: reason,
    updated_at: timestamp,
  };

  // Publish FindingReviewed event
  await publishEvent({
    event_type: EventTypes.FINDING_REVIEWED,
    source_service: 'findings',
    tenant_id: tenantId,
    payload: {
      finding_id: findingId,
      tenant_id: tenantId,
      reviewer_id: reviewerId,
      new_status: FindingStatus.DISMISSED,
      reason,
      severity: finding.severity,
      site_id: finding.site_id,
    },
  });

  return { finding: updatedFinding };
}

/**
 * Creates an EnforcementAction for a confirmed high/critical finding.
 * Requirement 9.7: Create within 60 seconds of confirmation.
 */
async function createEnforcementActionForFinding(
  tenantId: string,
  findingId: string,
  finding: Finding,
  timestamp: string
): Promise<EnforcementAction> {
  const enforcementActionId = uuidv4();

  const enforcementAction: EnforcementAction = {
    enforcement_action_id: enforcementActionId,
    tenant_id: tenantId,
    site_id: finding.site_id,
    finding_id: findingId,
    action_type: EnforcementActionType.CREATE_CORRECTIVE_ACTION_TASK,
    status: 'pending',
    created_at: timestamp,
    updated_at: timestamp,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName('EnforcementActions'),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `ENFORCEMENT#${enforcementActionId}`,
        GSI1PK: `SITE#${finding.site_id}`,
        GSI1SK: `ENFORCEMENT#${timestamp}`,
        GSI2PK: `FINDING#${findingId}`,
        GSI2SK: `ENFORCEMENT#${enforcementActionId}`,
        ...enforcementAction,
      },
    })
  );

  return enforcementAction;
}

// --- Custom Error Classes ---

export class FindingNotFoundError extends Error {
  constructor(findingId: string) {
    super(`Finding not found: ${findingId}`);
    this.name = 'FindingNotFoundError';
  }
}

export class FindingNotReviewableError extends Error {
  public currentStatus: FindingStatus;

  constructor(currentStatus: FindingStatus) {
    super(
      `Finding cannot be reviewed in its current status: ${currentStatus}. Only findings with status 'generated' or 'pending_review' can be reviewed.`
    );
    this.name = 'FindingNotReviewableError';
    this.currentStatus = currentStatus;
  }
}

export class InvalidDismissalReasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDismissalReasonError';
  }
}

export class InvalidReviewActionError extends Error {
  constructor(action: string) {
    super(`Invalid review action: ${action}. Must be 'confirm' or 'dismiss'.`);
    this.name = 'InvalidReviewActionError';
  }
}
