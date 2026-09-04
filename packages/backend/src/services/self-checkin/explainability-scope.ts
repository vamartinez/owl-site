/**
 * Server-side role-scoped explainability filter.
 *
 * Per docs/ROLES.md, a worker sees ONLY "reasons and required actions". The full
 * audit-grade ExplainabilityPayload (rule references, evidence references, policy
 * versions, decision id, rules_applied, explanation level) is NEVER transmitted
 * to the public client — it is stripped here, in the Lambda, before serialization
 * so it cannot be recovered from the network response.
 *
 * Requirements: 6.1, 6.2, 6.6
 */

import type { DecisionResponse } from '../../shared/types/decisions.js';
import { DecisionResult } from '../../shared/types/common.js';
import type { WorkerView } from './types.js';

/** Map the engine's DecisionResult enum to the public worker-view string. */
function toDecisionString(d: DecisionResult): WorkerView['decision'] {
  switch (d) {
    case DecisionResult.ALLOWED:
      return 'allowed';
    case DecisionResult.CONDITIONAL:
      return 'conditional';
    case DecisionResult.DENIED:
    default:
      return 'denied';
  }
}

/**
 * Derive worker-facing required actions from decision reasons.
 *
 * `allowed` decisions have no required actions. For `conditional`/`denied`, each
 * reason is turned into an imperative action (mirroring how access-service
 * extracts missing-certification follow-ups from reasons). Reasons that already
 * read as an action are passed through; certification-shaped reasons get a
 * "Renew/obtain" prefix.
 */
export function deriveRequiredActions(
  decision: WorkerView['decision'],
  reasons: string[]
): string[] {
  if (decision === 'allowed') return [];

  return reasons.map((reason) => {
    const lower = reason.toLowerCase();
    if (lower.includes('expired') || lower.includes('missing') || lower.includes('not valid')) {
      // Certification / requirement gap → concrete renewal action.
      return `Resolve: ${reason}`;
    }
    return reason;
  });
}

/**
 * Reduce a full DecisionResponse to the worker-scoped view. Returns ONLY
 * `decision`, `reasons`, and `required_actions`. All audit-grade fields are
 * dropped by construction (they are never read here).
 */
export function toWorkerView(response: DecisionResponse): WorkerView {
  const decision = toDecisionString(response.decision);
  const reasons = Array.isArray(response.reasons) ? [...response.reasons] : [];
  return {
    decision,
    reasons,
    required_actions: deriveRequiredActions(decision, reasons),
  };
}

/**
 * Build the deny-on-unavailable worker view used when the decision engine
 * errors or is unavailable (never allow-by-default).
 */
export function denyOnUnavailableView(reason: string): WorkerView {
  return {
    decision: 'denied',
    reasons: [reason],
    required_actions: [reason],
  };
}
