/**
 * Findings Service domain types.
 * Defines Finding, FindingReview, and related interfaces.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import { FindingStatus, Severity, EnforcementActionType } from '../../shared/types/common.js';

/**
 * Finding — an AI-generated observation from visual evidence.
 */
export interface Finding {
  finding_id: string;
  tenant_id: string;
  site_id: string;
  inspection_id: string;
  media_asset_id?: string;
  status: FindingStatus;
  severity: Severity;
  detection_type: string;
  violation_flag: boolean;
  regulatory_basis?: string;
  site_policy_basis?: string;
  suggested_corrective_action?: string;
  policy_version_id?: string;
  jurisdiction_id?: string;
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
  reviewed_at?: string; // ISO 8601 UTC
  reviewer_id?: string;
  dismissal_reason?: string;
  enforcement_action_id?: string;
}

/**
 * Review action types.
 */
export type ReviewAction = 'confirm' | 'dismiss';

/**
 * Input for reviewing a finding.
 */
export interface ReviewFindingInput {
  action: ReviewAction;
  reason?: string; // Required for dismiss (≥ 10 chars)
}

/**
 * Enforcement action record created on confirmation of high/critical findings.
 */
export interface EnforcementAction {
  enforcement_action_id: string;
  tenant_id: string;
  site_id: string;
  finding_id: string;
  action_type: EnforcementActionType;
  status: 'pending' | 'in_progress' | 'resolved' | 'escalated';
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
  assigned_to?: string;
  decision_record_id?: string;
}

/**
 * Minimum length for dismissal reason.
 * Requirement 9.5: reason ≥ 10 chars.
 */
export const MIN_DISMISSAL_REASON_LENGTH = 10;

/**
 * Maximum time (ms) to create enforcement action after confirmation.
 * Requirement 9.7: within 60 seconds.
 */
export const MAX_ENFORCEMENT_CREATION_TIME_MS = 60_000;

/**
 * Statuses that are considered "unreviewed" and cannot trigger enforcement.
 * Requirement 9.6.
 */
export const UNREVIEWED_STATUSES: FindingStatus[] = [
  FindingStatus.GENERATED,
  FindingStatus.PENDING_REVIEW,
];

/**
 * Severities that require pending_review initial status.
 * Requirement 9.2.
 */
export const HIGH_SEVERITY_LEVELS: Severity[] = [Severity.CRITICAL, Severity.HIGH];

/**
 * Severities that get initial status of generated.
 * Requirement 9.3.
 */
export const LOW_SEVERITY_LEVELS: Severity[] = [Severity.MEDIUM, Severity.LOW];
