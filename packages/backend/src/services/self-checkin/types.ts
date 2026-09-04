/**
 * Self Check-In Service domain types.
 *
 * The worker-facing self-service check-in surface: a worker scans a persistent
 * gate QR code (site_persistent token) or opens a one-time SMS magic link
 * (sms_magic_link token), proves identity without a Cognito session, and gets a
 * role-scoped access decision.
 *
 * Requirements: 1.1, 3.6, 5.5
 */

/** Kind of check-in token. */
export type CheckinTokenKind = 'site_persistent' | 'sms_magic_link';

/** Lifecycle status of a check-in token. */
export type CheckinTokenStatus = 'active' | 'invalidated' | 'consumed';

/** Origin channel recorded on the scan session / audit entry. */
export type CheckinOrigin = 'self_qr' | 'self_sms';

/**
 * A check-in token stored in the CheckinTokens table. Site tokens are
 * persistent (no worker_id, no expiry); SMS tokens are single-use, bound to a
 * worker, and expire.
 */
export interface CheckinToken {
  token_id: string; // internal UUID v4
  token: string; // public UUID v4 (encoded in QR / SMS link)
  token_kind: CheckinTokenKind;
  tenant_id: string;
  site_id: string;
  worker_id?: string; // SMS tokens only
  status: CheckinTokenStatus;
  created_by: string; // Cognito user id of the admin who created it
  created_at: string; // ISO 8601 UTC
  expires_at?: string; // ISO 8601 UTC (SMS tokens only)
  consumed_at?: string; // ISO 8601 UTC (SMS tokens, on single-use consumption)
  ttl?: number; // epoch seconds (SMS tokens only; auto-cleanup)
}

/**
 * The worker-scoped view of a decision — the ONLY decision fields ever sent to
 * the public client. Rule/evidence references, policy versions, decision id and
 * rules_applied are deliberately absent (Requirement 6.2, 6.6).
 */
export interface WorkerView {
  decision: 'allowed' | 'conditional' | 'denied';
  reasons: string[];
  required_actions: string[];
}

/** Action kinds recorded in the immutable SelfCheckinAuditLog. */
export type CheckinAuditAction =
  | 'token_resolved'
  | 'identity_verified'
  | 'identity_failed'
  | 'decision_returned'
  | 'rate_limited'
  | 'bot_rejected'
  | 'sms_link_sent'
  | 'sms_link_failed';

/** Outcome recorded on an audit entry. */
export type CheckinAuditOutcome = 'allowed' | 'conditional' | 'denied' | 'rejected';

/**
 * An immutable audit entry written for every check-in attempt (allowed, denied,
 * or rejected). Requirement 7.6.
 */
export interface SelfCheckinAuditEntry {
  action: CheckinAuditAction;
  origin_channel: CheckinOrigin;
  token_ref: string; // CheckinTokens.token_id
  outcome: CheckinAuditOutcome;
  ip_address: string;
  timestamp: string; // ISO 8601 UTC
  tenant_id: string;
  site_id: string;
}

/** DynamoDB table logical names (resolved via getTableName). */
export const CHECKIN_TOKENS_TABLE = 'CheckinTokens';
export const SELF_CHECKIN_AUDIT_TABLE = 'SelfCheckinAuditLog';

/** SMS magic-link token time-to-live: 2 hours. */
export const SMS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/** Audit log retention: 365 days. */
export const AUDIT_TTL_SECONDS = 365 * 24 * 60 * 60;
