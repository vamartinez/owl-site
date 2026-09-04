/**
 * Unit tests for Decision Replay and History module.
 * Tests explainability visibility filtering by role, decision history,
 * and replay logic.
 *
 * Requirements: 2.5, 2.6, 12.4, 12.7
 */

import { describe, it, expect } from 'vitest';
import { filterExplainabilityByRole } from '../../src/services/decision-engine/replay.js';
import { DecisionResult, DecisionType, Role } from '../../src/shared/types/common.js';
import type { ExplainabilityPayload } from '../../src/shared/types/decisions.js';

// --- Test Helpers ---

function makeExplainabilityPayload(
  overrides: Partial<ExplainabilityPayload> = {}
): ExplainabilityPayload {
  return {
    decision: DecisionResult.ALLOWED,
    decision_type: DecisionType.SITE_ACCESS,
    timestamp: '2024-06-01T10:00:00.000Z',
    reasons: ['Worker holds valid fall protection certification.'],
    rule_references: [
      {
        rule_id: 'rule-001',
        rule_name: 'Fall protection required',
        clause: 'rule-001',
        source: 'PolicyVersion pv-001',
      },
    ],
    evidence_references: [
      {
        evidence_type: 'certification',
        reference_id: 'cert-001',
        description: 'Valid fall_protection certification',
      },
    ],
    policy_version_references: ['pv-001'],
    explanation_level: 'audit_grade',
    ...overrides,
  };
}

// --- Explainability Visibility Filtering Tests ---

describe('replay: filterExplainabilityByRole', () => {
  const fullPayload = makeExplainabilityPayload();

  describe('admin roles see full payload', () => {
    const adminRoles = [
      Role.PLATFORM_ADMIN,
      Role.TENANT_ADMIN,
      Role.SITE_ADMIN,
      Role.CSO,
    ];

    for (const role of adminRoles) {
      it(`${role} sees full explainability payload`, () => {
        const result = filterExplainabilityByRole(fullPayload, role);
        expect(result).toEqual(fullPayload);
      });
    }
  });

  describe('supervisor sees reasons and rule_references only', () => {
    it('includes reasons and rule_references', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.SUPERVISOR);
      expect(result).toBeDefined();
      expect(result!.reasons).toEqual(fullPayload.reasons);
      expect(result!.rule_references).toEqual(fullPayload.rule_references);
      expect(result!.decision).toBe(fullPayload.decision);
      expect(result!.decision_type).toBe(fullPayload.decision_type);
      expect(result!.timestamp).toBe(fullPayload.timestamp);
    });

    it('does not include evidence_references', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.SUPERVISOR);
      expect(result!.evidence_references).toBeUndefined();
    });

    it('does not include policy_version_references', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.SUPERVISOR);
      expect(result!.policy_version_references).toBeUndefined();
    });

    it('does not include explanation_level', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.SUPERVISOR);
      expect(result!.explanation_level).toBeUndefined();
    });
  });

  describe('worker sees reasons only', () => {
    it('includes reasons', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.WORKER);
      expect(result).toBeDefined();
      expect(result!.reasons).toEqual(fullPayload.reasons);
      expect(result!.decision).toBe(fullPayload.decision);
      expect(result!.decision_type).toBe(fullPayload.decision_type);
      expect(result!.timestamp).toBe(fullPayload.timestamp);
    });

    it('does not include rule_references', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.WORKER);
      expect(result!.rule_references).toBeUndefined();
    });

    it('does not include evidence_references', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.WORKER);
      expect(result!.evidence_references).toBeUndefined();
    });

    it('does not include policy_version_references', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.WORKER);
      expect(result!.policy_version_references).toBeUndefined();
    });

    it('does not include explanation_level', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.WORKER);
      expect(result!.explanation_level).toBeUndefined();
    });
  });

  describe('gate_operator sees reasons only (same as worker)', () => {
    it('includes reasons but not rule_references or evidence', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.GATE_OPERATOR);
      expect(result).toBeDefined();
      expect(result!.reasons).toEqual(fullPayload.reasons);
      expect(result!.rule_references).toBeUndefined();
      expect(result!.evidence_references).toBeUndefined();
      expect(result!.policy_version_references).toBeUndefined();
    });
  });

  describe('null payload handling', () => {
    it('returns null when payload is null', () => {
      const result = filterExplainabilityByRole(null, Role.PLATFORM_ADMIN);
      expect(result).toBeNull();
    });

    it('returns null for worker when payload is null', () => {
      const result = filterExplainabilityByRole(null, Role.WORKER);
      expect(result).toBeNull();
    });
  });
});
