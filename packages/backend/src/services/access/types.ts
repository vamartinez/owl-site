/**
 * Access Service domain types.
 * Defines AccessToken, ScanSession, OverrideRequest, and RevalidationAttempt interfaces.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11
 */

import { TokenType, OverrideStatus } from '../../shared/types/common.js';

/**
 * AccessToken — short-lived credential for access validation.
 * TTL max 10 minutes. Supports qr_session, sms_magic_link, gate_pass.
 */
export interface AccessToken {
  token_id: string;
  tenant_id: string;
  worker_id: string;
  site_id: string;
  token_type: TokenType;
  device_id: string;
  issued_at: string; // ISO 8601 UTC
  expires_at: string; // ISO 8601 UTC
  revoked: boolean;
  revoked_at?: string; // ISO 8601 UTC
  used: boolean;
  used_at?: string; // ISO 8601 UTC
}

/**
 * ScanSession — record of each scan attempt at a site gate.
 */
export interface ScanSession {
  session_id: string;
  tenant_id: string;
  worker_id: string;
  site_id: string;
  timestamp: string; // ISO 8601 UTC
  scanner_type: 'qr' | 'sms' | 'gate_pass' | 'manual';
  device_id: string;
  token_ref: string;
  decision_ref: string;
  result: 'allowed' | 'conditional' | 'denied';
  replay_risk_flag: boolean;
  policy_version_used?: string;
}

/**
 * OverrideRequest — documented exception to a compliance decision.
 */
export interface OverrideRequest {
  override_id: string;
  tenant_id: string;
  decision_id: string;
  requester_id: string;
  reason: string;
  evidence: string;
  status: OverrideStatus;
  approver_id?: string;
  approved_at?: string; // ISO 8601 UTC
  expiration_date?: string; // ISO 8601 date
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
}

/**
 * RevalidationAttempt — new validation attempt after a denied decision.
 * Max 3 per original decision per 24h.
 */
export interface RevalidationAttempt {
  attempt_id: string;
  tenant_id: string;
  original_decision_id: string;
  worker_id: string;
  site_id: string;
  new_decision_id: string;
  new_result: string;
  attempted_at: string; // ISO 8601 UTC
}

/**
 * Input for requesting access (QR scan or SMS link).
 */
export interface AccessRequestInput {
  worker_id: string;
  site_id: string;
  token_type: TokenType;
  device_id: string;
  qr_payload?: string; // Decoded QR content
}

/**
 * Input for recording a scan session.
 */
export interface ScanInput {
  token_id: string;
  device_id: string;
  scanner_type: 'qr' | 'sms' | 'gate_pass' | 'manual';
}

/**
 * Input for creating an override request.
 */
export interface OverrideRequestInput {
  decision_id: string;
  reason: string;
  evidence: string;
}

/**
 * Input for approving/rejecting an override.
 */
export interface OverrideUpdateInput {
  status: 'approved' | 'rejected';
  expiration_date?: string; // Required if approved, max 90 days from now
}

/**
 * Input for revalidation attempt.
 */
export interface RevalidationInput {
  original_decision_id: string;
  worker_id: string;
  site_id: string;
}
