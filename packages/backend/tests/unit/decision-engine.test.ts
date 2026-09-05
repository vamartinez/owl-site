/**
 * Unit tests for the Compliance Decision Engine.
 * Tests core evaluation logic: input validation, rule evaluation,
 * decision determination, reason generation, explainability,
 * handler routing, and SQS event detection.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 12.1, 12.3, 12.6
 */

import { describe, it, expect } from 'vitest';
import {
  validateInputs,
  evaluateRules,
  determineDecisionResult,
  generateReasons,
} from '../../src/services/decision-engine/evaluator.js';
import {
  generateExplainabilityPayload,
  validateExplainabilityPayload,
} from '../../src/services/decision-engine/explainability.js';
import { handler } from '../../src/services/decision-engine/handler.js';
import { DecisionResult, DecisionType } from '../../src/shared/types/common.js';
import type { DecisionRequest } from '../../src/shared/types/decisions.js';
import type {
  WorkerCertification,
  PolicyRequirement,
  ResolvedPolicyVersion,
  RuleEvaluationResult,
  EvaluationContext,
} from '../../src/services/decision-engine/types.js';

// --- Test Helpers ---

function makeDecisionRequest(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    decision_type: DecisionType.SITE_ACCESS,
    subject_type: 'worker',
    subject_id: 'worker-123',
    site_id: 'site-456',
    context: {
      jurisdiction: 'British Columbia',
      certifications: [],
    },
    ...overrides,
  };
}

function makePolicyVersion(overrides: Partial<ResolvedPolicyVersion> = {}): ResolvedPolicyVersion {
  return {
    policy_version_id: 'pv-001',
    policy_id: 'policy-001',
    tenant_id: 'tenant-001',
    version_number: 1,
    effective_from: '2024-01-01',
    rules: [],
    rule_snapshot_json: '[]',
    jurisdiction: 'British Columbia',
    ...overrides,
  };
}

function makeRule(overrides: Partial<PolicyRequirement> = {}): PolicyRequirement {
  return {
    rule_id: 'rule-001',
    rule_type: 'certification_required',
    description: 'Fall protection certification required',
    required_certification_type: 'fall_protection',
    conditions: {},
    actions: {},
    ...overrides,
  };
}

function makeCertification(overrides: Partial<WorkerCertification> = {}): WorkerCertification {
  return {
    certification_id: 'cert-001',
    certification_type: 'fall_protection',
    status: 'validated',
    expiry_date: '2025-12-31',
    issue_date: '2024-01-01',
    ...overrides,
  };
}

function makeRuleEvaluation(overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult {
  return {
    rule_id: 'rule-001',
    rule_name: 'Fall protection required',
    passed: true,
    reason: 'Worker holds valid fall protection certification.',
    clause: 'rule-001',
    source: 'PolicyVersion pv-001',
    evidence_type: 'certification',
    evidence_reference_id: 'cert-001',
    evidence_description: 'Valid fall_protection certification',
    ...overrides,
  };
}

// --- Input Validation Tests ---

describe('evaluator: validateInputs', () => {
  it('returns valid for complete input', () => {
    const request = makeDecisionRequest();
    const result = validateInputs(request);
    expect(result.valid).toBe(true);
    expect(result.missing_inputs).toHaveLength(0);
  });

  it('reports missing worker_identity when subject_id is empty', () => {
    const request = makeDecisionRequest({ subject_id: '' });
    const result = validateInputs(request);
    expect(result.valid).toBe(false);
    expect(result.missing_inputs).toContain('worker_identity');
  });

  it('reports missing site_requirements when site_id is empty', () => {
    const request = makeDecisionRequest({ site_id: '' });
    const result = validateInputs(request);
    expect(result.valid).toBe(false);
    expect(result.missing_inputs).toContain('site_requirements');
  });

  it('reports missing jurisdiction when not in context', () => {
    const request = makeDecisionRequest({
      context: { certifications: [] },
    });
    const result = validateInputs(request);
    expect(result.valid).toBe(false);
    expect(result.missing_inputs).toContain('jurisdiction');
  });

  it('reports missing certifications for worker subject_type', () => {
    const request = makeDecisionRequest({
      context: { jurisdiction: 'British Columbia' },
    });
    const result = validateInputs(request);
    expect(result.valid).toBe(false);
    expect(result.missing_inputs).toContain('certifications');
  });

  it('reports all missing inputs at once', () => {
    const request: DecisionRequest = {
      decision_type: '' as DecisionType,
      subject_type: 'worker',
      subject_id: '',
      site_id: '',
      context: {},
    };
    const result = validateInputs(request);
    expect(result.valid).toBe(false);
    expect(result.missing_inputs).toContain('worker_identity');
    expect(result.missing_inputs).toContain('site_requirements');
    expect(result.missing_inputs).toContain('decision_type');
    expect(result.missing_inputs).toContain('jurisdiction');
    expect(result.missing_inputs).toContain('certifications');
  });

  it('does not require certifications for non-worker subject types', () => {
    const request = makeDecisionRequest({
      subject_type: 'inspection',
      context: { jurisdiction: 'British Columbia' },
    });
    const result = validateInputs(request);
    expect(result.valid).toBe(true);
  });
});

// --- Rule Evaluation Tests ---

describe('evaluator: evaluateRules', () => {
  const policyVersion = makePolicyVersion();

  it('passes when worker has required validated certification', () => {
    const rules = [makeRule({ required_certification_type: 'fall_protection' })];
    const certs = [makeCertification({ certification_type: 'fall_protection', status: 'validated' })];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
  });

  it('fails when worker lacks required certification', () => {
    const rules = [makeRule({ required_certification_type: 'fall_protection' })];
    const certs: WorkerCertification[] = [];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.reason).toContain('fall_protection');
  });

  it('fails when certification is expired', () => {
    const rules = [makeRule({ required_certification_type: 'fall_protection' })];
    const certs = [makeCertification({ status: 'expired' })];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.reason).toContain('expired');
  });

  it('fails when certification is pending (not validated)', () => {
    const rules = [makeRule({ required_certification_type: 'fall_protection' })];
    const certs = [makeCertification({ status: 'pending' })];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.reason).toContain('not validated');
  });

  it('evaluates multiple rules independently', () => {
    const rules = [
      makeRule({ rule_id: 'r1', required_certification_type: 'fall_protection' }),
      makeRule({ rule_id: 'r2', required_certification_type: 'whmis_2015' }),
    ];
    const certs = [
      makeCertification({ certification_type: 'fall_protection', status: 'validated' }),
    ];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results).toHaveLength(2);
    expect(results[0]!.passed).toBe(true);
    expect(results[1]!.passed).toBe(false);
  });

  it('generates evidence references for each evaluation', () => {
    const rules = [makeRule()];
    const certs = [makeCertification()];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results[0]!.evidence_type).toBe('certification');
    expect(results[0]!.evidence_reference_id).toBe('cert-001');
  });

  it('handles generic rules without required_certification_type', () => {
    const rules = [makeRule({
      required_certification_type: undefined,
      conditions: { min_certifications: 1 },
    })];
    const certs = [makeCertification()];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results).toHaveLength(1);
    expect(results[0]!.passed).toBe(true);
  });

  it('fails generic rule when min_certifications not met', () => {
    const rules = [makeRule({
      required_certification_type: undefined,
      conditions: { min_certifications: 3 },
    })];
    const certs = [makeCertification()];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results[0]!.passed).toBe(false);
  });
});

// --- Decision Result Determination Tests ---

describe('evaluator: determineDecisionResult', () => {
  it('returns ALLOWED when all rules pass', () => {
    const evaluations = [
      makeRuleEvaluation({ passed: true }),
      makeRuleEvaluation({ passed: true, rule_id: 'r2' }),
    ];
    expect(determineDecisionResult(evaluations)).toBe(DecisionResult.ALLOWED);
  });

  it('returns DENIED when all rules fail', () => {
    const evaluations = [
      makeRuleEvaluation({ passed: false }),
      makeRuleEvaluation({ passed: false, rule_id: 'r2' }),
    ];
    expect(determineDecisionResult(evaluations)).toBe(DecisionResult.DENIED);
  });

  it('returns CONDITIONAL when some rules fail (minority)', () => {
    const evaluations = [
      makeRuleEvaluation({ passed: true }),
      makeRuleEvaluation({ passed: true, rule_id: 'r2' }),
      makeRuleEvaluation({ passed: false, rule_id: 'r3' }),
    ];
    expect(determineDecisionResult(evaluations)).toBe(DecisionResult.CONDITIONAL);
  });

  it('returns DENIED when majority of rules fail', () => {
    const evaluations = [
      makeRuleEvaluation({ passed: false }),
      makeRuleEvaluation({ passed: false, rule_id: 'r2' }),
      makeRuleEvaluation({ passed: true, rule_id: 'r3' }),
    ];
    expect(determineDecisionResult(evaluations)).toBe(DecisionResult.DENIED);
  });

  it('returns MANUAL_REVIEW_REQUIRED when no rules to evaluate', () => {
    expect(determineDecisionResult([])).toBe(DecisionResult.MANUAL_REVIEW_REQUIRED);
  });

  it('returns DENIED when single rule fails', () => {
    const evaluations = [makeRuleEvaluation({ passed: false })];
    expect(determineDecisionResult(evaluations)).toBe(DecisionResult.DENIED);
  });

  it('returns ALLOWED when single rule passes', () => {
    const evaluations = [makeRuleEvaluation({ passed: true })];
    expect(determineDecisionResult(evaluations)).toBe(DecisionResult.ALLOWED);
  });
});

// --- Reason Generation Tests ---

describe('evaluator: generateReasons', () => {
  it('generates reasons from evaluations', () => {
    const evaluations = [
      makeRuleEvaluation({ reason: 'Worker has valid cert' }),
    ];
    const reasons = generateReasons(evaluations);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toBe('Worker has valid cert');
  });

  it('prioritizes failed rule reasons', () => {
    const evaluations = [
      makeRuleEvaluation({ passed: true, reason: 'Passed reason' }),
      makeRuleEvaluation({ passed: false, reason: 'Failed reason', rule_id: 'r2' }),
    ];
    const reasons = generateReasons(evaluations);
    expect(reasons[0]).toBe('Failed reason');
  });

  it('caps reasons at 5 maximum', () => {
    const evaluations = Array.from({ length: 8 }, (_, i) =>
      makeRuleEvaluation({ rule_id: `r${i}`, reason: `Reason ${i}` })
    );
    const reasons = generateReasons(evaluations);
    expect(reasons).toHaveLength(5);
  });

  it('each reason is at most 500 characters', () => {
    const longReason = 'x'.repeat(600);
    const evaluations = [makeRuleEvaluation({ reason: longReason })];
    const reasons = generateReasons(evaluations);
    expect(reasons[0]!.length).toBeLessThanOrEqual(500);
  });
});

// --- Explainability Payload Tests ---

describe('explainability: generateExplainabilityPayload', () => {
  function makeContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
    return {
      decision_type: DecisionType.SITE_ACCESS,
      subject_type: 'worker',
      subject_id: 'worker-123',
      site_id: 'site-456',
      tenant_id: 'tenant-001',
      jurisdiction: 'British Columbia',
      worker_certifications: [makeCertification()],
      policy_version: makePolicyVersion(),
      rule_evaluations: [makeRuleEvaluation()],
      ...overrides,
    };
  }

  it('generates complete payload for valid context', () => {
    const context = makeContext();
    const result = generateExplainabilityPayload(
      DecisionResult.ALLOWED,
      DecisionType.SITE_ACCESS,
      context,
      ['Worker meets all requirements'],
      '2024-06-01T10:00:00.000Z'
    );

    expect(result.success).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload!.decision).toBe(DecisionResult.ALLOWED);
    expect(result.payload!.decision_type).toBe(DecisionType.SITE_ACCESS);
    expect(result.payload!.reasons).toHaveLength(1);
    expect(result.payload!.rule_references).toHaveLength(1);
    expect(result.payload!.evidence_references.length).toBeGreaterThan(0);
    expect(result.payload!.policy_version_references).toContain('pv-001');
    expect(result.payload!.explanation_level).toBe('audit_grade');
  });

  it('blocks finalization when reasons are empty', () => {
    const context = makeContext();
    const result = generateExplainabilityPayload(
      DecisionResult.DENIED,
      DecisionType.SITE_ACCESS,
      context,
      [],
      '2024-06-01T10:00:00.000Z'
    );

    expect(result.success).toBe(false);
    expect(result.missing_fields).toContain('reasons');
  });

  it('blocks finalization when no rule evaluations (no rule_references)', () => {
    const context = makeContext({ rule_evaluations: [] });
    const result = generateExplainabilityPayload(
      DecisionResult.DENIED,
      DecisionType.SITE_ACCESS,
      context,
      ['Some reason'],
      '2024-06-01T10:00:00.000Z'
    );

    expect(result.success).toBe(false);
    expect(result.missing_fields).toContain('rule_references');
  });

  it('blocks finalization when no evidence references', () => {
    const context = makeContext({
      rule_evaluations: [makeRuleEvaluation({
        evidence_type: undefined,
        evidence_reference_id: undefined,
      })],
    });
    const result = generateExplainabilityPayload(
      DecisionResult.DENIED,
      DecisionType.SITE_ACCESS,
      context,
      ['Some reason'],
      '2024-06-01T10:00:00.000Z'
    );

    expect(result.success).toBe(false);
    expect(result.missing_fields).toContain('evidence_references');
  });

  it('includes policy_version_references from context', () => {
    const context = makeContext();
    const result = generateExplainabilityPayload(
      DecisionResult.ALLOWED,
      DecisionType.SITE_ACCESS,
      context,
      ['Reason'],
      '2024-06-01T10:00:00.000Z'
    );

    expect(result.payload!.policy_version_references).toEqual(['pv-001']);
  });

  it('deduplicates evidence references', () => {
    const context = makeContext({
      rule_evaluations: [
        makeRuleEvaluation({ evidence_reference_id: 'cert-001' }),
        makeRuleEvaluation({ rule_id: 'r2', evidence_reference_id: 'cert-001' }),
      ],
    });
    const result = generateExplainabilityPayload(
      DecisionResult.ALLOWED,
      DecisionType.SITE_ACCESS,
      context,
      ['Reason'],
      '2024-06-01T10:00:00.000Z'
    );

    expect(result.payload!.evidence_references).toHaveLength(1);
  });
});

describe('explainability: validateExplainabilityPayload', () => {
  it('validates a complete payload', () => {
    const payload = {
      decision: DecisionResult.ALLOWED,
      decision_type: DecisionType.SITE_ACCESS,
      timestamp: '2024-06-01T10:00:00.000Z',
      reasons: ['Worker meets requirements'],
      rule_references: [{ rule_id: 'r1', rule_name: 'Test', clause: 'c1', source: 's1' }],
      evidence_references: [{ evidence_type: 'certification' as const, reference_id: 'cert-1', description: 'Valid cert' }],
      policy_version_references: ['pv-001'],
      explanation_level: 'audit_grade' as const,
    };

    const result = validateExplainabilityPayload(payload);
    expect(result.valid).toBe(true);
    expect(result.missing_fields).toHaveLength(0);
  });

  it('reports missing reasons', () => {
    const payload = {
      decision: DecisionResult.ALLOWED,
      decision_type: DecisionType.SITE_ACCESS,
      timestamp: '2024-06-01T10:00:00.000Z',
      reasons: [],
      rule_references: [{ rule_id: 'r1', rule_name: 'Test', clause: 'c1', source: 's1' }],
      evidence_references: [{ evidence_type: 'certification' as const, reference_id: 'cert-1', description: 'Valid cert' }],
      policy_version_references: ['pv-001'],
      explanation_level: 'audit_grade' as const,
    };

    const result = validateExplainabilityPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.missing_fields).toContain('reasons');
  });

  it('reports multiple missing fields', () => {
    const payload = {
      decision: DecisionResult.ALLOWED,
      decision_type: DecisionType.SITE_ACCESS,
      timestamp: '2024-06-01T10:00:00.000Z',
      reasons: [],
      rule_references: [],
      evidence_references: [],
      policy_version_references: [],
      explanation_level: 'audit_grade' as const,
    };

    const result = validateExplainabilityPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.missing_fields).toContain('reasons');
    expect(result.missing_fields).toContain('rule_references');
    expect(result.missing_fields).toContain('evidence_references');
    expect(result.missing_fields).toContain('policy_version_references');
  });
});


// --- Handler Event Detection Tests ---

describe('handler: event type detection', () => {
  it('identifies SQS events by Records array and routes to SQS processing', async () => {
    // SQS events have a Records array — the handler should process them
    // via the SQS path (not API Gateway path)
    const sqsEvent = {
      Records: [
        {
          messageId: 'msg-001',
          body: JSON.stringify({
            request: makeDecisionRequest(),
            tenant_id: 'tenant-001',
            correlation_id: 'corr-001',
          }),
          attributes: {},
          messageAttributes: {},
        },
      ],
    };

    // This will throw because DynamoDB is not reachable/authorized in tests,
    // but it proves the handler correctly routes to SQS processing (not
    // returning an API Gateway response object). The exact error class from
    // that failed AWS call is environment-dependent -- CredentialsProviderError
    // with no credentials at all (CI), AccessDeniedException or
    // ResourceNotFoundException with real-but-insufficient/stale local
    // credentials, a generic Error for other SDK config failures -- and isn't
    // itself what this test is verifying, so assert only that the SQS path
    // was actually reached (a plain non-throwing return would mean it wasn't,
    // and must fail this test rather than silently pass with no assertions).
    let threw = false;
    try {
      await handler(sqsEvent);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('identifies API Gateway events by absence of Records', async () => {
    // API Gateway events don't have Records — should return an API response
    const apiEvent = {
      httpMethod: 'POST',
      resource: '/decisions/evaluate',
      headers: {},
      body: null,
      pathParameters: null,
      requestContext: {},
    };

    // Should return 401 because no auth header is present
    const response = await handler(apiEvent as any);
    expect(response).toBeDefined();
    expect((response as any).statusCode).toBe(401);
  });

  it('returns 401 for unauthenticated API requests', async () => {
    const apiEvent = {
      httpMethod: 'GET',
      resource: '/decisions/{id}',
      headers: {},
      pathParameters: { id: 'decision-123' },
      requestContext: {},
    };

    const response = await handler(apiEvent as any);
    expect((response as any).statusCode).toBe(401);
  });

  it('returns bad request for unsupported routes', async () => {
    const apiEvent = {
      httpMethod: 'DELETE',
      resource: '/decisions/{id}',
      headers: {},
      pathParameters: { id: 'decision-123' },
      requestContext: {
        authorizer: {
          claims: {
            sub: 'user-001',
            'custom:tenant_id': 'tenant-001',
            'custom:role': 'platform_admin',
          },
        },
      },
    };

    const response = await handler(apiEvent as any);
    expect((response as any).statusCode).toBe(400);
    const body = JSON.parse((response as any).body);
    expect(body.message).toContain('Unsupported route');
  });
});

// --- Requirement 1.7: No Active Policy Denial Tests ---

describe('evaluator: no active policy denial (Req 1.7)', () => {
  it('evaluateRules returns empty array when no rules exist', () => {
    const policyVersion = makePolicyVersion({ rules: [] });
    const certs = [makeCertification()];
    const results = evaluateRules([], certs, policyVersion);
    expect(results).toHaveLength(0);
  });

  it('determineDecisionResult returns MANUAL_REVIEW_REQUIRED for empty evaluations', () => {
    const result = determineDecisionResult([]);
    expect(result).toBe(DecisionResult.MANUAL_REVIEW_REQUIRED);
  });
});

// --- Requirement 1.6: Comprehensive Input Validation Tests ---

describe('evaluator: comprehensive input validation (Req 1.6)', () => {
  it('validates whitespace-only subject_id as missing', () => {
    const request = makeDecisionRequest({ subject_id: '   ' });
    const result = validateInputs(request);
    expect(result.valid).toBe(false);
    expect(result.missing_inputs).toContain('worker_identity');
  });

  it('validates whitespace-only site_id as missing', () => {
    const request = makeDecisionRequest({ site_id: '   ' });
    const result = validateInputs(request);
    expect(result.valid).toBe(false);
    expect(result.missing_inputs).toContain('site_requirements');
  });

  it('validates whitespace-only jurisdiction as missing', () => {
    const request = makeDecisionRequest({
      context: { jurisdiction: '   ', certifications: [] },
    });
    const result = validateInputs(request);
    expect(result.valid).toBe(false);
    expect(result.missing_inputs).toContain('jurisdiction');
  });

  it('accepts valid non-worker subject types without certifications', () => {
    const request = makeDecisionRequest({
      subject_type: 'finding',
      context: { jurisdiction: 'British Columbia' },
    });
    const result = validateInputs(request);
    expect(result.valid).toBe(true);
  });

  it('returns specific missing input names for each field', () => {
    const request: DecisionRequest = {
      decision_type: '' as DecisionType,
      subject_type: 'worker',
      subject_id: '',
      site_id: '',
      context: {},
    };
    const result = validateInputs(request);
    // Each missing input should be named specifically
    expect(result.missing_inputs).toContain('worker_identity');
    expect(result.missing_inputs).toContain('site_requirements');
    expect(result.missing_inputs).toContain('decision_type');
    expect(result.missing_inputs).toContain('jurisdiction');
    expect(result.missing_inputs).toContain('certifications');
    expect(result.missing_inputs.length).toBe(5);
  });
});

// --- Requirement 1.5: Reason Generation Edge Cases ---

describe('evaluator: reason generation edge cases (Req 1.5)', () => {
  it('truncates reasons with ellipsis at exactly 500 chars', () => {
    const longReason = 'A'.repeat(600);
    const evaluations = [makeRuleEvaluation({ reason: longReason })];
    const reasons = generateReasons(evaluations);
    expect(reasons[0]!.length).toBe(500);
    expect(reasons[0]!.endsWith('...')).toBe(true);
  });

  it('does not truncate reasons at exactly 500 chars', () => {
    const exactReason = 'B'.repeat(500);
    const evaluations = [makeRuleEvaluation({ reason: exactReason })];
    const reasons = generateReasons(evaluations);
    expect(reasons[0]!.length).toBe(500);
    expect(reasons[0]).toBe(exactReason);
  });

  it('generates at least one reason per failed rule (up to max 5)', () => {
    const evaluations = [
      makeRuleEvaluation({ passed: false, reason: 'Failed rule 1', rule_id: 'r1' }),
      makeRuleEvaluation({ passed: false, reason: 'Failed rule 2', rule_id: 'r2' }),
      makeRuleEvaluation({ passed: false, reason: 'Failed rule 3', rule_id: 'r3' }),
    ];
    const reasons = generateReasons(evaluations);
    expect(reasons.length).toBe(3);
    expect(reasons).toContain('Failed rule 1');
    expect(reasons).toContain('Failed rule 2');
    expect(reasons).toContain('Failed rule 3');
  });

  it('returns empty array when no evaluations', () => {
    const reasons = generateReasons([]);
    expect(reasons).toHaveLength(0);
  });
});

// --- Requirement 1.3: Decision Result Boundary Tests ---

describe('evaluator: decision result boundaries (Req 1.3)', () => {
  it('returns CONDITIONAL when exactly 50% of rules fail (2 of 4)', () => {
    const evaluations = [
      makeRuleEvaluation({ passed: true, rule_id: 'r1' }),
      makeRuleEvaluation({ passed: true, rule_id: 'r2' }),
      makeRuleEvaluation({ passed: false, rule_id: 'r3' }),
      makeRuleEvaluation({ passed: false, rule_id: 'r4' }),
    ];
    // 50% failure ratio = 0.5, which is NOT > 0.5, so CONDITIONAL
    expect(determineDecisionResult(evaluations)).toBe(DecisionResult.CONDITIONAL);
  });

  it('returns DENIED when more than 50% of rules fail (3 of 5)', () => {
    const evaluations = [
      makeRuleEvaluation({ passed: true, rule_id: 'r1' }),
      makeRuleEvaluation({ passed: true, rule_id: 'r2' }),
      makeRuleEvaluation({ passed: false, rule_id: 'r3' }),
      makeRuleEvaluation({ passed: false, rule_id: 'r4' }),
      makeRuleEvaluation({ passed: false, rule_id: 'r5' }),
    ];
    // 60% failure ratio > 0.5, so DENIED
    expect(determineDecisionResult(evaluations)).toBe(DecisionResult.DENIED);
  });
});

// --- Generic Rule Conditions Tests ---

describe('evaluator: generic rule conditions', () => {
  const policyVersion = makePolicyVersion();

  it('passes when required_statuses condition is met', () => {
    const rules = [makeRule({
      required_certification_type: undefined,
      conditions: { required_statuses: ['validated'] },
    })];
    const certs = [
      makeCertification({ status: 'validated' }),
      makeCertification({ certification_id: 'cert-002', status: 'validated' }),
    ];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results[0]!.passed).toBe(true);
  });

  it('fails when required_statuses condition is not met', () => {
    const rules = [makeRule({
      required_certification_type: undefined,
      conditions: { required_statuses: ['validated'] },
    })];
    const certs = [
      makeCertification({ status: 'validated' }),
      makeCertification({ certification_id: 'cert-002', status: 'pending' }),
    ];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results[0]!.passed).toBe(false);
  });

  it('passes generic rule with no conditions', () => {
    const rules = [makeRule({
      required_certification_type: undefined,
      conditions: {},
    })];
    const certs = [makeCertification()];

    const results = evaluateRules(rules, certs, policyVersion);
    expect(results[0]!.passed).toBe(true);
  });
});

// --- Explainability Payload Completeness (Req 12.1, 12.3) ---

describe('explainability: evidence references (Req 12.3)', () => {
  function makeContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
    return {
      decision_type: DecisionType.SITE_ACCESS,
      subject_type: 'worker',
      subject_id: 'worker-123',
      site_id: 'site-456',
      tenant_id: 'tenant-001',
      jurisdiction: 'British Columbia',
      worker_certifications: [makeCertification()],
      policy_version: makePolicyVersion(),
      rule_evaluations: [makeRuleEvaluation()],
      ...overrides,
    };
  }

  it('includes certification evidence references', () => {
    const context = makeContext({
      rule_evaluations: [
        makeRuleEvaluation({
          evidence_type: 'certification',
          evidence_reference_id: 'cert-001',
          evidence_description: 'Valid fall_protection certification',
        }),
      ],
    });
    const result = generateExplainabilityPayload(
      DecisionResult.ALLOWED,
      DecisionType.SITE_ACCESS,
      context,
      ['Worker meets requirements'],
      '2024-06-01T10:00:00.000Z'
    );

    expect(result.success).toBe(true);
    const certRef = result.payload!.evidence_references.find(
      (r) => r.evidence_type === 'certification'
    );
    expect(certRef).toBeDefined();
    expect(certRef!.reference_id).toBe('cert-001');
  });

  it('includes policy_version evidence references', () => {
    const context = makeContext({
      rule_evaluations: [
        makeRuleEvaluation({
          evidence_type: 'policy_version',
          evidence_reference_id: 'pv-001',
          evidence_description: 'Policy version 1 rule evaluation',
        }),
      ],
    });
    const result = generateExplainabilityPayload(
      DecisionResult.DENIED,
      DecisionType.SITE_ACCESS,
      context,
      ['Worker does not meet requirements'],
      '2024-06-01T10:00:00.000Z'
    );

    expect(result.success).toBe(true);
    const pvRef = result.payload!.evidence_references.find(
      (r) => r.evidence_type === 'policy_version'
    );
    expect(pvRef).toBeDefined();
    expect(pvRef!.reference_id).toBe('pv-001');
  });

  it('includes multiple distinct evidence references', () => {
    const context = makeContext({
      rule_evaluations: [
        makeRuleEvaluation({
          rule_id: 'r1',
          evidence_type: 'certification',
          evidence_reference_id: 'cert-001',
        }),
        makeRuleEvaluation({
          rule_id: 'r2',
          evidence_type: 'policy_version',
          evidence_reference_id: 'pv-001',
        }),
      ],
    });
    const result = generateExplainabilityPayload(
      DecisionResult.CONDITIONAL,
      DecisionType.SITE_ACCESS,
      context,
      ['Partial compliance'],
      '2024-06-01T10:00:00.000Z'
    );

    expect(result.success).toBe(true);
    expect(result.payload!.evidence_references).toHaveLength(2);
  });

  it('payload contains all required fields for audit_grade', () => {
    const context = makeContext();
    const result = generateExplainabilityPayload(
      DecisionResult.ALLOWED,
      DecisionType.SITE_ACCESS,
      context,
      ['Worker meets all requirements'],
      '2024-06-01T10:00:00.000Z'
    );

    expect(result.success).toBe(true);
    const payload = result.payload!;
    expect(payload.decision).toBeDefined();
    expect(payload.decision_type).toBeDefined();
    expect(payload.timestamp).toBe('2024-06-01T10:00:00.000Z');
    expect(payload.reasons.length).toBeGreaterThan(0);
    expect(payload.rule_references.length).toBeGreaterThan(0);
    expect(payload.evidence_references.length).toBeGreaterThan(0);
    expect(payload.policy_version_references.length).toBeGreaterThan(0);
    expect(payload.explanation_level).toBe('audit_grade');
  });
});
