/**
 * Decision-engine integration + scan-session recording for self check-in.
 *
 * Reuses the existing `evaluateDecision` and `recordScanSession` exactly the way
 * access-service does. On an engine error or a thrown exception the check-in is
 * DENIED (never allow-by-default). Every attempt records a ScanSession (with an
 * additive `origin_channel`) and returns the worker-scoped view.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { evaluateDecision } from '../decision-engine/evaluator.js';
import { DecisionType } from '../decision-engine/types.js';
import { recordScanSession } from '../access/scan-session.js';
import { createLogger } from '../../shared/logger.js';
import { toWorkerView, denyOnUnavailableView } from './explainability-scope.js';
import type { WorkerView, CheckinOrigin } from './types.js';

const logger = createLogger('self-checkin-decision');

const ENGINE_UNAVAILABLE_REASON = 'system temporarily unable to evaluate';

export interface CheckinDecisionInput {
  tenantId: string;
  workerId: string;
  siteId: string;
  tokenId: string; // CheckinTokens.token_id
  origin: CheckinOrigin; // self_qr | self_sms
  correlationId?: string;
}

export interface CheckinDecisionOutput {
  view: WorkerView;
  decisionId: string;
}

/**
 * Evaluate site access for an identified worker and record the scan session.
 * Always returns a worker-scoped view; scan session + audit are the caller's
 * responsibility to persist alongside (audit logged by the handler).
 */
export async function evaluateCheckin(
  input: CheckinDecisionInput
): Promise<CheckinDecisionOutput> {
  const { tenantId, workerId, siteId, tokenId, origin, correlationId } = input;

  let view: WorkerView;
  let decisionId = '';
  let result: 'allowed' | 'conditional' | 'denied' = 'denied';

  try {
    const evalResult = await evaluateDecision(
      {
        decision_type: DecisionType.SITE_ACCESS,
        subject_type: 'worker',
        subject_id: workerId,
        site_id: siteId,
        context: { jurisdiction: 'BC', certifications: [] },
      },
      tenantId,
      correlationId
    );

    if (evalResult.error || !evalResult.response) {
      // Engine returned a structured error (e.g. incomplete input) → deny.
      const reason = evalResult.error?.message ?? ENGINE_UNAVAILABLE_REASON;
      view = denyOnUnavailableView(reason);
    } else {
      view = toWorkerView(evalResult.response);
      decisionId = evalResult.response.decision_id;
      result = view.decision;
    }
  } catch (err) {
    // Engine unavailable / threw → deny-on-unavailable, never allow-by-default.
    logger.error('Decision engine unavailable during self check-in', {
      worker_id: workerId,
      site_id: siteId,
      error: err instanceof Error ? err.message : String(err),
    });
    view = denyOnUnavailableView(ENGINE_UNAVAILABLE_REASON);
  }

  result = view.decision;

  // Record a scan session for EVERY attempt (Requirement 5.5). Additive
  // origin_channel distinguishes self-service from staff-terminal check-ins.
  try {
    await recordScanSession({
      tenant_id: tenantId,
      worker_id: workerId,
      site_id: siteId,
      timestamp: new Date().toISOString(),
      scanner_type: origin === 'self_sms' ? 'sms' : 'qr',
      device_id: 'self-service',
      token_ref: tokenId,
      decision_ref: decisionId,
      result,
      replay_risk_flag: false,
      // additive attribute — persisted alongside the standard ScanSession fields
      origin_channel: origin,
    } as Parameters<typeof recordScanSession>[0] & { origin_channel: CheckinOrigin });
  } catch (err) {
    logger.error('Failed to record scan session for self check-in', {
      worker_id: workerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { view, decisionId };
}
