/**
 * Self check-in domain types — mirror the backend public contract.
 *
 * The public surface exposes ONLY the worker-scoped decision fields
 * (decision / reasons / required_actions) — never rule, evidence, or policy
 * references (backend Requirement 6.2, 6.6).
 */

/** Successful resolution of GET /public/check-in/{token}. */
export interface CheckinTokenResolved {
  site_name: string;
  requires_identity: boolean;
}

/** Uniform "invalid token" response — indistinguishable across failure modes. */
export interface CheckinTokenInvalid {
  valid: false;
  message: string;
}

export type ResolveTokenResult = CheckinTokenResolved | CheckinTokenInvalid;

export function isTokenInvalid(r: ResolveTokenResult): r is CheckinTokenInvalid {
  return (r as CheckinTokenInvalid).valid === false;
}

/** Worker-facing decision — the ONLY decision fields the public client sees. */
export interface WorkerView {
  decision: 'allowed' | 'conditional' | 'denied';
  reasons: string[];
  required_actions: string[];
}

/** Success shape of POST /public/check-in/{token}/verify. */
export type CheckinVerifiedResult = { verified: true } & WorkerView;

/** Uniform failure shape of the verify endpoint (invalid token OR bad identity). */
export interface CheckinVerifyFailed {
  verified: false;
  message: string;
}

export type VerifyResult = CheckinVerifiedResult | CheckinVerifyFailed;

export function isVerified(r: VerifyResult): r is CheckinVerifiedResult {
  return r.verified === true;
}

/** Body sent to the verify endpoint (QR flow includes the identity challenge). */
export interface VerifyRequest {
  phone_last4?: string;
  legal_name?: string;
  page_load_ts: number;
  /** Honeypot field — must stay empty for real users. */
  hp?: string;
}
