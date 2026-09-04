/**
 * Decision Replay and History Module.
 *
 * Provides:
 * 1. Replay endpoint: re-evaluate original inputs against the PolicyVersion
 *    that was active at the original evaluation time, returning both the new
 *    result and the original recorded outcome.
 * 2. Decision history query: display PolicyVersion effective at decision time
 *    (version number, effective_from, change_summary).
 * 3. Explainability visibility filtering by role:
 *    - worker: reasons + required actions only
 *    - supervisor: reasons + rule_references
 *    - admin (tenant_admin, site_admin, platform_admin, cso): full payload
 *
 * Requirements: 2.5, 2.6, 12.4, 12.7
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { Role } from '../../shared/types/common.js';
import { evaluateRules, determineDecisionResult, generateReasons } from './evaluator.js';
import { generateExplainabilityPayload } from './explainability.js';
import { DecisionResult, DecisionType } from './types.js';
import type {
  ExplainabilityPayload,
  DecisionRecord,
  ResolvedPolicyVersion,
  PolicyRequirement,
  WorkerCertification,
} from './types.js';

// --- Types ---

export interface DecisionHistoryEntry {
  decision_id: string;
  decision_result: string;
  decision_type: string;
  subject_type: string;
  subject_id: string;
  site_id: string;
  reasons: string[];
  rules_applied: string[];
  jurisdiction: string;
  timestamp: string;
  policy_version: {
    policy_version_id: string;
    version_number: number;
    effective_from: string;
    change_summary: string;
  };
  explainability: Partial<ExplainabilityPayload> | null;
}

export interface ReplayResult {
  original_decision: {
    decision_id: string;
    decision_result: string;
    reasons: string[];
    rules_applied: string[];
    timestamp: string;
  };
  replay_decision: {
    decision_result: string;
    reasons: string[];
    rules_applied: string[];
    timestamp: string;
    explainability: ExplainabilityPayload | null;
  };
  policy_version_used: {
    policy_version_id: string;
    version_number: number;
    effective_from: string;
    change_summary: string;
  };
  inputs_match: boolean;
}

// --- Explainability Visibility Filtering ---

/**
 * Admin roles that see the full explainability payload.
 */
const ADMIN_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.TENANT_ADMIN,
  Role.SITE_ADMIN,
  Role.CSO,
];

/**
 * Filters the explainability payload based on the requesting user's role.
 *
 * Requirement 12.4:
 * - worker: sees reasons and required actions only
 * - supervisor: sees reasons and rule_references
 * - admin (tenant_admin, site_admin, platform_admin, cso): sees full payload
 */
export function filterExplainabilityByRole(
  payload: ExplainabilityPayload | null,
  role: Role
): Partial<ExplainabilityPayload> | null {
  if (!payload) return null;

  // Admin roles see the full payload
  if (ADMIN_ROLES.includes(role)) {
    return payload;
  }

  // Supervisor: reasons + rule_references
  if (role === Role.SUPERVISOR) {
    return {
      decision: payload.decision,
      decision_type: payload.decision_type,
      timestamp: payload.timestamp,
      reasons: payload.reasons,
      rule_references: payload.rule_references,
    };
  }

  // Worker (and gate_operator): reasons + required actions only
  return {
    decision: payload.decision,
    decision_type: payload.decision_type,
    timestamp: payload.timestamp,
    reasons: payload.reasons,
  };
}

// --- Decision History ---

/**
 * Retrieves a decision record with its associated PolicyVersion details.
 * Returns the PolicyVersion that was effective at the time of the decision,
 * including version number, effective_from, and change_summary.
 *
 * Requirement 2.5: Display PolicyVersion effective at decision time.
 * Requirement 12.7: Retrieve and return within 10 seconds.
 */
export async function getDecisionHistory(
  decisionId: string,
  tenantId: string,
  userRole: Role
): Promise<{ data?: DecisionHistoryEntry; error?: string }> {
  // Fetch the decision record
  const decisionResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('DecisionRecords'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `DECISION#${decisionId}`,
      },
    })
  );

  if (!decisionResult.Items || decisionResult.Items.length === 0) {
    return { error: 'Decision record not found' };
  }

  const record = decisionResult.Items[0] as Record<string, unknown>;
  const policyVersionId = record['policy_version_used'] as string;

  // Fetch the PolicyVersion details
  let policyVersionInfo = {
    policy_version_id: policyVersionId,
    version_number: 0,
    effective_from: '',
    change_summary: '',
  };

  if (policyVersionId && policyVersionId !== 'NONE') {
    const pvResult = await docClient.send(
      new QueryCommand({
        TableName: getTableName('PolicyVersions'),
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pvId',
        ExpressionAttributeValues: {
          ':pvId': `VERSION#${policyVersionId}`,
        },
      })
    );

    if (pvResult.Items && pvResult.Items.length > 0) {
      const pvItem = pvResult.Items[0] as Record<string, unknown>;
      policyVersionInfo = {
        policy_version_id: policyVersionId,
        version_number: (pvItem['version_number'] as number) ?? 0,
        effective_from: (pvItem['effective_from'] as string) ?? '',
        change_summary: (pvItem['change_summary'] as string) ?? '',
      };
    }
  }

  // Parse and filter explainability payload
  const rawExplainability = record['explainability_payload']
    ? JSON.parse(record['explainability_payload'] as string) as ExplainabilityPayload
    : null;

  const filteredExplainability = filterExplainabilityByRole(rawExplainability, userRole);

  const historyEntry: DecisionHistoryEntry = {
    decision_id: record['decision_id'] as string,
    decision_result: record['decision_result'] as string,
    decision_type: record['decision_type'] as string,
    subject_type: record['subject_type'] as string,
    subject_id: record['subject_id'] as string,
    site_id: record['site_id'] as string,
    reasons: record['reasons'] as string[],
    rules_applied: record['rules_applied'] as string[],
    jurisdiction: record['jurisdiction'] as string,
    timestamp: record['timestamp'] as string,
    policy_version: policyVersionInfo,
    explainability: filteredExplainability,
  };

  return { data: historyEntry };
}

// --- Decision Replay ---

/**
 * Replays a historical decision by re-evaluating the original inputs against
 * the PolicyVersion that was active at the original evaluation time.
 *
 * Requirement 2.6: Re-evaluate original inputs against the PolicyVersion active
 * at original evaluation time, return new result alongside original.
 */
export async function replayDecision(
  decisionId: string,
  tenantId: string
): Promise<{ data?: ReplayResult; error?: string }> {
  // Fetch the original decision record
  const decisionResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('DecisionRecords'),
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `DECISION#${decisionId}`,
      },
    })
  );

  if (!decisionResult.Items || decisionResult.Items.length === 0) {
    return { error: 'Decision record not found' };
  }

  const record = decisionResult.Items[0] as Record<string, unknown>;
  const policyVersionId = record['policy_version_used'] as string;
  const ruleSnapshotJson = record['rule_snapshot_json'] as string;
  const subjectId = record['subject_id'] as string;
  const siteId = record['site_id'] as string;
  const decisionType = record['decision_type'] as string;
  const subjectType = record['subject_type'] as string;
  const jurisdiction = record['jurisdiction'] as string;

  // Cannot replay if no policy version was used
  if (!policyVersionId || policyVersionId === 'NONE') {
    return { error: 'Cannot replay decision: no policy version was used in the original evaluation' };
  }

  // Resolve the PolicyVersion that was active at original evaluation time
  const policyVersion = await resolvePolicyVersionById(policyVersionId);
  if (!policyVersion) {
    return { error: 'Cannot replay decision: the original policy version is no longer available' };
  }

  // Get the original rule snapshot (the rules as they were at evaluation time)
  let rules: PolicyRequirement[] = [];
  if (ruleSnapshotJson && ruleSnapshotJson !== '{}') {
    try {
      rules = JSON.parse(ruleSnapshotJson) as PolicyRequirement[];
    } catch {
      // Fall back to the policy version's current rules
      rules = policyVersion.rules;
    }
  } else {
    rules = policyVersion.rules;
  }

  // Get the worker's current certifications (re-evaluate with current state)
  const workerCertifications = await getWorkerCertifications(subjectId, tenantId);

  // Re-evaluate rules against the original policy version's rules
  const resolvedPV: ResolvedPolicyVersion = {
    ...policyVersion,
    rules,
  };

  const ruleEvaluations = evaluateRules(rules, workerCertifications, resolvedPV);
  const replayDecisionResult = determineDecisionResult(ruleEvaluations);
  const replayReasons = generateReasons(ruleEvaluations);
  const replayTimestamp = new Date().toISOString();

  // Generate explainability for the replay
  const replayExplainability = generateExplainabilityPayload(
    replayDecisionResult,
    decisionType as DecisionType,
    {
      decision_type: decisionType,
      subject_type: subjectType,
      subject_id: subjectId,
      site_id: siteId,
      tenant_id: tenantId,
      jurisdiction,
      worker_certifications: workerCertifications,
      policy_version: resolvedPV,
      rule_evaluations: ruleEvaluations,
    },
    replayReasons,
    replayTimestamp
  );

  // Fetch PolicyVersion metadata for the response
  const pvInfo = {
    policy_version_id: policyVersion.policy_version_id,
    version_number: policyVersion.version_number,
    effective_from: policyVersion.effective_from,
    change_summary: '',
  };

  // Try to get change_summary from the PolicyVersions table
  const pvMetadata = await getPolicyVersionMetadata(policyVersionId);
  if (pvMetadata) {
    pvInfo.change_summary = pvMetadata.change_summary;
  }

  const result: ReplayResult = {
    original_decision: {
      decision_id: record['decision_id'] as string,
      decision_result: record['decision_result'] as string,
      reasons: record['reasons'] as string[],
      rules_applied: record['rules_applied'] as string[],
      timestamp: record['timestamp'] as string,
    },
    replay_decision: {
      decision_result: replayDecisionResult,
      reasons: replayReasons,
      rules_applied: ruleEvaluations.map((r) => r.rule_id),
      timestamp: replayTimestamp,
      explainability: replayExplainability.success ? replayExplainability.payload! : null,
    },
    policy_version_used: pvInfo,
    inputs_match: record['decision_result'] === replayDecisionResult,
  };

  return { data: result };
}

// --- Helper Functions ---

/**
 * Resolves a PolicyVersion by its ID.
 */
async function resolvePolicyVersionById(
  policyVersionId: string
): Promise<ResolvedPolicyVersion | null> {
  // Query using GSI1 which indexes by policy_version_id
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('PolicyVersions'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pvId',
      ExpressionAttributeValues: {
        ':pvId': `VERSION#${policyVersionId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const item = result.Items[0] as Record<string, unknown>;
  const rules = (item['rules'] as PolicyRequirement[]) ?? [];

  return {
    policy_version_id: policyVersionId,
    policy_id: (item['policy_id'] as string) ?? '',
    tenant_id: (item['tenant_id'] as string) ?? '',
    version_number: (item['version_number'] as number) ?? 0,
    effective_from: (item['effective_from'] as string) ?? '',
    effective_to: item['effective_to'] as string | undefined,
    rules,
    rule_snapshot_json: (item['rule_snapshot_json'] as string) ?? JSON.stringify(rules),
    jurisdiction: (item['jurisdiction'] as string) ?? '',
  };
}

/**
 * Gets PolicyVersion metadata (change_summary, etc.) from the table.
 */
async function getPolicyVersionMetadata(
  policyVersionId: string
): Promise<{ change_summary: string; version_number: number; effective_from: string } | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('PolicyVersions'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pvId',
      ExpressionAttributeValues: {
        ':pvId': `VERSION#${policyVersionId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const item = result.Items[0] as Record<string, unknown>;
  return {
    change_summary: (item['change_summary'] as string) ?? '',
    version_number: (item['version_number'] as number) ?? 0,
    effective_from: (item['effective_from'] as string) ?? '',
  };
}

/**
 * Retrieves worker certifications from DynamoDB.
 */
async function getWorkerCertifications(
  workerId: string,
  tenantId: string
): Promise<WorkerCertification[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Certifications'),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `WORKER#${workerId}`,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items.map((item) => ({
    certification_id: item['certification_id'] as string,
    certification_type: item['certification_type'] as string,
    status: item['status'] as WorkerCertification['status'],
    expiry_date: item['expiry_date'] as string,
    issue_date: item['issue_date'] as string,
  }));
}
