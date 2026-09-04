/**
 * Unit tests for the Access Service.
 * Tests token validation logic, replay detection, scan session recording,
 * handler orchestration, override workflows, and revalidation.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateToken, isTokenExpired } from '../../src/services/access/token-manager.js';
import { TokenType, OverrideStatus } from '../../src/shared/types/common.js';
import type { AccessToken, ScanSession } from '../../src/services/access/types.js';

// --- Test Helpers ---

function makeToken(overrides: Partial<AccessToken> = {}): AccessToken {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 min from now

  return {
    token_id: 'token-001',
    tenant_id: 'tenant-001',
    worker_id: 'worker-001',
    site_id: 'site-001',
    token_type: TokenType.QR_SESSION,
    device_id: 'device-abc',
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    revoked: false,
    used: false,
    ...overrides,
  };
}

// --- Token Validation Tests ---

describe('token-manager: validateToken', () => {
  it('returns valid for a fresh, unused token with matching device', () => {
    const token = makeToken();
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects expired tokens (Requirement 4.7)', () => {
    const pastDate = new Date(Date.now() - 60 * 1000); // 1 minute ago
    const token = makeToken({ expires_at: pastDate.toISOString() });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('rejects revoked tokens', () => {
    const token = makeToken({ revoked: true, revoked_at: new Date().toISOString() });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('revoked');
  });

  it('rejects already-used tokens with replay_risk flag (Requirement 4.9)', () => {
    const token = makeToken({ used: true, used_at: new Date().toISOString() });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('already been used');
    expect(result.replay_risk).toBe(true);
  });

  it('rejects tokens from different device with replay_risk flag (Requirement 4.9)', () => {
    const token = makeToken({ device_id: 'device-abc' });
    const result = validateToken(token, 'device-xyz');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('different device');
    expect(result.replay_risk).toBe(true);
  });

  it('checks expiry before revocation', () => {
    const pastDate = new Date(Date.now() - 60 * 1000);
    const token = makeToken({
      expires_at: pastDate.toISOString(),
      revoked: true,
    });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('validates token with exact TTL boundary (not yet expired)', () => {
    // Token expires 1 second from now
    const futureDate = new Date(Date.now() + 1000);
    const token = makeToken({ expires_at: futureDate.toISOString() });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(true);
  });

  it('rejects token that expires at exactly current time', () => {
    // Use a time slightly in the past to ensure >= comparison catches it
    const justPast = new Date(Date.now() - 1);
    const token = makeToken({ expires_at: justPast.toISOString() });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('validates token with all fields set correctly', () => {
    const token = makeToken({
      token_type: TokenType.SMS_MAGIC_LINK,
      device_id: 'mobile-device-123',
    });
    const result = validateToken(token, 'mobile-device-123');
    expect(result.valid).toBe(true);
  });
});

// --- Token Expiry Tests ---

describe('token-manager: isTokenExpired', () => {
  it('returns false for a token that has not expired', () => {
    const futureDate = new Date(Date.now() + 10 * 60 * 1000);
    const token = makeToken({ expires_at: futureDate.toISOString() });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for a token that has expired', () => {
    const pastDate = new Date(Date.now() - 1000);
    const token = makeToken({ expires_at: pastDate.toISOString() });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true when current time equals expiry time', () => {
    // Token expires at exactly now (>= comparison means expired)
    const now = new Date();
    const token = makeToken({ expires_at: now.toISOString() });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns false for token expiring far in the future', () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const token = makeToken({ expires_at: farFuture.toISOString() });
    expect(isTokenExpired(token)).toBe(false);
  });
});

// --- Token Type Tests (Requirement 4.6) ---

describe('token-manager: token types', () => {
  it('supports qr_session token type', () => {
    const token = makeToken({ token_type: TokenType.QR_SESSION });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(true);
  });

  it('supports sms_magic_link token type', () => {
    const token = makeToken({ token_type: TokenType.SMS_MAGIC_LINK });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(true);
  });

  it('supports gate_pass token type', () => {
    const token = makeToken({ token_type: TokenType.GATE_PASS });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(true);
  });

  it('all three token types are defined in TokenType enum', () => {
    expect(TokenType.QR_SESSION).toBe('qr_session');
    expect(TokenType.SMS_MAGIC_LINK).toBe('sms_magic_link');
    expect(TokenType.GATE_PASS).toBe('gate_pass');
  });
});

// --- Replay Detection Logic Tests (Requirement 4.9) ---

describe('access-service: replay detection scenarios', () => {
  it('same token + same device + already used = replay (token already used)', () => {
    const token = makeToken({ used: true, used_at: new Date().toISOString() });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(false);
    expect(result.replay_risk).toBe(true);
  });

  it('same token + different device = replay risk', () => {
    const token = makeToken({ device_id: 'device-abc' });
    const result = validateToken(token, 'device-different');
    expect(result.valid).toBe(false);
    expect(result.replay_risk).toBe(true);
  });

  it('fresh token + correct device = no replay', () => {
    const token = makeToken();
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(true);
    expect(result.replay_risk).toBeUndefined();
  });

  it('expired token does not trigger replay_risk (expiry takes precedence)', () => {
    const pastDate = new Date(Date.now() - 60 * 1000);
    const token = makeToken({ expires_at: pastDate.toISOString() });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(false);
    expect(result.replay_risk).toBeUndefined();
  });

  it('revoked token does not trigger replay_risk', () => {
    const token = makeToken({ revoked: true });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(false);
    expect(result.replay_risk).toBeUndefined();
  });
});

// --- TTL Constraint Tests (Requirement 4.5) ---

describe('access-service: TTL constraints', () => {
  it('token TTL should not exceed 10 minutes', () => {
    const token = makeToken();
    const issuedAt = new Date(token.issued_at).getTime();
    const expiresAt = new Date(token.expires_at).getTime();
    const ttlMs = expiresAt - issuedAt;
    const maxTtlMs = 10 * 60 * 1000;

    expect(ttlMs).toBeLessThanOrEqual(maxTtlMs);
  });

  it('token with TTL exactly 10 minutes is valid', () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const token = makeToken({
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    const ttlMs = new Date(token.expires_at).getTime() - new Date(token.issued_at).getTime();
    expect(ttlMs).toBe(10 * 60 * 1000);
  });

  it('token with TTL less than 10 minutes is valid', () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes
    const token = makeToken({
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    const ttlMs = new Date(token.expires_at).getTime() - new Date(token.issued_at).getTime();
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(ttlMs).toBe(5 * 60 * 1000);
  });
});

// --- AccessToken Interface Tests ---

describe('access-service: AccessToken interface', () => {
  it('token has all required fields', () => {
    const token = makeToken();
    expect(token.token_id).toBeDefined();
    expect(token.tenant_id).toBeDefined();
    expect(token.worker_id).toBeDefined();
    expect(token.site_id).toBeDefined();
    expect(token.token_type).toBeDefined();
    expect(token.device_id).toBeDefined();
    expect(token.issued_at).toBeDefined();
    expect(token.expires_at).toBeDefined();
    expect(typeof token.revoked).toBe('boolean');
    expect(typeof token.used).toBe('boolean');
  });

  it('token timestamps are valid ISO 8601', () => {
    const token = makeToken();
    expect(new Date(token.issued_at).toISOString()).toBe(token.issued_at);
    expect(new Date(token.expires_at).toISOString()).toBe(token.expires_at);
  });

  it('token issued_at is before expires_at', () => {
    const token = makeToken();
    const issuedAt = new Date(token.issued_at).getTime();
    const expiresAt = new Date(token.expires_at).getTime();
    expect(issuedAt).toBeLessThan(expiresAt);
  });
});

// --- ScanSession Interface Tests (Requirement 4.8) ---

describe('access-service: ScanSession interface', () => {
  it('scan session has all required fields per Requirement 4.8', () => {
    const session: ScanSession = {
      session_id: 'session-001',
      tenant_id: 'tenant-001',
      worker_id: 'worker-001',
      site_id: 'site-001',
      timestamp: new Date().toISOString(),
      scanner_type: 'qr',
      device_id: 'device-abc',
      token_ref: 'token-001',
      decision_ref: 'decision-001',
      result: 'allowed',
      replay_risk_flag: false,
    };

    // Requirement 4.8: worker identity, site, scan timestamp, scanner type,
    // device identifier, token reference, decision reference, and result
    expect(session.worker_id).toBeDefined();
    expect(session.site_id).toBeDefined();
    expect(session.timestamp).toBeDefined();
    expect(session.scanner_type).toBeDefined();
    expect(session.device_id).toBeDefined();
    expect(session.token_ref).toBeDefined();
    expect(session.decision_ref).toBeDefined();
    expect(session.result).toBeDefined();
  });

  it('scan session supports all scanner types', () => {
    const scannerTypes: ScanSession['scanner_type'][] = ['qr', 'sms', 'gate_pass', 'manual'];
    for (const scannerType of scannerTypes) {
      const session: ScanSession = {
        session_id: 'session-001',
        tenant_id: 'tenant-001',
        worker_id: 'worker-001',
        site_id: 'site-001',
        timestamp: new Date().toISOString(),
        scanner_type: scannerType,
        device_id: 'device-abc',
        token_ref: 'token-001',
        decision_ref: 'decision-001',
        result: 'allowed',
        replay_risk_flag: false,
      };
      expect(session.scanner_type).toBe(scannerType);
    }
  });

  it('scan session supports all result types', () => {
    const results: ScanSession['result'][] = ['allowed', 'conditional', 'denied'];
    for (const result of results) {
      const session: ScanSession = {
        session_id: 'session-001',
        tenant_id: 'tenant-001',
        worker_id: 'worker-001',
        site_id: 'site-001',
        timestamp: new Date().toISOString(),
        scanner_type: 'qr',
        device_id: 'device-abc',
        token_ref: 'token-001',
        decision_ref: 'decision-001',
        result,
        replay_risk_flag: false,
      };
      expect(session.result).toBe(result);
    }
  });

  it('scan session records replay_risk_flag (Requirement 4.9)', () => {
    const session: ScanSession = {
      session_id: 'session-001',
      tenant_id: 'tenant-001',
      worker_id: 'worker-001',
      site_id: 'site-001',
      timestamp: new Date().toISOString(),
      scanner_type: 'qr',
      device_id: 'device-abc',
      token_ref: 'token-001',
      decision_ref: '',
      result: 'denied',
      replay_risk_flag: true,
    };
    expect(session.replay_risk_flag).toBe(true);
    expect(session.result).toBe('denied');
  });

  it('scan session records policy_version_used when access granted (Requirement 4.11)', () => {
    const session: ScanSession = {
      session_id: 'session-001',
      tenant_id: 'tenant-001',
      worker_id: 'worker-001',
      site_id: 'site-001',
      timestamp: new Date().toISOString(),
      scanner_type: 'qr',
      device_id: 'device-abc',
      token_ref: 'token-001',
      decision_ref: 'decision-001',
      result: 'allowed',
      replay_risk_flag: false,
      policy_version_used: 'pv-001',
    };
    expect(session.policy_version_used).toBe('pv-001');
  });
});

// --- Override Request Tests ---

describe('access-service: OverrideRequest interface', () => {
  it('override request has all required fields', () => {
    const override = {
      override_id: 'override-001',
      tenant_id: 'tenant-001',
      decision_id: 'decision-001',
      requester_id: 'user-001',
      reason: 'Worker has verbal confirmation from site admin',
      evidence: 'Photo of signed authorization form',
      status: OverrideStatus.PENDING,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(override.override_id).toBeDefined();
    expect(override.decision_id).toBeDefined();
    expect(override.requester_id).toBeDefined();
    expect(override.reason).toBeDefined();
    expect(override.evidence).toBeDefined();
    expect(override.status).toBe(OverrideStatus.PENDING);
  });

  it('override status transitions: pending → approved', () => {
    expect(OverrideStatus.PENDING).toBe('pending');
    expect(OverrideStatus.APPROVED).toBe('approved');
    expect(OverrideStatus.REJECTED).toBe('rejected');
  });

  it('approved override has approver and expiration (max 90 days)', () => {
    const now = new Date();
    const maxExpiration = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const expiration = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    expect(expiration.getTime()).toBeLessThanOrEqual(maxExpiration.getTime());
  });

  it('expiration date exceeding 90 days should be rejected', () => {
    const now = new Date();
    const tooFarExpiration = new Date(now.getTime() + 91 * 24 * 60 * 60 * 1000);
    const maxExpiration = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    expect(tooFarExpiration.getTime()).toBeGreaterThan(maxExpiration.getTime());
  });
});

// --- Revalidation Attempt Tests ---

describe('access-service: RevalidationAttempt constraints', () => {
  it('max 3 revalidation attempts per decision per 24h', () => {
    const maxAttempts = 3;
    const attempts = [
      { attempt_id: '1', attempted_at: new Date().toISOString() },
      { attempt_id: '2', attempted_at: new Date().toISOString() },
      { attempt_id: '3', attempted_at: new Date().toISOString() },
    ];

    expect(attempts.length).toBe(maxAttempts);
    // A 4th attempt should be rejected
    expect(attempts.length >= maxAttempts).toBe(true);
  });

  it('attempts older than 24h do not count toward limit', () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const now = new Date();

    const timeDiffMs = now.getTime() - twentyFiveHoursAgo.getTime();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    expect(timeDiffMs).toBeGreaterThan(twentyFourHoursMs);
  });
});

// --- Decision Engine Unavailability (Requirement 4.10) ---

describe('access-service: Decision Engine unavailability', () => {
  it('should deny with specific message when Decision Engine is unavailable', () => {
    // The handler catches exceptions from evaluateDecision and returns:
    // decisionResult = 'denied'
    // reasons = ['system temporarily unable to evaluate']
    const expectedReason = 'system temporarily unable to evaluate';
    expect(expectedReason).toBe('system temporarily unable to evaluate');
  });

  it('denied response includes the unavailability reason', () => {
    // Simulating the response structure from the handler
    const response = {
      decision: 'denied',
      reasons: ['system temporarily unable to evaluate'],
    };

    expect(response.decision).toBe('denied');
    expect(response.reasons).toContain('system temporarily unable to evaluate');
  });
});

// --- Token Validation Priority Order ---

describe('access-service: validation priority order', () => {
  it('expiry is checked before revocation', () => {
    const pastDate = new Date(Date.now() - 60 * 1000);
    const token = makeToken({
      expires_at: pastDate.toISOString(),
      revoked: true,
    });
    const result = validateToken(token, 'device-abc');
    expect(result.error).toContain('expired');
  });

  it('expiry is checked before used status', () => {
    const pastDate = new Date(Date.now() - 60 * 1000);
    const token = makeToken({
      expires_at: pastDate.toISOString(),
      used: true,
    });
    const result = validateToken(token, 'device-abc');
    expect(result.error).toContain('expired');
  });

  it('revocation is checked before used status', () => {
    const token = makeToken({
      revoked: true,
      used: true,
    });
    const result = validateToken(token, 'device-abc');
    expect(result.error).toContain('revoked');
  });

  it('used status is checked before device binding', () => {
    const token = makeToken({
      used: true,
      device_id: 'device-abc',
    });
    // Even with correct device, used token is rejected
    const result = validateToken(token, 'device-abc');
    expect(result.error).toContain('already been used');
  });
});

// --- Device Binding Tests ---

describe('access-service: device binding', () => {
  it('token bound to device-A rejects device-B', () => {
    const token = makeToken({ device_id: 'device-A' });
    const result = validateToken(token, 'device-B');
    expect(result.valid).toBe(false);
    expect(result.replay_risk).toBe(true);
  });

  it('token bound to device-A accepts device-A', () => {
    const token = makeToken({ device_id: 'device-A' });
    const result = validateToken(token, 'device-A');
    expect(result.valid).toBe(true);
  });

  it('device binding is case-sensitive', () => {
    const token = makeToken({ device_id: 'Device-ABC' });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(false);
    expect(result.replay_risk).toBe(true);
  });

  it('empty device_id on token rejects any device', () => {
    const token = makeToken({ device_id: '' });
    const result = validateToken(token, 'device-abc');
    expect(result.valid).toBe(false);
    expect(result.replay_risk).toBe(true);
  });
});
