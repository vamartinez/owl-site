/**
 * Decision Engine domain types.
 * Re-exports shared types and defines internal interfaces for the evaluation pipeline.
 */

export type {
  DecisionRequest,
  DecisionResponse,
  ExplainabilityPayload,
  RuleReference,
  EvidenceReference,
  EnforcementPayload,
} from '../../shared/types/decisions.js';

export { DecisionResult, DecisionType } from '../../shared/types/common.js';

/**
 * Internal representation of a worker's certification for evaluation.
 */
export interface WorkerCertification {
  certification_id: string;
  certification_type: string;
  status: 'pending' | 'validated' | 'rejected' | 'expired';
  expiry_date: string;
  issue_date: string;
}

/**
 * Internal representation of a policy rule requirement for evaluation.
 */
export interface PolicyRequirement {
  rule_id: string;
  rule_type: string;
  description: string;
  required_certification_type?: string;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
}

/**
 * Resolved policy version used during evaluation.
 */
export interface ResolvedPolicyVersion {
  policy_version_id: string;
  policy_id: string;
  tenant_id: string;
  version_number: number;
  effective_from: string;
  effective_to?: string;
  rules: PolicyRequirement[];
  rule_snapshot_json: string;
  jurisdiction: string;
}

/**
 * Result of input validation.
 */
export interface ValidationResult {
  valid: boolean;
  missing_inputs: string[];
}

/**
 * Result of a single rule evaluation.
 */
export interface RuleEvaluationResult {
  rule_id: string;
  rule_name: string;
  passed: boolean;
  reason: string;
  clause: string;
  source: string;
  evidence_type?: 'certification' | 'policy_version' | 'media_asset' | 'scan_session';
  evidence_reference_id?: string;
  evidence_description?: string;
}

/**
 * Internal evaluation context passed through the pipeline.
 */
export interface EvaluationContext {
  decision_type: string;
  subject_type: string;
  subject_id: string;
  site_id: string;
  tenant_id: string;
  jurisdiction: string;
  worker_certifications: WorkerCertification[];
  policy_version: ResolvedPolicyVersion;
  rule_evaluations: RuleEvaluationResult[];
  correlation_id?: string;
}

/**
 * Decision record stored in DynamoDB (append-only).
 */
export interface DecisionRecord {
  decision_id: string;
  tenant_id: string;
  decision_type: string;
  subject_type: string;
  subject_id: string;
  site_id: string;
  decision_result: string;
  reasons: string[];
  rules_applied: string[];
  policy_version_used: string;
  jurisdiction: string;
  rule_snapshot_json: string;
  explainability_payload: string; // JSON-serialized ExplainabilityPayload
  timestamp: string;
  correlation_id: string;
  created_at: string;
}
