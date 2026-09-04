/**
 * TypeScript interfaces for the Compliance Decision Engine.
 */

import { DecisionResult, DecisionType } from './common.js';

export interface DecisionRequest {
  decision_type: DecisionType;
  subject_type: 'worker' | 'inspection' | 'finding';
  subject_id: string;
  site_id?: string;
  context: Record<string, unknown>;
}

export interface RuleReference {
  rule_id: string;
  rule_name: string;
  clause: string;
  source: string;
}

export interface EvidenceReference {
  evidence_type: 'certification' | 'policy_version' | 'media_asset' | 'scan_session';
  reference_id: string;
  description: string;
}

export interface ExplainabilityPayload {
  decision: DecisionResult;
  decision_type: DecisionType;
  timestamp: string;
  reasons: string[];
  rule_references: RuleReference[];
  evidence_references: EvidenceReference[];
  policy_version_references: string[];
  explanation_level: 'audit_grade';
}

export interface EnforcementPayload {
  action_id: string;
  action_type: string;
  target_worker_id: string;
  site_id: string;
  deadline?: string;
}

export interface DecisionResponse {
  decision_id: string;
  decision: DecisionResult;
  decision_type: DecisionType;
  reasons: string[];
  rules_applied: string[];
  policy_version_used: string;
  jurisdiction: string;
  timestamp: string;
  enforcement?: EnforcementPayload;
  explainability: ExplainabilityPayload;
}
