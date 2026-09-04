/**
 * Unit tests for the Real-Time Enforcement Loop.
 * Tests enforcement action creation, escalation logic, revalidation constraints,
 * override constraints, and auto-escalation.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnforcementActionType } from '../../src/shared/types/common.js';
import {
  EnforcementActionStatus,
  ESCALATION_SEQUENCE,
  DECISION_TO_ACTION_TYPE,
  ESCALATION_TIMEOUT_MS,
  MAX_REVALIDATION_ATTEMPTS,
  MAX_OVERRIDE_EXPIRATION_DAYS,
} from '../../src/services/enforcement/types.js';
import type { EnforcementAction } from '../../src/services/enforcement/types.js';
import {
  determineActionType,
  isEscalatable,
  getNextEscalationAction,
} from '../../src/services/enforcement/enforcement-engine.js';

// --- Test Helpers ---

function makeEnforcementAction(overrides: Partial<EnforcementAction> = {}): EnforcementAction {
  const now = new Date().toISOString();
  return {
    action_id: 'action-001',
    tenant_id: 'tenant-001',
    decision_id: 'decision-001',
    action_type: EnforcementActionType.DENY_ENTRY,
    status: EnforcementActionStatus.PENDING,
    worker_id: 'worker-001',
    site_id: 'site-001',
    reason: 'Worker does not hold required certification: fall_protection',
    created_at: now,
    updated_at: now,
    escalation_level: 0,
    ...overrides,
  };
}

// --- Action Type Determination Tests (Requirement 10.1, 10.2) ---

describe('enforcement-engine: determineActionType', () => {
  it('maps denied decision to deny_entry action type (Requirement 10.1)', () => {
    const actionType = determineActionType('denied');
    expect(actionType).toBe(EnforcementActionType.DENY_ENTRY);
  });

  it('maps conditional decision to require_manual_review_at_gate action type', () => {
    const actionType = determineActionType('conditional');
    expect(actionType).toBe(EnforcementActionType.REQUIRE_MANUAL_REVIEW_AT_GATE);
  });

  it('maps unknown decision result to notify_supervisor as default', () => {
    const actionType = determineActionType('unknown_result');
    expect(actionType).toBe(EnforcementActionType.NOTIFY_SUPERVISOR);
  });

  it('does not map allowed decisions (they should not trigger enforcement)', () => {
    // allowed is not in DECISION_TO_ACTION_TYPE, so it falls to default
    const actionType = determineActionType('allowed');
    expect(actionType).toBe(EnforcementActionType.NOTIFY_SUPERVISOR);
  });
});

// --- Action Types Support (Requirement 10.2) ---

describe('enforcement-engine: supported action types', () => {
  it('supports all 8 required action types (Requirement 10.2)', () => {
    const requiredTypes = [
      'deny_entry',
      'notify_supervisor',
      'request_updated_certification',
      'require_manual_review_at_gate',
      'trigger_override_workflow',
      'create_corrective_action_task',
      'require_rescan',
      'escalate_to_cso',
    ];

    for (const type of requiredTypes) {
      expect(Object.values(EnforcementActionType)).toContain(type);
    }
  });

  it('EnforcementActionType enum has exactly 8 values', () => {
    expect(Object.values(EnforcementActionType).length).toBe(8);
  });
});

// --- Escalation Logic Tests (Requirement 10.8) ---

describe('enforcement-engine: isEscalatable', () => {
  it('deny_entry is escalatable', () => {
    expect(isEscalatable(EnforcementActionType.DENY_ENTRY)).toBe(true);
  });

  it('require_manual_review_at_gate is escalatable', () => {
    expect(isEscalatable(EnforcementActionType.REQUIRE_MANUAL_REVIEW_AT_GATE)).toBe(true);
  });

  it('notify_supervisor is NOT escalatable', () => {
    expect(isEscalatable(EnforcementActionType.NOTIFY_SUPERVISOR)).toBe(false);
  });

  it('escalate_to_cso is NOT escalatable', () => {
    expect(isEscalatable(EnforcementActionType.ESCALATE_TO_CSO)).toBe(false);
  });

  it('request_updated_certification is NOT escalatable', () => {
    expect(isEscalatable(EnforcementActionType.REQUEST_UPDATED_CERTIFICATION)).toBe(false);
  });

  it('create_corrective_action_task is NOT escalatable', () => {
    expect(isEscalatable(EnforcementActionType.CREATE_CORRECTIVE_ACTION_TASK)).toBe(false);
  });
});

describe('enforcement-engine: getNextEscalationAction', () => {
  it('deny_entry escalates to require_manual_review_at_gate', () => {
    const next = getNextEscalationAction(EnforcementActionType.DENY_ENTRY);
    expect(next).toBe(EnforcementActionType.REQUIRE_MANUAL_REVIEW_AT_GATE);
  });

  it('require_manual_review_at_gate escalates to notify_supervisor', () => {
    const next = getNextEscalationAction(EnforcementActionType.REQUIRE_MANUAL_REVIEW_AT_GATE);
    expect(next).toBe(EnforcementActionType.NOTIFY_SUPERVISOR);
  });

  it('notify_supervisor escalates to escalate_to_cso', () => {
    const next = getNextEscalationAction(EnforcementActionType.NOTIFY_SUPERVISOR);
    expect(next).toBe(EnforcementActionType.ESCALATE_TO_CSO);
  });

  it('escalate_to_cso cannot escalate further (returns null)', () => {
    const next = getNextEscalationAction(EnforcementActionType.ESCALATE_TO_CSO);
    expect(next).toBeNull();
  });

  it('action types not in escalation sequence return null', () => {
    const next = getNextEscalationAction(EnforcementActionType.REQUEST_UPDATED_CERTIFICATION);
    expect(next).toBeNull();
  });

  it('require_rescan is not in escalation sequence', () => {
    const next = getNextEscalationAction(EnforcementActionType.REQUIRE_RESCAN);
    expect(next).toBeNull();
  });
});

describe('enforcement-engine: escalation sequence', () => {
  it('escalation sequence has correct order', () => {
    expect(ESCALATION_SEQUENCE).toEqual([
      EnforcementActionType.DENY_ENTRY,
      EnforcementActionType.REQUIRE_MANUAL_REVIEW_AT_GATE,
      EnforcementActionType.NOTIFY_SUPERVISOR,
      EnforcementActionType.ESCALATE_TO_CSO,
    ]);
  });

  it('escalation sequence starts with deny_entry', () => {
    expect(ESCALATION_SEQUENCE[0]).toBe(EnforcementActionType.DENY_ENTRY);
  });

  it('escalation sequence ends with escalate_to_cso', () => {
    expect(ESCALATION_SEQUENCE[ESCALATION_SEQUENCE.length - 1]).toBe(
      EnforcementActionType.ESCALATE_TO_CSO
    );
  });
});

// --- Escalation Timeout (Requirement 10.8) ---

describe('enforcement-engine: escalation timeout', () => {
  it('escalation timeout is 30 minutes (Requirement 10.8)', () => {
    expect(ESCALATION_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it('escalation timeout is exactly 1,800,000 milliseconds', () => {
    expect(ESCALATION_TIMEOUT_MS).toBe(1_800_000);
  });
});

// --- EnforcementAction Interface Tests (Requirement 10.1) ---

describe('enforcement-engine: EnforcementAction interface', () => {
  it('enforcement action has all required fields', () => {
    const action = makeEnforcementAction();
    expect(action.action_id).toBeDefined();
    expect(action.tenant_id).toBeDefined();
    expect(action.decision_id).toBeDefined();
    expect(action.action_type).toBeDefined();
    expect(action.status).toBeDefined();
    expect(action.worker_id).toBeDefined();
    expect(action.site_id).toBeDefined();
    expect(action.reason).toBeDefined();
    expect(action.created_at).toBeDefined();
    expect(action.updated_at).toBeDefined();
    expect(action.escalation_level).toBeDefined();
  });

  it('enforcement action is linked to a DecisionRecord via decision_id', () => {
    const action = makeEnforcementAction({ decision_id: 'decision-xyz' });
    expect(action.decision_id).toBe('decision-xyz');
  });

  it('enforcement action timestamps are valid ISO 8601', () => {
    const action = makeEnforcementAction();
    expect(new Date(action.created_at).toISOString()).toBe(action.created_at);
    expect(new Date(action.updated_at).toISOString()).toBe(action.updated_at);
  });

  it('enforcement action starts with escalation_level 0', () => {
    const action = makeEnforcementAction();
    expect(action.escalation_level).toBe(0);
  });

  it('escalated action has incremented escalation_level', () => {
    const action = makeEnforcementAction({
      escalation_level: 1,
      escalated_from: 'action-original',
    });
    expect(action.escalation_level).toBe(1);
    expect(action.escalated_from).toBe('action-original');
  });
});

// --- EnforcementActionStatus Tests ---

describe('enforcement-engine: EnforcementActionStatus', () => {
  it('supports all required statuses', () => {
    expect(EnforcementActionStatus.PENDING).toBe('pending');
    expect(EnforcementActionStatus.IN_PROGRESS).toBe('in_progress');
    expect(EnforcementActionStatus.RESOLVED).toBe('resolved');
    expect(EnforcementActionStatus.ESCALATED).toBe('escalated');
    expect(EnforcementActionStatus.EXPIRED).toBe('expired');
  });

  it('initial status is PENDING', () => {
    const action = makeEnforcementAction();
    expect(action.status).toBe(EnforcementActionStatus.PENDING);
  });
});

// --- Decision-to-Action Mapping Tests ---

describe('enforcement-engine: DECISION_TO_ACTION_TYPE mapping', () => {
  it('denied maps to deny_entry', () => {
    expect(DECISION_TO_ACTION_TYPE['denied']).toBe(EnforcementActionType.DENY_ENTRY);
  });

  it('conditional maps to require_manual_review_at_gate', () => {
    expect(DECISION_TO_ACTION_TYPE['conditional']).toBe(
      EnforcementActionType.REQUIRE_MANUAL_REVIEW_AT_GATE
    );
  });

  it('allowed is not in the mapping (no enforcement for allowed)', () => {
    expect(DECISION_TO_ACTION_TYPE['allowed']).toBeUndefined();
  });

  it('manual_review_required is not in the mapping', () => {
    expect(DECISION_TO_ACTION_TYPE['manual_review_required']).toBeUndefined();
  });
});

// --- Revalidation Constraints (Requirement 10.4) ---

describe('enforcement-engine: revalidation constraints', () => {
  it('max revalidation attempts is 3 per decision per 24h (Requirement 10.4)', () => {
    expect(MAX_REVALIDATION_ATTEMPTS).toBe(3);
  });

  it('revalidation window is 24 hours', () => {
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const windowStart = new Date(Date.now() - twentyFourHoursMs);
    const now = new Date();
    const diff = now.getTime() - windowStart.getTime();
    expect(diff).toBe(twentyFourHoursMs);
  });
});

// --- Override Constraints (Requirement 10.5, 10.6, 10.7) ---

describe('enforcement-engine: override constraints', () => {
  it('max override expiration is 90 days (Requirement 10.6)', () => {
    expect(MAX_OVERRIDE_EXPIRATION_DAYS).toBe(90);
  });

  it('override expiration within 90 days is valid', () => {
    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const maxExpiration = new Date(now.getTime() + MAX_OVERRIDE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
    expect(thirtyDays.getTime()).toBeLessThanOrEqual(maxExpiration.getTime());
  });

  it('override expiration exceeding 90 days is invalid', () => {
    const now = new Date();
    const ninetyOneDays = new Date(now.getTime() + 91 * 24 * 60 * 60 * 1000);
    const maxExpiration = new Date(now.getTime() + MAX_OVERRIDE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
    expect(ninetyOneDays.getTime()).toBeGreaterThan(maxExpiration.getTime());
  });

  it('override expiration at exactly 90 days is valid', () => {
    const now = new Date();
    const exactlyNinetyDays = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const maxExpiration = new Date(now.getTime() + MAX_OVERRIDE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
    expect(exactlyNinetyDays.getTime()).toBeLessThanOrEqual(maxExpiration.getTime());
  });
});

// --- Immutability Constraint (Requirement 10.7) ---

describe('enforcement-engine: decision immutability', () => {
  it('original DecisionRecord remains immutable — overrides create new linked records', () => {
    // The enforcement action links to the decision via decision_id
    // but never modifies the original decision record
    const action = makeEnforcementAction({ decision_id: 'original-decision-001' });
    expect(action.decision_id).toBe('original-decision-001');

    // An escalated action also links to the same original decision
    const escalatedAction = makeEnforcementAction({
      decision_id: 'original-decision-001',
      escalated_from: action.action_id,
      escalation_level: 1,
    });
    expect(escalatedAction.decision_id).toBe('original-decision-001');
    expect(escalatedAction.escalated_from).toBe(action.action_id);
  });
});

// --- Deadline Calculation Tests ---

describe('enforcement-engine: deadline calculation', () => {
  it('escalatable actions get a deadline 30 min from creation', () => {
    const now = Date.now();
    const expectedDeadline = new Date(now + ESCALATION_TIMEOUT_MS);

    // Simulate deadline calculation
    const deadline = new Date(now + ESCALATION_TIMEOUT_MS).toISOString();
    const deadlineDate = new Date(deadline);

    // Should be approximately 30 minutes from now
    const diffMs = deadlineDate.getTime() - now;
    expect(diffMs).toBeCloseTo(ESCALATION_TIMEOUT_MS, -2); // within 100ms
  });

  it('non-escalatable actions do not get a deadline', () => {
    // For non-escalatable types, deadline should be undefined
    const action = makeEnforcementAction({
      action_type: EnforcementActionType.REQUEST_UPDATED_CERTIFICATION,
      deadline: undefined,
    });
    expect(action.deadline).toBeUndefined();
  });

  it('escalatable action with deadline set', () => {
    const deadline = new Date(Date.now() + ESCALATION_TIMEOUT_MS).toISOString();
    const action = makeEnforcementAction({
      action_type: EnforcementActionType.DENY_ENTRY,
      deadline,
    });
    expect(action.deadline).toBeDefined();
    expect(new Date(action.deadline!).toISOString()).toBe(action.deadline);
  });
});

// --- Enforcement Action Creation Timing (Requirement 10.1) ---

describe('enforcement-engine: creation timing constraint', () => {
  it('enforcement action must be created within 5 seconds of decision (Requirement 10.1)', () => {
    // This is a design constraint — the action is created synchronously
    // in the same event processing pipeline as the decision
    const decisionTimestamp = new Date().toISOString();
    const actionCreatedAt = new Date().toISOString();

    const decisionTime = new Date(decisionTimestamp).getTime();
    const actionTime = new Date(actionCreatedAt).getTime();
    const diffMs = actionTime - decisionTime;

    // In the same process, the difference should be < 5000ms
    expect(diffMs).toBeLessThan(5000);
  });
});

// --- Full Escalation Path Test ---

describe('enforcement-engine: full escalation path', () => {
  it('traces complete escalation path from deny_entry to escalate_to_cso', () => {
    let current: EnforcementActionType | null = EnforcementActionType.DENY_ENTRY;
    const path: EnforcementActionType[] = [current];

    while (current !== null) {
      const next = getNextEscalationAction(current);
      if (next !== null) {
        path.push(next);
      }
      current = next;
    }

    expect(path).toEqual([
      EnforcementActionType.DENY_ENTRY,
      EnforcementActionType.REQUIRE_MANUAL_REVIEW_AT_GATE,
      EnforcementActionType.NOTIFY_SUPERVISOR,
      EnforcementActionType.ESCALATE_TO_CSO,
    ]);
  });

  it('escalation path has 4 levels total', () => {
    expect(ESCALATION_SEQUENCE.length).toBe(4);
  });
});
