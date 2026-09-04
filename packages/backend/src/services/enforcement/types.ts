/**
 * Enforcement Service domain types.
 * Defines EnforcementAction, escalation sequences, and related interfaces.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
 */

import { EnforcementActionType } from '../../shared/types/common.js';

/**
 * Status of an enforcement action.
 */
export enum EnforcementActionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  ESCALATED = 'escalated',
  EXPIRED = 'expired',
}

/**
 * EnforcementAction — operational action resulting from a compliance decision.
 * Linked to a DecisionRecord and created within 5 seconds of the decision.
 */
export interface EnforcementAction {
  action_id: string;
  tenant_id: string;
  decision_id: string;
  action_type: EnforcementActionType;
  status: EnforcementActionStatus;
  worker_id: string;
  site_id: string;
  assigned_to?: string;
  reason: string;
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
  resolved_at?: string; // ISO 8601 UTC
  escalated_from?: string; // action_id of the original action before escalation
  escalation_level: number; // 0 = initial, increments on each escalation
  deadline?: string; // ISO 8601 UTC — when auto-escalation triggers
}

/**
 * Input for creating an enforcement action.
 */
export interface CreateEnforcementActionInput {
  tenant_id: string;
  decision_id: string;
  decision_result: string;
  worker_id: string;
  site_id: string;
  reasons: string[];
  correlation_id?: string;
}

/**
 * Escalation sequence for enforcement actions.
 * Requirement 10.8: If deny_entry or require_manual_review_at_gate unresolved > 30 min,
 * escalate to next action type.
 */
export const ESCALATION_SEQUENCE: EnforcementActionType[] = [
  EnforcementActionType.DENY_ENTRY,
  EnforcementActionType.REQUIRE_MANUAL_REVIEW_AT_GATE,
  EnforcementActionType.NOTIFY_SUPERVISOR,
  EnforcementActionType.ESCALATE_TO_CSO,
];

/**
 * Maps decision results to initial enforcement action types.
 */
export const DECISION_TO_ACTION_TYPE: Record<string, EnforcementActionType> = {
  denied: EnforcementActionType.DENY_ENTRY,
  conditional: EnforcementActionType.REQUIRE_MANUAL_REVIEW_AT_GATE,
};

/**
 * Auto-escalation timeout in milliseconds (30 minutes).
 * Requirement 10.8.
 */
export const ESCALATION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Maximum revalidation attempts per original decision per 24 hours.
 * Requirement 10.4.
 */
export const MAX_REVALIDATION_ATTEMPTS = 3;

/**
 * Maximum override expiration in days.
 * Requirement 10.6.
 */
export const MAX_OVERRIDE_EXPIRATION_DAYS = 90;
