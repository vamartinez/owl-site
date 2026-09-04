/**
 * Compliance Decision Engine — Core Evaluation Logic.
 *
 * Responsibilities:
 * 1. Validate all required inputs are present
 * 2. Resolve the active PolicyVersion for site+jurisdiction
 * 3. Evaluate worker certifications against policy rules
 * 4. Produce a decision with reasons
 * 5. Generate the explainability payload
 * 6. Store the DecisionRecord (append-only)
 * 7. Publish AccessDecisionGenerated event
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 12.1, 12.3, 12.6
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { EventTypes } from '../../shared/types/events.js';
import { generateExplainabilityPayload } from './explainability.js';
import {
  DecisionResult,
  DecisionType,
} from './types.js';
import type {
  DecisionRequest,
  DecisionResponse,
  ExplainabilityPayload,
  ValidationResult,
  WorkerCertification,
  ResolvedPolicyVersion,
  PolicyRequirement,
  RuleEvaluationResult,
  EvaluationContext,
  DecisionRecord,
} from './types.js';

const MAX_REASONS = 5;
const MAX_REASON_LENGTH = 500;

/**
 * Main evaluation entry point.
 * Orchestrates the full decision pipeline from input validation to event publishing.
 */
export async function evaluateDecision(
  request: DecisionRequest,
  tenantId: string,
  correlationId?: string
): Promise<{ response?: DecisionResponse; error?: { code: string; message: string; missing_inputs?: string[] } }> {
  const timestamp = new Date().toISOString();
  const decisionId = uuidv4();
  const corrId = correlationId ?? uuidv4();

  // Step 1: Validate inputs (Requirement 1.6)
  const validation = validateInputs(request);
  if (!validation.valid) {
    return {
      error: {
        code: 'INCOMPLETE_INPUT',
        message: `Missing required inputs: ${validation.missing_inputs.join(', ')}`,
        missing_inputs: validation.missing_inputs,
      },
    };
  }

  const siteId = request.site_id!;
  const decisionType = request.decision_type as DecisionType;

  // Step 2: Resolve active PolicyVersion (Requirement 1.4, 1.7)
  const policyVersion = await resolveActivePolicyVersion(siteId, tenantId);
  if (!policyVersion) {
    // Requirement 1.7: No active policy → denial
    const denialResponse = buildNoPolicyDenialResponse(
      decisionId,
      decisionType,
      siteId,
      tenantId,
      timestamp,
      corrId
    );

    // Store the denial record
    await storeDecisionRecord(denialResponse, tenantId, request, corrId, '{}');

    // Publish event
    await publishDecisionEvent(denialResponse, tenantId, corrId);

    return { response: denialResponse };
  }

  // Step 3: Get worker certifications
  const workerCertifications = await getWorkerCertifications(
    request.subject_id,
    tenantId
  );

  // Step 4: Evaluate rules against certifications (Requirement 1.3, 1.5)
  const ruleEvaluations = evaluateRules(
    policyVersion.rules,
    workerCertifications,
    policyVersion
  );

  // Build evaluation context
  const context: EvaluationContext = {
    decision_type: request.decision_type,
    subject_type: request.subject_type,
    subject_id: request.subject_id,
    site_id: siteId,
    tenant_id: tenantId,
    jurisdiction: policyVersion.jurisdiction,
    worker_certifications: workerCertifications,
    policy_version: policyVersion,
    rule_evaluations: ruleEvaluations,
    correlation_id: corrId,
  };

  // Determine decision result
  const decisionResult = determineDecisionResult(ruleEvaluations);

  // Generate reasons (Requirement 1.5: max 5, each max 500 chars)
  const reasons = generateReasons(ruleEvaluations);

  // Step 5: Generate explainability payload (Requirement 12.1, 12.6)
  const explainabilityResult = generateExplainabilityPayload(
    decisionResult,
    decisionType,
    context,
    reasons,
    timestamp
  );

  // Requirement 12.6: Block finalization if payload incomplete
  if (!explainabilityResult.success) {
    return {
      error: {
        code: 'EXPLAINABILITY_INCOMPLETE',
        message: `Cannot finalize decision: missing explainability fields: ${explainabilityResult.missing_fields!.join(', ')}`,
      },
    };
  }

  const explainabilityPayload = explainabilityResult.payload!;

  // Build response (Requirement 1.2)
  const response: DecisionResponse = {
    decision_id: decisionId,
    decision: decisionResult,
    decision_type: decisionType,
    reasons,
    rules_applied: ruleEvaluations.map((r) => r.rule_id),
    policy_version_used: policyVersion.policy_version_id,
    jurisdiction: policyVersion.jurisdiction,
    timestamp,
    explainability: explainabilityPayload,
  };

  // Step 6: Store DecisionRecord — append-only (Requirement 2.4)
  await storeDecisionRecord(
    response,
    tenantId,
    request,
    corrId,
    policyVersion.rule_snapshot_json
  );

  // Step 7: Publish AccessDecisionGenerated event
  await publishDecisionEvent(response, tenantId, corrId);

  return { response };
}

/**
 * Validates that all required inputs are present.
 * Requirement 1.6: Return error naming each missing input.
 */
export function validateInputs(request: DecisionRequest): ValidationResult {
  const missingInputs: string[] = [];

  if (!request.subject_id || request.subject_id.trim() === '') {
    missingInputs.push('worker_identity');
  }

  if (!request.site_id || request.site_id.trim() === '') {
    missingInputs.push('site_requirements');
  }

  if (!request.decision_type || request.decision_type.trim() === '') {
    missingInputs.push('decision_type');
  }

  if (!request.context) {
    missingInputs.push('context');
  }

  // Check for jurisdiction in context
  const jurisdiction = request.context?.['jurisdiction'] as string | undefined;
  if (!jurisdiction || jurisdiction.trim() === '') {
    missingInputs.push('jurisdiction');
  }

  // Check for certifications reference in context
  const certifications = request.context?.['certifications'] as unknown[] | undefined;
  if (!certifications && request.subject_type === 'worker') {
    missingInputs.push('certifications');
  }

  return {
    valid: missingInputs.length === 0,
    missing_inputs: missingInputs,
  };
}

/**
 * Resolves the active PolicyVersion for a site and jurisdiction at the current time.
 * Requirement 1.4: Must reference at least one PolicyVersion.
 */
export async function resolveActivePolicyVersion(
  siteId: string,
  tenantId: string
): Promise<ResolvedPolicyVersion | null> {
  const now = new Date().toISOString().split('T')[0]!; // YYYY-MM-DD

  // Query policies for the site
  const policiesResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Policies'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :sitePk',
      ExpressionAttributeValues: {
        ':sitePk': `SITE#${siteId}`,
      },
    })
  );

  if (!policiesResult.Items || policiesResult.Items.length === 0) {
    return null;
  }

  // For each policy, find the active version
  for (const policyItem of policiesResult.Items) {
    const policyId = policyItem['policy_id'] as string;
    const jurisdiction = policyItem['jurisdiction'] as string;

    // Query versions for this policy
    const versionsResult = await docClient.send(
      new QueryCommand({
        TableName: getTableName('PolicyVersions'),
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `POLICY#${policyId}`,
        },
        ScanIndexForward: false,
      })
    );

    if (!versionsResult.Items || versionsResult.Items.length === 0) {
      continue;
    }

    // Find the version that is active at the current date
    for (const versionItem of versionsResult.Items) {
      const isActive = versionItem['is_active'] as boolean;
      const effectiveFrom = versionItem['effective_from'] as string;
      const effectiveTo = versionItem['effective_to'] as string | undefined;

      if (!isActive) continue;
      if (effectiveFrom > now) continue;
      if (effectiveTo && effectiveTo < now) continue;

      // This version is active
      const rules = (versionItem['rules'] as PolicyRequirement[]) ?? [];

      return {
        policy_version_id: versionItem['policy_version_id'] as string,
        policy_id: policyId,
        tenant_id: tenantId,
        version_number: versionItem['version_number'] as number,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        rules,
        rule_snapshot_json: (versionItem['rule_snapshot_json'] as string) ?? JSON.stringify(rules),
        jurisdiction,
      };
    }
  }

  return null;
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

/**
 * Evaluates each policy rule against the worker's certifications.
 * Requirement 1.5: Generate at least one reason per rule applied.
 */
export function evaluateRules(
  rules: PolicyRequirement[],
  certifications: WorkerCertification[],
  policyVersion: ResolvedPolicyVersion
): RuleEvaluationResult[] {
  const results: RuleEvaluationResult[] = [];

  for (const rule of rules) {
    const result = evaluateSingleRule(rule, certifications, policyVersion);
    results.push(result);
  }

  return results;
}

/**
 * Evaluates a single rule against worker certifications.
 */
function evaluateSingleRule(
  rule: PolicyRequirement,
  certifications: WorkerCertification[],
  policyVersion: ResolvedPolicyVersion
): RuleEvaluationResult {
  const requiredCertType = rule.required_certification_type;

  // If the rule requires a specific certification type
  if (requiredCertType) {
    const matchingCert = certifications.find(
      (cert) => cert.certification_type === requiredCertType
    );

    if (!matchingCert) {
      return {
        rule_id: rule.rule_id,
        rule_name: rule.description,
        passed: false,
        reason: truncateReason(
          `Worker does not hold required certification: ${requiredCertType}. ` +
          `Policy rule "${rule.description}" requires this certification for site access.`
        ),
        clause: rule.rule_id,
        source: `PolicyVersion ${policyVersion.policy_version_id}`,
        evidence_type: 'policy_version',
        evidence_reference_id: policyVersion.policy_version_id,
        evidence_description: `Policy version ${policyVersion.version_number} requires ${requiredCertType}`,
      };
    }

    if (matchingCert.status === 'expired') {
      return {
        rule_id: rule.rule_id,
        rule_name: rule.description,
        passed: false,
        reason: truncateReason(
          `Certification "${requiredCertType}" has expired (expired: ${matchingCert.expiry_date}). ` +
          `Policy rule "${rule.description}" requires a valid, non-expired certification.`
        ),
        clause: rule.rule_id,
        source: `PolicyVersion ${policyVersion.policy_version_id}`,
        evidence_type: 'certification',
        evidence_reference_id: matchingCert.certification_id,
        evidence_description: `Expired ${requiredCertType} certification (${matchingCert.expiry_date})`,
      };
    }

    if (matchingCert.status !== 'validated') {
      return {
        rule_id: rule.rule_id,
        rule_name: rule.description,
        passed: false,
        reason: truncateReason(
          `Certification "${requiredCertType}" is not validated (current status: ${matchingCert.status}). ` +
          `Policy rule "${rule.description}" requires a validated certification.`
        ),
        clause: rule.rule_id,
        source: `PolicyVersion ${policyVersion.policy_version_id}`,
        evidence_type: 'certification',
        evidence_reference_id: matchingCert.certification_id,
        evidence_description: `${requiredCertType} certification with status: ${matchingCert.status}`,
      };
    }

    // Certification is valid
    return {
      rule_id: rule.rule_id,
      rule_name: rule.description,
      passed: true,
      reason: truncateReason(
        `Worker holds valid "${requiredCertType}" certification (ID: ${matchingCert.certification_id}). ` +
        `Requirement satisfied for rule "${rule.description}".`
      ),
      clause: rule.rule_id,
      source: `PolicyVersion ${policyVersion.policy_version_id}`,
      evidence_type: 'certification',
      evidence_reference_id: matchingCert.certification_id,
      evidence_description: `Valid ${requiredCertType} certification`,
    };
  }

  // Generic rule evaluation (no specific certification required)
  // Evaluate based on conditions in the rule
  const conditionsMet = evaluateGenericConditions(rule.conditions, certifications);

  return {
    rule_id: rule.rule_id,
    rule_name: rule.description,
    passed: conditionsMet,
    reason: truncateReason(
      conditionsMet
        ? `Rule "${rule.description}" conditions are satisfied.`
        : `Rule "${rule.description}" conditions are not met. Review required.`
    ),
    clause: rule.rule_id,
    source: `PolicyVersion ${policyVersion.policy_version_id}`,
    evidence_type: 'policy_version',
    evidence_reference_id: policyVersion.policy_version_id,
    evidence_description: `Policy version ${policyVersion.version_number} rule evaluation`,
  };
}

/**
 * Evaluates generic rule conditions that don't map to a specific certification type.
 */
function evaluateGenericConditions(
  conditions: Record<string, unknown>,
  certifications: WorkerCertification[]
): boolean {
  // If conditions specify minimum certification count
  const minCerts = conditions['min_certifications'] as number | undefined;
  if (minCerts !== undefined) {
    const validCerts = certifications.filter((c) => c.status === 'validated');
    return validCerts.length >= minCerts;
  }

  // If conditions specify required statuses
  const requiredStatuses = conditions['required_statuses'] as string[] | undefined;
  if (requiredStatuses) {
    return certifications.every(
      (c) => requiredStatuses.includes(c.status)
    );
  }

  // Default: pass if no specific conditions
  return true;
}

/**
 * Determines the overall decision result from rule evaluations.
 * Requirement 1.3: allowed, conditional, denied, manual_review_required.
 */
export function determineDecisionResult(
  evaluations: RuleEvaluationResult[]
): DecisionResult {
  if (evaluations.length === 0) {
    return DecisionResult.MANUAL_REVIEW_REQUIRED;
  }

  const failedRules = evaluations.filter((e) => !e.passed);
  const totalRules = evaluations.length;

  if (failedRules.length === 0) {
    return DecisionResult.ALLOWED;
  }

  // If all rules failed, deny
  if (failedRules.length === totalRules) {
    return DecisionResult.DENIED;
  }

  // If some rules failed but not all, conditional
  // (worker may still access with conditions)
  const failureRatio = failedRules.length / totalRules;
  if (failureRatio > 0.5) {
    return DecisionResult.DENIED;
  }

  return DecisionResult.CONDITIONAL;
}

/**
 * Generates human-readable reasons from rule evaluations.
 * Requirement 1.5: At least one reason per rule, max 5 total, each max 500 chars.
 */
export function generateReasons(evaluations: RuleEvaluationResult[]): string[] {
  // Prioritize failed rules in reasons
  const failedReasons = evaluations
    .filter((e) => !e.passed)
    .map((e) => e.reason);

  const passedReasons = evaluations
    .filter((e) => e.passed)
    .map((e) => e.reason);

  // Combine, prioritizing failures, capped at MAX_REASONS
  const allReasons = [...failedReasons, ...passedReasons];
  return allReasons.slice(0, MAX_REASONS).map(truncateReason);
}

/**
 * Truncates a reason string to the maximum allowed length.
 */
function truncateReason(reason: string): string {
  if (reason.length <= MAX_REASON_LENGTH) {
    return reason;
  }
  return reason.substring(0, MAX_REASON_LENGTH - 3) + '...';
}

/**
 * Builds a denial response when no active PolicyVersion is available.
 * Requirement 1.7.
 */
function buildNoPolicyDenialResponse(
  decisionId: string,
  decisionType: DecisionType,
  siteId: string,
  tenantId: string,
  timestamp: string,
  correlationId: string
): DecisionResponse {
  const reason = 'No active policy version is available for the applicable jurisdiction at evaluation time. Access cannot be granted without an active policy.';

  const explainability: ExplainabilityPayload = {
    decision: DecisionResult.DENIED,
    decision_type: decisionType,
    timestamp,
    reasons: [reason],
    rule_references: [{
      rule_id: 'SYSTEM_NO_POLICY',
      rule_name: 'Active Policy Requirement',
      clause: 'SYSTEM',
      source: 'Compliance Decision Engine',
    }],
    evidence_references: [{
      evidence_type: 'policy_version',
      reference_id: 'NONE',
      description: 'No active policy version found for site and jurisdiction',
    }],
    policy_version_references: [],
    explanation_level: 'audit_grade',
  };

  return {
    decision_id: decisionId,
    decision: DecisionResult.DENIED,
    decision_type: decisionType,
    reasons: [reason],
    rules_applied: ['SYSTEM_NO_POLICY'],
    policy_version_used: 'NONE',
    jurisdiction: 'unknown',
    timestamp,
    explainability,
  };
}

/**
 * Stores a DecisionRecord in DynamoDB.
 * Records are append-only — never updated.
 */
async function storeDecisionRecord(
  response: DecisionResponse,
  tenantId: string,
  request: DecisionRequest,
  correlationId: string,
  ruleSnapshotJson: string
): Promise<void> {
  const record: DecisionRecord = {
    decision_id: response.decision_id,
    tenant_id: tenantId,
    decision_type: response.decision_type,
    subject_type: request.subject_type,
    subject_id: request.subject_id,
    site_id: request.site_id ?? '',
    decision_result: response.decision,
    reasons: response.reasons,
    rules_applied: response.rules_applied,
    policy_version_used: response.policy_version_used,
    jurisdiction: response.jurisdiction,
    rule_snapshot_json: ruleSnapshotJson,
    explainability_payload: JSON.stringify(response.explainability),
    timestamp: response.timestamp,
    correlation_id: correlationId,
    created_at: new Date().toISOString(),
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName('DecisionRecords'),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `DECISION#${response.decision_id}`,
        GSI1PK: `SUBJECT#${request.subject_id}`,
        GSI1SK: `DECISION#${response.timestamp}`,
        GSI2PK: response.policy_version_used !== 'NONE'
          ? `POLICYVERSION#${response.policy_version_used}`
          : 'POLICYVERSION#NONE',
        GSI2SK: `DECISION#${response.decision_id}`,
        ...record,
      },
      // Append-only: use condition to prevent overwrites
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );
}

/**
 * Publishes the AccessDecisionGenerated event.
 */
async function publishDecisionEvent(
  response: DecisionResponse,
  tenantId: string,
  correlationId: string
): Promise<void> {
  try {
    await publishEvent({
      event_type: EventTypes.ACCESS_DECISION_GENERATED,
      source_service: 'decision-engine',
      tenant_id: tenantId,
      correlation_id: correlationId,
      payload: {
        decision_id: response.decision_id,
        worker_id: response.explainability.evidence_references?.[0]?.reference_id ?? '',
        site_id: '',
        decision_result: response.decision,
        policy_version_used: response.policy_version_used,
      },
    });
  } catch (error) {
    // Log but don't fail the decision on event publish failure
    console.error('Failed to publish AccessDecisionGenerated event:', error);
  }
}
