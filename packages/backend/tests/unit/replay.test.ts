/**
 * Unit tests for the Decision Replay and History Module.
 * Tests: filterExplainabilityByRole, getDecisionHistory, replayDecision.
 *
 * Requirements: 2.5, 2.6, 12.4, 12.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role, DecisionResult, DecisionType } from '../../src/shared/types/common.js';
import type { ExplainabilityPayload } from '../../src/shared/types/decisions.js';

// Mock DynamoDB
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn().mockImplementation((params) => params),
}));

vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: vi.fn((name: string) => `dev-${name}`),
}));

// Mock evaluator functions
vi.mock('../../src/services/decision-engine/evaluator.js', () => ({
  evaluateRules: vi.fn(),
  determineDecisionResult: vi.fn(),
  generateReasons: vi.fn(),
}));

// Mock explainability
vi.mock('../../src/services/decision-engine/explainability.js', () => ({
  generateExplainabilityPayload: vi.fn(),
}));

import {
  filterExplainabilityByRole,
  getDecisionHistory,
  replayDecision,
} from '../../src/services/decision-engine/replay.js';
import { docClient } from '../../src/shared/dynamo-client.js';
import { evaluateRules, determineDecisionResult, generateReasons } from '../../src/services/decision-engine/evaluator.js';
import { generateExplainabilityPayload } from '../../src/services/decision-engine/explainability.js';

// --- Test Helpers ---

function makeExplainabilityPayload(overrides: Partial<ExplainabilityPayload> = {}): ExplainabilityPayload {
  return {
    decision: DecisionResult.ALLOWED,
    decision_type: DecisionType.SITE_ACCESS,
    timestamp: '2024-06-01T10:00:00.000Z',
    reasons: ['Worker holds valid fall protection certification.'],
    rule_references: [
      { rule_id: 'rule-001', rule_name: 'Fall protection required', clause: 'rule-001', source: 'PolicyVersion pv-001' },
    ],
    evidence_references: [
      { evidence_type: 'certification', reference_id: 'cert-001', description: 'Valid fall_protection certification' },
    ],
    policy_version_references: ['pv-001'],
    explanation_level: 'audit_grade',
    ...overrides,
  };
}

function makeDecisionRecord() {
  return {
    PK: 'TENANT#tenant-001',
    SK: 'DECISION#decision-001',
    decision_id: 'decision-001',
    decision_result: 'allowed',
    decision_type: 'site_access',
    subject_type: 'worker',
    subject_id: 'worker-123',
    site_id: 'site-456',
    reasons: ['Worker holds valid fall protection certification.'],
    rules_applied: ['rule-001'],
    policy_version_used: 'pv-001',
    jurisdiction: 'British Columbia',
    timestamp: '2024-06-01T10:00:00.000Z',
    rule_snapshot_json: JSON.stringify([
      {
        rule_id: 'rule-001',
        rule_type: 'certification_required',
        description: 'Fall protection required',
        required_certification_type: 'fall_protection',
        conditions: {},
        actions: {},
      },
    ]),
    explainability_payload: JSON.stringify(makeExplainabilityPayload()),
    tenant_id: 'tenant-001',
    correlation_id: 'corr-001',
  };
}

function makePolicyVersionItem() {
  return {
    PK: 'POLICY#policy-001',
    SK: 'VERSION#pv-001',
    GSI1PK: 'VERSION#pv-001',
    policy_version_id: 'pv-001',
    policy_id: 'policy-001',
    tenant_id: 'tenant-001',
    version_number: 3,
    effective_from: '2024-01-01',
    effective_to: undefined,
    change_summary: 'Added fall protection requirement for all workers',
    is_active: true,
    rules: [
      {
        rule_id: 'rule-001',
        rule_type: 'certification_required',
        description: 'Fall protection required',
        required_certification_type: 'fall_protection',
        conditions: {},
        actions: {},
      },
    ],
    rule_snapshot_json: JSON.stringify([
      {
        rule_id: 'rule-001',
        rule_type: 'certification_required',
        description: 'Fall protection required',
        required_certification_type: 'fall_protection',
        conditions: {},
        actions: {},
      },
    ]),
    jurisdiction: 'British Columbia',
  };
}


// --- filterExplainabilityByRole Tests (Requirement 12.4) ---

describe('replay: filterExplainabilityByRole', () => {
  const fullPayload = makeExplainabilityPayload();

  it('returns null when payload is null', () => {
    expect(filterExplainabilityByRole(null, Role.WORKER)).toBeNull();
    expect(filterExplainabilityByRole(null, Role.SUPERVISOR)).toBeNull();
    expect(filterExplainabilityByRole(null, Role.PLATFORM_ADMIN)).toBeNull();
  });

  describe('worker role visibility', () => {
    it('returns only decision, decision_type, timestamp, and reasons for worker', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.WORKER);
      expect(result).toEqual({
        decision: DecisionResult.ALLOWED,
        decision_type: DecisionType.SITE_ACCESS,
        timestamp: '2024-06-01T10:00:00.000Z',
        reasons: ['Worker holds valid fall protection certification.'],
      });
    });

    it('does not include rule_references for worker', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.WORKER);
      expect(result).not.toHaveProperty('rule_references');
    });

    it('does not include evidence_references for worker', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.WORKER);
      expect(result).not.toHaveProperty('evidence_references');
    });

    it('does not include policy_version_references for worker', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.WORKER);
      expect(result).not.toHaveProperty('policy_version_references');
    });
  });

  describe('gate_operator role visibility', () => {
    it('returns same visibility as worker (reasons only)', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.GATE_OPERATOR);
      expect(result).toEqual({
        decision: DecisionResult.ALLOWED,
        decision_type: DecisionType.SITE_ACCESS,
        timestamp: '2024-06-01T10:00:00.000Z',
        reasons: ['Worker holds valid fall protection certification.'],
      });
    });
  });

  describe('supervisor role visibility', () => {
    it('returns reasons and rule_references for supervisor', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.SUPERVISOR);
      expect(result).toEqual({
        decision: DecisionResult.ALLOWED,
        decision_type: DecisionType.SITE_ACCESS,
        timestamp: '2024-06-01T10:00:00.000Z',
        reasons: ['Worker holds valid fall protection certification.'],
        rule_references: [
          { rule_id: 'rule-001', rule_name: 'Fall protection required', clause: 'rule-001', source: 'PolicyVersion pv-001' },
        ],
      });
    });

    it('does not include evidence_references for supervisor', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.SUPERVISOR);
      expect(result).not.toHaveProperty('evidence_references');
    });

    it('does not include policy_version_references for supervisor', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.SUPERVISOR);
      expect(result).not.toHaveProperty('policy_version_references');
    });
  });

  describe('admin roles visibility (full payload)', () => {
    const adminRoles = [Role.PLATFORM_ADMIN, Role.TENANT_ADMIN, Role.SITE_ADMIN, Role.CSO];

    for (const role of adminRoles) {
      it(`returns full payload for ${role}`, () => {
        const result = filterExplainabilityByRole(fullPayload, role);
        expect(result).toEqual(fullPayload);
      });
    }

    it('includes evidence_references for admin', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.PLATFORM_ADMIN);
      expect(result).toHaveProperty('evidence_references');
      expect((result as ExplainabilityPayload).evidence_references).toHaveLength(1);
    });

    it('includes policy_version_references for admin', () => {
      const result = filterExplainabilityByRole(fullPayload, Role.PLATFORM_ADMIN);
      expect(result).toHaveProperty('policy_version_references');
      expect((result as ExplainabilityPayload).policy_version_references).toContain('pv-001');
    });
  });

  describe('payload with multiple reasons', () => {
    it('preserves all reasons regardless of role', () => {
      const multiReasonPayload = makeExplainabilityPayload({
        reasons: ['Reason 1', 'Reason 2', 'Reason 3'],
      });

      const workerResult = filterExplainabilityByRole(multiReasonPayload, Role.WORKER);
      expect((workerResult as any).reasons).toHaveLength(3);

      const supervisorResult = filterExplainabilityByRole(multiReasonPayload, Role.SUPERVISOR);
      expect((supervisorResult as any).reasons).toHaveLength(3);
    });
  });
});


// --- getDecisionHistory Tests (Requirement 2.5, 12.7) ---

describe('replay: getDecisionHistory', () => {
  const mockSend = vi.mocked(docClient.send);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when decision record is not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await getDecisionHistory('nonexistent-id', 'tenant-001', Role.PLATFORM_ADMIN);
    expect(result.error).toBe('Decision record not found');
    expect(result.data).toBeUndefined();
  });

  it('returns error when Items is undefined', async () => {
    mockSend.mockResolvedValueOnce({ Items: undefined });

    const result = await getDecisionHistory('nonexistent-id', 'tenant-001', Role.PLATFORM_ADMIN);
    expect(result.error).toBe('Decision record not found');
  });

  it('returns decision history with PolicyVersion details for admin', async () => {
    const decisionRecord = makeDecisionRecord();
    const policyVersionItem = makePolicyVersionItem();

    // First call: fetch decision record
    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    // Second call: fetch policy version
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    const result = await getDecisionHistory('decision-001', 'tenant-001', Role.PLATFORM_ADMIN);

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data!.decision_id).toBe('decision-001');
    expect(result.data!.decision_result).toBe('allowed');
    expect(result.data!.policy_version.policy_version_id).toBe('pv-001');
    expect(result.data!.policy_version.version_number).toBe(3);
    expect(result.data!.policy_version.effective_from).toBe('2024-01-01');
    expect(result.data!.policy_version.change_summary).toBe('Added fall protection requirement for all workers');
  });

  it('returns full explainability for admin role', async () => {
    const decisionRecord = makeDecisionRecord();
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    const result = await getDecisionHistory('decision-001', 'tenant-001', Role.PLATFORM_ADMIN);

    expect(result.data!.explainability).toBeDefined();
    expect(result.data!.explainability).toHaveProperty('evidence_references');
    expect(result.data!.explainability).toHaveProperty('rule_references');
    expect(result.data!.explainability).toHaveProperty('policy_version_references');
  });

  it('filters explainability for worker role (reasons only)', async () => {
    const decisionRecord = makeDecisionRecord();
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    const result = await getDecisionHistory('decision-001', 'tenant-001', Role.WORKER);

    expect(result.data!.explainability).toBeDefined();
    expect(result.data!.explainability).not.toHaveProperty('evidence_references');
    expect(result.data!.explainability).not.toHaveProperty('rule_references');
    expect(result.data!.explainability).toHaveProperty('reasons');
  });

  it('filters explainability for supervisor role (reasons + rule_references)', async () => {
    const decisionRecord = makeDecisionRecord();
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    const result = await getDecisionHistory('decision-001', 'tenant-001', Role.SUPERVISOR);

    expect(result.data!.explainability).toBeDefined();
    expect(result.data!.explainability).toHaveProperty('reasons');
    expect(result.data!.explainability).toHaveProperty('rule_references');
    expect(result.data!.explainability).not.toHaveProperty('evidence_references');
  });

  it('handles decision with no policy version (NONE)', async () => {
    const decisionRecord = {
      ...makeDecisionRecord(),
      policy_version_used: 'NONE',
    };

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });

    const result = await getDecisionHistory('decision-001', 'tenant-001', Role.PLATFORM_ADMIN);

    expect(result.data!.policy_version.policy_version_id).toBe('NONE');
    expect(result.data!.policy_version.version_number).toBe(0);
    expect(result.data!.policy_version.effective_from).toBe('');
    expect(result.data!.policy_version.change_summary).toBe('');
  });

  it('handles missing policy version in PolicyVersions table', async () => {
    const decisionRecord = makeDecisionRecord();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    // Policy version not found
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await getDecisionHistory('decision-001', 'tenant-001', Role.PLATFORM_ADMIN);

    expect(result.data!.policy_version.policy_version_id).toBe('pv-001');
    expect(result.data!.policy_version.version_number).toBe(0);
  });

  it('handles decision with no explainability payload', async () => {
    const decisionRecord = {
      ...makeDecisionRecord(),
      explainability_payload: undefined,
    };
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    const result = await getDecisionHistory('decision-001', 'tenant-001', Role.PLATFORM_ADMIN);

    expect(result.data!.explainability).toBeNull();
  });

  it('includes all decision metadata fields', async () => {
    const decisionRecord = makeDecisionRecord();
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    const result = await getDecisionHistory('decision-001', 'tenant-001', Role.PLATFORM_ADMIN);

    expect(result.data!.decision_type).toBe('site_access');
    expect(result.data!.subject_type).toBe('worker');
    expect(result.data!.subject_id).toBe('worker-123');
    expect(result.data!.site_id).toBe('site-456');
    expect(result.data!.jurisdiction).toBe('British Columbia');
    expect(result.data!.timestamp).toBe('2024-06-01T10:00:00.000Z');
    expect(result.data!.reasons).toEqual(['Worker holds valid fall protection certification.']);
    expect(result.data!.rules_applied).toEqual(['rule-001']);
  });
});


// --- replayDecision Tests (Requirement 2.6) ---

describe('replay: replayDecision', () => {
  const mockSend = vi.mocked(docClient.send);
  const mockEvaluateRules = vi.mocked(evaluateRules);
  const mockDetermineDecisionResult = vi.mocked(determineDecisionResult);
  const mockGenerateReasons = vi.mocked(generateReasons);
  const mockGenerateExplainabilityPayload = vi.mocked(generateExplainabilityPayload);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when decision record is not found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await replayDecision('nonexistent-id', 'tenant-001');
    expect(result.error).toBe('Decision record not found');
    expect(result.data).toBeUndefined();
  });

  it('returns error when no policy version was used in original decision', async () => {
    const decisionRecord = {
      ...makeDecisionRecord(),
      policy_version_used: 'NONE',
    };

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });

    const result = await replayDecision('decision-001', 'tenant-001');
    expect(result.error).toBe('Cannot replay decision: no policy version was used in the original evaluation');
  });

  it('returns error when policy version is empty string', async () => {
    const decisionRecord = {
      ...makeDecisionRecord(),
      policy_version_used: '',
    };

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });

    const result = await replayDecision('decision-001', 'tenant-001');
    expect(result.error).toBe('Cannot replay decision: no policy version was used in the original evaluation');
  });

  it('returns error when original policy version is no longer available', async () => {
    const decisionRecord = makeDecisionRecord();

    // First call: fetch decision record
    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    // Second call: resolve policy version by ID - not found
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await replayDecision('decision-001', 'tenant-001');
    expect(result.error).toBe('Cannot replay decision: the original policy version is no longer available');
  });

  it('successfully replays a decision with same result', async () => {
    const decisionRecord = makeDecisionRecord();
    const policyVersionItem = makePolicyVersionItem();

    // Call 1: fetch decision record
    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    // Call 2: resolve policy version by ID
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });
    // Call 3: get worker certifications
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          certification_id: 'cert-001',
          certification_type: 'fall_protection',
          status: 'validated',
          expiry_date: '2025-12-31',
          issue_date: '2024-01-01',
        },
      ],
    });
    // Call 4: get policy version metadata
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    // Mock evaluator functions
    mockEvaluateRules.mockReturnValue([
      {
        rule_id: 'rule-001',
        rule_name: 'Fall protection required',
        passed: true,
        reason: 'Worker holds valid fall protection certification.',
        clause: 'rule-001',
        source: 'PolicyVersion pv-001',
        evidence_type: 'certification',
        evidence_reference_id: 'cert-001',
        evidence_description: 'Valid fall_protection certification',
      },
    ]);
    mockDetermineDecisionResult.mockReturnValue(DecisionResult.ALLOWED);
    mockGenerateReasons.mockReturnValue(['Worker holds valid fall protection certification.']);
    mockGenerateExplainabilityPayload.mockReturnValue({
      success: true,
      payload: makeExplainabilityPayload(),
    });

    const result = await replayDecision('decision-001', 'tenant-001');

    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data!.original_decision.decision_id).toBe('decision-001');
    expect(result.data!.original_decision.decision_result).toBe('allowed');
    expect(result.data!.replay_decision.decision_result).toBe('allowed');
    expect(result.data!.inputs_match).toBe(true);
    expect(result.data!.policy_version_used.policy_version_id).toBe('pv-001');
    expect(result.data!.policy_version_used.version_number).toBe(3);
    expect(result.data!.policy_version_used.change_summary).toBe('Added fall protection requirement for all workers');
  });

  it('detects when replay produces a different result', async () => {
    const decisionRecord = makeDecisionRecord(); // original: allowed
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });
    mockSend.mockResolvedValueOnce({ Items: [] }); // no certifications now
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    mockEvaluateRules.mockReturnValue([
      {
        rule_id: 'rule-001',
        rule_name: 'Fall protection required',
        passed: false,
        reason: 'Worker does not hold required certification: fall_protection.',
        clause: 'rule-001',
        source: 'PolicyVersion pv-001',
        evidence_type: 'policy_version',
        evidence_reference_id: 'pv-001',
        evidence_description: 'Policy version 3 requires fall_protection',
      },
    ]);
    mockDetermineDecisionResult.mockReturnValue(DecisionResult.DENIED);
    mockGenerateReasons.mockReturnValue(['Worker does not hold required certification: fall_protection.']);
    mockGenerateExplainabilityPayload.mockReturnValue({
      success: true,
      payload: makeExplainabilityPayload({ decision: DecisionResult.DENIED }),
    });

    const result = await replayDecision('decision-001', 'tenant-001');

    expect(result.data!.original_decision.decision_result).toBe('allowed');
    expect(result.data!.replay_decision.decision_result).toBe('denied');
    expect(result.data!.inputs_match).toBe(false);
  });

  it('uses rule_snapshot_json from original decision for replay', async () => {
    const rules = [
      {
        rule_id: 'rule-snapshot-001',
        rule_type: 'certification_required',
        description: 'Snapshot rule',
        required_certification_type: 'whmis_2015',
        conditions: {},
        actions: {},
      },
    ];
    const decisionRecord = {
      ...makeDecisionRecord(),
      rule_snapshot_json: JSON.stringify(rules),
    };
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    mockEvaluateRules.mockReturnValue([]);
    mockDetermineDecisionResult.mockReturnValue(DecisionResult.MANUAL_REVIEW_REQUIRED);
    mockGenerateReasons.mockReturnValue([]);
    mockGenerateExplainabilityPayload.mockReturnValue({ success: false, missing_fields: ['reasons'] });

    await replayDecision('decision-001', 'tenant-001');

    // Verify evaluateRules was called with the snapshot rules
    expect(mockEvaluateRules).toHaveBeenCalledWith(
      rules,
      expect.any(Array),
      expect.objectContaining({ rules })
    );
  });

  it('falls back to policy version rules when rule_snapshot_json is empty', async () => {
    const decisionRecord = {
      ...makeDecisionRecord(),
      rule_snapshot_json: '{}',
    };
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    mockEvaluateRules.mockReturnValue([]);
    mockDetermineDecisionResult.mockReturnValue(DecisionResult.MANUAL_REVIEW_REQUIRED);
    mockGenerateReasons.mockReturnValue([]);
    mockGenerateExplainabilityPayload.mockReturnValue({ success: false, missing_fields: ['reasons'] });

    await replayDecision('decision-001', 'tenant-001');

    // Should use the policy version's rules since snapshot was empty
    expect(mockEvaluateRules).toHaveBeenCalledWith(
      policyVersionItem.rules,
      expect.any(Array),
      expect.objectContaining({ rules: policyVersionItem.rules })
    );
  });

  it('handles explainability generation failure gracefully', async () => {
    const decisionRecord = makeDecisionRecord();
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    mockEvaluateRules.mockReturnValue([]);
    mockDetermineDecisionResult.mockReturnValue(DecisionResult.DENIED);
    mockGenerateReasons.mockReturnValue(['No certifications found']);
    mockGenerateExplainabilityPayload.mockReturnValue({
      success: false,
      missing_fields: ['evidence_references'],
    });

    const result = await replayDecision('decision-001', 'tenant-001');

    expect(result.data).toBeDefined();
    expect(result.data!.replay_decision.explainability).toBeNull();
  });

  it('includes replay timestamp in the result', async () => {
    const decisionRecord = makeDecisionRecord();
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    mockEvaluateRules.mockReturnValue([]);
    mockDetermineDecisionResult.mockReturnValue(DecisionResult.DENIED);
    mockGenerateReasons.mockReturnValue(['Reason']);
    mockGenerateExplainabilityPayload.mockReturnValue({ success: false, missing_fields: ['reasons'] });

    const result = await replayDecision('decision-001', 'tenant-001');

    expect(result.data!.replay_decision.timestamp).toBeDefined();
    // Replay timestamp should be different from original
    expect(result.data!.replay_decision.timestamp).not.toBe(result.data!.original_decision.timestamp);
  });

  it('returns original decision metadata in the result', async () => {
    const decisionRecord = makeDecisionRecord();
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });

    mockEvaluateRules.mockReturnValue([]);
    mockDetermineDecisionResult.mockReturnValue(DecisionResult.DENIED);
    mockGenerateReasons.mockReturnValue(['Reason']);
    mockGenerateExplainabilityPayload.mockReturnValue({ success: false, missing_fields: ['reasons'] });

    const result = await replayDecision('decision-001', 'tenant-001');

    expect(result.data!.original_decision.decision_id).toBe('decision-001');
    expect(result.data!.original_decision.decision_result).toBe('allowed');
    expect(result.data!.original_decision.reasons).toEqual(['Worker holds valid fall protection certification.']);
    expect(result.data!.original_decision.rules_applied).toEqual(['rule-001']);
    expect(result.data!.original_decision.timestamp).toBe('2024-06-01T10:00:00.000Z');
  });

  it('handles missing policy version metadata gracefully', async () => {
    const decisionRecord = makeDecisionRecord();
    const policyVersionItem = makePolicyVersionItem();

    mockSend.mockResolvedValueOnce({ Items: [decisionRecord] });
    mockSend.mockResolvedValueOnce({ Items: [policyVersionItem] });
    mockSend.mockResolvedValueOnce({ Items: [] });
    // Policy version metadata not found
    mockSend.mockResolvedValueOnce({ Items: [] });

    mockEvaluateRules.mockReturnValue([]);
    mockDetermineDecisionResult.mockReturnValue(DecisionResult.DENIED);
    mockGenerateReasons.mockReturnValue(['Reason']);
    mockGenerateExplainabilityPayload.mockReturnValue({ success: false, missing_fields: ['reasons'] });

    const result = await replayDecision('decision-001', 'tenant-001');

    expect(result.data!.policy_version_used.policy_version_id).toBe('pv-001');
    expect(result.data!.policy_version_used.change_summary).toBe('');
  });
});
