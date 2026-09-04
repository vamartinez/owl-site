/**
 * Property: explainability non-leakage.
 *
 * For any DecisionResponse, toWorkerView never emits a rule reference, evidence
 * reference, policy version, decision id, rules_applied, or explanation level.
 * The worker view carries ONLY decision, reasons, required_actions.
 *
 * Validates: Requirements 6.2, 6.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toWorkerView } from '../../src/services/self-checkin/explainability-scope.js';
import { DecisionResult, DecisionType } from '../../src/shared/types/common.js';
import type { DecisionResponse } from '../../src/shared/types/decisions.js';

const arbDecision = fc.constantFrom(
  DecisionResult.ALLOWED,
  DecisionResult.CONDITIONAL,
  DecisionResult.DENIED,
  DecisionResult.MANUAL_REVIEW_REQUIRED
);

const arbResponse: fc.Arbitrary<DecisionResponse> = fc.record({
  decision_id: fc.uuid(),
  decision: arbDecision,
  decision_type: fc.constant(DecisionType.SITE_ACCESS),
  reasons: fc.array(fc.string(), { maxLength: 6 }),
  rules_applied: fc.array(fc.string(), { maxLength: 6 }),
  policy_version_used: fc.string(),
  jurisdiction: fc.constant('BC'),
  timestamp: fc.constant('2026-01-01T00:00:00.000Z'),
  explainability: fc.record({
    decision: arbDecision,
    decision_type: fc.constant(DecisionType.SITE_ACCESS),
    timestamp: fc.constant('2026-01-01T00:00:00.000Z'),
    reasons: fc.array(fc.string(), { maxLength: 6 }),
    rule_references: fc.array(
      fc.record({ rule_id: fc.string(), rule_name: fc.string(), clause: fc.string(), source: fc.string() }),
      { maxLength: 4 }
    ),
    evidence_references: fc.array(
      fc.record({
        evidence_type: fc.constant('certification' as const),
        reference_id: fc.string(),
        description: fc.string(),
      }),
      { maxLength: 4 }
    ),
    policy_version_references: fc.array(fc.string(), { maxLength: 4 }),
    explanation_level: fc.constant('audit_grade' as const),
  }),
});

describe('Property: explainability non-leakage', () => {
  it('worker view exposes only decision, reasons, required_actions', () => {
    fc.assert(
      fc.property(arbResponse, (response) => {
        const view = toWorkerView(response);
        const keys = Object.keys(view).sort();
        expect(keys).toEqual(['decision', 'reasons', 'required_actions']);
      }),
      { numRuns: 100 }
    );
  });

  it('serialized worker view never contains audit-grade field names', () => {
    fc.assert(
      fc.property(arbResponse, (response) => {
        const serialized = JSON.stringify(toWorkerView(response));
        for (const forbidden of [
          'rule_references',
          'evidence_references',
          'policy_version',
          'policy_version_used',
          'policy_version_references',
          'decision_id',
          'rules_applied',
          'explanation_level',
          'explainability',
        ]) {
          expect(serialized).not.toContain(forbidden);
        }
      }),
      { numRuns: 100 }
    );
  });
});
