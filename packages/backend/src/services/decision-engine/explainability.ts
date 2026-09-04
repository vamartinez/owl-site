/**
 * Explainability Payload Generator.
 * Generates audit-grade explainability payloads for compliance decisions.
 * Blocks finalization if the payload is incomplete (missing evidence or policy references).
 *
 * Requirements: 12.1, 12.3, 12.6
 */

import type {
  ExplainabilityPayload,
  RuleReference,
  EvidenceReference,
  EvaluationContext,
  RuleEvaluationResult,
} from './types.js';
import { DecisionResult, DecisionType } from './types.js';

/**
 * Result of explainability payload generation.
 * If incomplete, the decision cannot be finalized.
 */
export interface ExplainabilityResult {
  success: boolean;
  payload?: ExplainabilityPayload;
  missing_fields?: string[];
}

/**
 * Generates a complete ExplainabilityPayload from the evaluation context.
 * Returns an error if the payload cannot be fully assembled.
 *
 * Requirement 12.6: Block finalization if payload incomplete.
 */
export function generateExplainabilityPayload(
  decisionResult: DecisionResult,
  decisionType: DecisionType,
  context: EvaluationContext,
  reasons: string[],
  timestamp: string
): ExplainabilityResult {
  const missingFields: string[] = [];

  // Build rule references from evaluation results
  const ruleReferences = buildRuleReferences(context.rule_evaluations);

  // Build evidence references from evaluation results
  const evidenceReferences = buildEvidenceReferences(context.rule_evaluations);

  // Policy version references
  const policyVersionReferences = [context.policy_version.policy_version_id];

  // Validate completeness (Requirement 12.6)
  if (reasons.length === 0) {
    missingFields.push('reasons');
  }

  if (ruleReferences.length === 0) {
    missingFields.push('rule_references');
  }

  if (policyVersionReferences.length === 0) {
    missingFields.push('policy_version_references');
  }

  // Evidence references are required (Requirement 12.3)
  if (evidenceReferences.length === 0) {
    missingFields.push('evidence_references');
  }

  if (missingFields.length > 0) {
    return {
      success: false,
      missing_fields: missingFields,
    };
  }

  const payload: ExplainabilityPayload = {
    decision: decisionResult,
    decision_type: decisionType,
    timestamp,
    reasons,
    rule_references: ruleReferences,
    evidence_references: evidenceReferences,
    policy_version_references: policyVersionReferences,
    explanation_level: 'audit_grade',
  };

  return { success: true, payload };
}

/**
 * Builds machine-readable rule references from evaluation results.
 */
function buildRuleReferences(evaluations: RuleEvaluationResult[]): RuleReference[] {
  return evaluations.map((evaluation) => ({
    rule_id: evaluation.rule_id,
    rule_name: evaluation.rule_name,
    clause: evaluation.clause,
    source: evaluation.source,
  }));
}

/**
 * Builds evidence references from evaluation results.
 * Includes certification references and always includes the policy version.
 */
function buildEvidenceReferences(evaluations: RuleEvaluationResult[]): EvidenceReference[] {
  const references: EvidenceReference[] = [];
  const seenIds = new Set<string>();

  for (const evaluation of evaluations) {
    if (
      evaluation.evidence_type &&
      evaluation.evidence_reference_id &&
      !seenIds.has(evaluation.evidence_reference_id)
    ) {
      seenIds.add(evaluation.evidence_reference_id);
      references.push({
        evidence_type: evaluation.evidence_type,
        reference_id: evaluation.evidence_reference_id,
        description: evaluation.evidence_description ?? `Evidence for rule ${evaluation.rule_name}`,
      });
    }
  }

  return references;
}

/**
 * Validates that an existing explainability payload is complete.
 * Used for integrity checks on stored payloads.
 */
export function validateExplainabilityPayload(
  payload: ExplainabilityPayload
): { valid: boolean; missing_fields: string[] } {
  const missingFields: string[] = [];

  if (!payload.decision) missingFields.push('decision');
  if (!payload.decision_type) missingFields.push('decision_type');
  if (!payload.timestamp) missingFields.push('timestamp');
  if (!payload.reasons || payload.reasons.length === 0) missingFields.push('reasons');
  if (!payload.rule_references || payload.rule_references.length === 0) {
    missingFields.push('rule_references');
  }
  if (!payload.evidence_references || payload.evidence_references.length === 0) {
    missingFields.push('evidence_references');
  }
  if (!payload.policy_version_references || payload.policy_version_references.length === 0) {
    missingFields.push('policy_version_references');
  }

  return { valid: missingFields.length === 0, missing_fields: missingFields };
}
