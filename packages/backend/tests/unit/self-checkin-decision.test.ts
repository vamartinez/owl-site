/**
 * Self Check-In decision-integration tests.
 *
 * Task 6.4: QR flow records origin_channel=self_qr, SMS flow self_sms, with
 *   token_ref and decision_ref populated.
 * Task 6.5 (property): for any engine error or thrown exception, the result is
 *   denied and a scan session is still recorded.
 *
 * Requirements: 5.4, 5.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { DecisionResult, DecisionType } from '../../src/shared/types/common.js';

const mockEvaluate = vi.fn();
const mockRecordScan = vi.fn();

vi.mock('../../src/services/decision-engine/evaluator.js', () => ({
  evaluateDecision: (...args: unknown[]) => mockEvaluate(...args),
}));
vi.mock('../../src/services/access/scan-session.js', () => ({
  recordScanSession: (...args: unknown[]) => mockRecordScan(...args),
}));

import { evaluateCheckin } from '../../src/services/self-checkin/decision-integration.js';

beforeEach(() => {
  mockEvaluate.mockReset();
  mockRecordScan.mockReset();
  mockRecordScan.mockResolvedValue({});
});

function okResponse(decision = DecisionResult.ALLOWED) {
  return {
    response: {
      decision_id: 'dec-1',
      decision,
      decision_type: DecisionType.SITE_ACCESS,
      reasons: [],
      rules_applied: [],
      policy_version_used: 'pv-1',
      jurisdiction: 'BC',
      timestamp: '2026-01-01T00:00:00.000Z',
      explainability: {
        decision,
        decision_type: DecisionType.SITE_ACCESS,
        timestamp: '2026-01-01T00:00:00.000Z',
        reasons: [],
        rule_references: [{ rule_id: 'r1', rule_name: 'n', clause: 'c', source: 's' }],
        evidence_references: [],
        policy_version_references: ['pv-1'],
        explanation_level: 'audit_grade' as const,
      },
    },
  };
}

describe('evaluateCheckin scan-session recording', () => {
  it('QR flow records origin_channel=self_qr with token_ref and decision_ref', async () => {
    mockEvaluate.mockResolvedValueOnce(okResponse());
    const out = await evaluateCheckin({
      tenantId: 'tenant-1', workerId: 'w-1', siteId: 'site-1', tokenId: 'tid-1', origin: 'self_qr',
    });
    expect(out.view.decision).toBe('allowed');
    expect(mockRecordScan).toHaveBeenCalledTimes(1);
    const session = mockRecordScan.mock.calls[0][0];
    expect(session.origin_channel).toBe('self_qr');
    expect(session.scanner_type).toBe('qr');
    expect(session.token_ref).toBe('tid-1');
    expect(session.decision_ref).toBe('dec-1');
  });

  it('SMS flow records origin_channel=self_sms with scanner_type sms', async () => {
    mockEvaluate.mockResolvedValueOnce(okResponse(DecisionResult.CONDITIONAL));
    await evaluateCheckin({
      tenantId: 'tenant-1', workerId: 'w-1', siteId: 'site-1', tokenId: 'tid-2', origin: 'self_sms',
    });
    const session = mockRecordScan.mock.calls[0][0];
    expect(session.origin_channel).toBe('self_sms');
    expect(session.scanner_type).toBe('sms');
  });
});

describe('Property: deny-on-unavailable', () => {
  it('any engine error or throw yields denied and still records a scan session', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant({ mode: 'error' as const }),
          fc.constant({ mode: 'throw' as const }),
          fc.constant({ mode: 'no-response' as const })
        ),
        async (scenario) => {
          mockEvaluate.mockReset();
          mockRecordScan.mockReset();
          mockRecordScan.mockResolvedValue({});

          if (scenario.mode === 'error') {
            mockEvaluate.mockResolvedValueOnce({ error: { code: 'INCOMPLETE_INPUT', message: 'missing' } });
          } else if (scenario.mode === 'throw') {
            mockEvaluate.mockRejectedValueOnce(new Error('engine down'));
          } else {
            mockEvaluate.mockResolvedValueOnce({});
          }

          const out = await evaluateCheckin({
            tenantId: 'tenant-1', workerId: 'w-1', siteId: 'site-1', tokenId: 'tid-1', origin: 'self_qr',
          });

          expect(out.view.decision).toBe('denied');
          expect(mockRecordScan).toHaveBeenCalledTimes(1);
          expect(mockRecordScan.mock.calls[0][0].result).toBe('denied');
        }
      ),
      { numRuns: 100 }
    );
  });
});
