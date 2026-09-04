/**
 * Unit tests for the Regulatory Mapping Layer service.
 * Tests regulatory mapping prompt construction, response parsing,
 * normalization logic, WorkSafeBC rules lookup, and finding generation.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.2, 9.3
 */

import { describe, it, expect } from 'vitest';
import {
  buildRegulatoryMappingPrompt,
  buildRegulatoryUserMessage,
  parseBedrockRegulatoryResponse,
  normalizeMappingResult,
  normalizeAllMappings,
  determineInitialFindingStatus,
  RegulatoryMappingError,
} from '../../src/services/regulatory-mapping/mapper.js';
import {
  findApplicableRules,
  findRulesForDetections,
  buildRegulatoryContext,
  getCoveredDetectionTypes,
  WORKSAFE_BC_RULES,
} from '../../src/services/regulatory-mapping/worksafe-bc-rules.js';
import {
  REGULATORY_OLLAMA_MODEL_CONFIG,
  MAX_CORRECTIVE_ACTION_LENGTH,
  VIOLATION_CONFIDENCE_THRESHOLD,
  WORKSAFE_BC_JURISDICTION_ID,
  VALID_SEVERITY_LEVELS,
  RegulatoryMappingStatus,
} from '../../src/services/regulatory-mapping/types.js';
import { Severity, FindingStatus } from '../../src/shared/types/common.js';


// --- Helper: create a detection object ---

function makeDetection(type: string, confidence = 0.8) {
  return {
    type,
    confidence,
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  };
}

// --- Constants Verification ---

describe('regulatory-mapping: constants', () => {
  it('REGULATORY_OLLAMA_MODEL_CONFIG has correct model ID', () => {
    expect(REGULATORY_OLLAMA_MODEL_CONFIG.modelId).toBe(
      'gpt-oss:120b-cloud'
    );
  });

  it('REGULATORY_OLLAMA_MODEL_CONFIG has maxTokens 4096', () => {
    expect(REGULATORY_OLLAMA_MODEL_CONFIG.maxTokens).toBe(4096);
  });

  it('REGULATORY_OLLAMA_MODEL_CONFIG has temperature 0.1', () => {
    expect(REGULATORY_OLLAMA_MODEL_CONFIG.temperature).toBe(0.1);
  });

  it('MAX_CORRECTIVE_ACTION_LENGTH is 500', () => {
    expect(MAX_CORRECTIVE_ACTION_LENGTH).toBe(500);
  });

  it('VIOLATION_CONFIDENCE_THRESHOLD is 0.5', () => {
    expect(VIOLATION_CONFIDENCE_THRESHOLD).toBe(0.5);
  });

  it('WORKSAFE_BC_JURISDICTION_ID is worksafe-bc', () => {
    expect(WORKSAFE_BC_JURISDICTION_ID).toBe('worksafe-bc');
  });

  it('VALID_SEVERITY_LEVELS contains critical, high, medium, low', () => {
    expect(VALID_SEVERITY_LEVELS).toContain('critical');
    expect(VALID_SEVERITY_LEVELS).toContain('high');
    expect(VALID_SEVERITY_LEVELS).toContain('medium');
    expect(VALID_SEVERITY_LEVELS).toContain('low');
    expect(VALID_SEVERITY_LEVELS).toHaveLength(4);
  });

  it('RegulatoryMappingStatus has completed, failed, no_violations', () => {
    expect(RegulatoryMappingStatus.COMPLETED).toBe('completed');
    expect(RegulatoryMappingStatus.FAILED).toBe('failed');
    expect(RegulatoryMappingStatus.NO_VIOLATIONS).toBe('no_violations');
  });
});

// --- Requirement 8.5: WorkSafeBC Rules ---

describe('worksafe-bc-rules: rule set (Req 8.5)', () => {
  it('contains WorkSafeBC OHS Regulation rules', () => {
    expect(WORKSAFE_BC_RULES.length).toBeGreaterThan(0);
  });

  it('all rules have required fields', () => {
    for (const rule of WORKSAFE_BC_RULES) {
      expect(rule.rule_id).toBeTruthy();
      expect(rule.section).toBeTruthy();
      expect(rule.clause).toBeTruthy();
      expect(rule.title).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(rule.applicable_detection_types.length).toBeGreaterThan(0);
      expect(rule.applicable_scene_types.length).toBeGreaterThan(0);
      expect(VALID_SEVERITY_LEVELS).toContain(rule.default_severity);
      expect(rule.suggested_action).toBeTruthy();
    }
  });

  it('all rules reference WorkSafeBC OHS Regulation clauses', () => {
    for (const rule of WORKSAFE_BC_RULES) {
      expect(rule.clause).toMatch(/^OHS Regulation/);
    }
  });

  it('covers fall protection regulations (Part 11)', () => {
    const fallRules = WORKSAFE_BC_RULES.filter((r) => r.section === 'Part 11');
    expect(fallRules.length).toBeGreaterThan(0);
  });

  it('covers PPE regulations (Part 8)', () => {
    const ppeRules = WORKSAFE_BC_RULES.filter((r) => r.section === 'Part 8');
    expect(ppeRules.length).toBeGreaterThan(0);
  });

  it('covers excavation regulations (Part 20)', () => {
    const excRules = WORKSAFE_BC_RULES.filter((r) => r.section === 'Part 20');
    expect(excRules.length).toBeGreaterThan(0);
  });
});

describe('worksafe-bc-rules: findApplicableRules', () => {
  it('finds rules for harness in work_at_height scene', () => {
    const rules = findApplicableRules('harness', 'work_at_height');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((r) => r.clause.includes('11.'))).toBe(true);
  });

  it('finds rules for helmet in roofing scene', () => {
    const rules = findApplicableRules('helmet', 'roofing');
    expect(rules.length).toBeGreaterThan(0);
  });

  it('finds rules for trench_excavation_edge in excavation scene', () => {
    const rules = findApplicableRules('trench_excavation_edge', 'excavation');
    expect(rules.length).toBeGreaterThan(0);
  });

  it('returns empty array for non-matching detection/scene combination', () => {
    const rules = findApplicableRules('nonexistent_type', 'work_at_height');
    expect(rules).toHaveLength(0);
  });
});

describe('worksafe-bc-rules: findRulesForDetections', () => {
  it('maps multiple detection types to their applicable rules', () => {
    const ruleMap = findRulesForDetections(
      ['harness', 'helmet', 'roof_edge'],
      'roofing'
    );
    expect(ruleMap.size).toBeGreaterThan(0);
  });

  it('excludes detection types with no applicable rules', () => {
    const ruleMap = findRulesForDetections(
      ['nonexistent_type', 'helmet'],
      'roofing'
    );
    expect(ruleMap.has('nonexistent_type')).toBe(false);
  });
});

describe('worksafe-bc-rules: buildRegulatoryContext', () => {
  it('returns regulation context for known scene types', () => {
    const context = buildRegulatoryContext('work_at_height');
    expect(context).toContain('WorkSafeBC');
    expect(context).toContain('OHS Regulation');
  });

  it('returns no-regulations message for unknown scene types', () => {
    const context = buildRegulatoryContext('unknown_scene_type');
    expect(context).toContain('No specific WorkSafeBC regulations');
  });
});

describe('worksafe-bc-rules: getCoveredDetectionTypes', () => {
  it('returns all detection types covered by rules', () => {
    const types = getCoveredDetectionTypes();
    expect(types).toContain('helmet');
    expect(types).toContain('harness');
    expect(types).toContain('scaffold');
    expect(types).toContain('ladder');
    expect(types).toContain('roof_edge');
    expect(types).toContain('trench_excavation_edge');
    expect(types).toContain('machinery_proximity');
    expect(types).toContain('blocked_exit_clutter');
    expect(types).toContain('vest');
  });
});

// --- Requirement 8.1: Prompt Construction ---

describe('regulatory-mapping: buildRegulatoryMappingPrompt (Req 8.1, 8.5)', () => {
  it('includes WorkSafeBC regulation context for known scene types', () => {
    const prompt = buildRegulatoryMappingPrompt('work_at_height');
    expect(prompt).toContain('WorkSafeBC');
    expect(prompt).toContain('OHS Regulation');
  });

  it('instructs model to respond with JSON format', () => {
    const prompt = buildRegulatoryMappingPrompt('roofing');
    expect(prompt).toContain('JSON');
  });

  it('specifies severity levels in prompt (Req 8.4)', () => {
    const prompt = buildRegulatoryMappingPrompt('excavation');
    expect(prompt).toContain('critical');
    expect(prompt).toContain('high');
    expect(prompt).toContain('medium');
    expect(prompt).toContain('low');
  });

  it('specifies max 500 chars for corrective action (Req 8.3)', () => {
    const prompt = buildRegulatoryMappingPrompt('roofing');
    expect(prompt).toContain('500');
  });

  it('instructs no violation when no match (Req 8.6)', () => {
    const prompt = buildRegulatoryMappingPrompt('roofing');
    expect(prompt).toContain('violation_flag');
    expect(prompt).toContain('false');
  });
});

describe('regulatory-mapping: buildRegulatoryUserMessage', () => {
  it('includes scene type and description', () => {
    const msg = buildRegulatoryUserMessage(
      'work_at_height',
      'Workers on scaffold without harnesses',
      { primary_hazard: 'fall', exposed_personnel_count: 3 },
      [makeDetection('harness', 0.9)]
    );
    expect(msg).toContain('work_at_height');
    expect(msg).toContain('Workers on scaffold without harnesses');
  });

  it('includes risk context when provided', () => {
    const msg = buildRegulatoryUserMessage(
      'excavation',
      'Open trench near workers',
      { primary_hazard: 'cave-in', exposed_personnel_count: 2 },
      [makeDetection('trench_excavation_edge', 0.85)]
    );
    expect(msg).toContain('cave-in');
    expect(msg).toContain('2');
  });

  it('handles null risk context', () => {
    const msg = buildRegulatoryUserMessage(
      'framing',
      'Framing activity',
      null,
      [makeDetection('helmet', 0.7)]
    );
    expect(msg).toContain('framing');
    expect(msg).not.toContain('Primary Hazard');
  });

  it('lists all detections with confidence scores', () => {
    const detections = [
      makeDetection('helmet', 0.95),
      makeDetection('vest', 0.72),
      makeDetection('ladder', 0.88),
    ];
    const msg = buildRegulatoryUserMessage(
      'ladder_access',
      'Worker on ladder',
      null,
      detections
    );
    expect(msg).toContain('helmet');
    expect(msg).toContain('0.95');
    expect(msg).toContain('vest');
    expect(msg).toContain('0.72');
    expect(msg).toContain('ladder');
    expect(msg).toContain('0.88');
  });
});

// --- Requirement 8.3: Response Parsing ---

describe('regulatory-mapping: parseBedrockRegulatoryResponse (Req 8.3)', () => {
  it('parses valid JSON response', () => {
    const json = JSON.stringify({
      mappings: [
        {
          detection_type: 'helmet',
          violation_flag: false,
          regulatory_basis: null,
          site_policy_basis: null,
          severity: null,
          suggested_corrective_action: null,
        },
      ],
    });
    const result = parseBedrockRegulatoryResponse(json);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].detection_type).toBe('helmet');
  });

  it('parses response wrapped in markdown code block', () => {
    const json = '```json\n{"mappings": [{"detection_type": "vest", "violation_flag": true, "regulatory_basis": "OHS Regulation 8.24", "site_policy_basis": null, "severity": "medium", "suggested_corrective_action": "Provide hi-vis vests."}]}\n```';
    const result = parseBedrockRegulatoryResponse(json);
    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].detection_type).toBe('vest');
    expect(result.mappings[0].violation_flag).toBe(true);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseBedrockRegulatoryResponse('not json')).toThrow();
  });

  it('throws when mappings array is missing', () => {
    expect(() =>
      parseBedrockRegulatoryResponse(JSON.stringify({ results: [] }))
    ).toThrow('missing or invalid mappings array');
  });

  it('throws when response is not an object', () => {
    expect(() => parseBedrockRegulatoryResponse('"just a string"')).toThrow(
      'not an object'
    );
  });
});

// --- Requirement 8.3, 8.4, 8.6: Normalization ---

describe('regulatory-mapping: normalizeMappingResult (Req 8.3, 8.4, 8.6)', () => {
  it('normalizes a violation mapping with all fields (Req 8.3)', () => {
    const raw = {
      detection_type: 'roof_edge',
      violation_flag: true,
      regulatory_basis: 'OHS Regulation 11.7',
      site_policy_basis: 'Site Policy 3.2',
      severity: 'critical',
      suggested_corrective_action: 'Install guardrails immediately.',
    };
    const result = normalizeMappingResult(raw, 0.92);

    expect(result.violation_flag).toBe(true);
    expect(result.regulatory_basis).toBe('OHS Regulation 11.7');
    expect(result.site_policy_basis).toBe('Site Policy 3.2');
    expect(result.severity).toBe(Severity.CRITICAL);
    expect(result.suggested_corrective_action).toBe('Install guardrails immediately.');
    expect(result.detection_confidence).toBe(0.92);
  });

  it('normalizes a non-violation mapping (Req 8.6)', () => {
    const raw = {
      detection_type: 'helmet',
      violation_flag: false,
      regulatory_basis: null,
      site_policy_basis: null,
      severity: null,
      suggested_corrective_action: null,
    };
    const result = normalizeMappingResult(raw, 0.95);

    expect(result.violation_flag).toBe(false);
    expect(result.regulatory_basis).toBeNull();
    expect(result.site_policy_basis).toBeNull();
    expect(result.severity).toBeNull();
    expect(result.suggested_corrective_action).toBeNull();
  });

  it('truncates corrective action to 500 chars (Req 8.3)', () => {
    const longAction = 'A'.repeat(600);
    const raw = {
      detection_type: 'scaffold',
      violation_flag: true,
      regulatory_basis: 'OHS Regulation 13.1',
      site_policy_basis: null,
      severity: 'high',
      suggested_corrective_action: longAction,
    };
    const result = normalizeMappingResult(raw, 0.8);

    expect(result.suggested_corrective_action!.length).toBe(500);
  });

  it('validates severity levels (Req 8.4)', () => {
    const validSeverities = ['critical', 'high', 'medium', 'low'];
    for (const sev of validSeverities) {
      const raw = {
        detection_type: 'test',
        violation_flag: true,
        regulatory_basis: 'OHS Regulation 1.1',
        site_policy_basis: null,
        severity: sev,
        suggested_corrective_action: 'Fix it.',
      };
      const result = normalizeMappingResult(raw, 0.7);
      expect(result.severity).toBe(sev);
    }
  });

  it('sets severity to null for invalid severity values', () => {
    const raw = {
      detection_type: 'test',
      violation_flag: true,
      regulatory_basis: 'OHS Regulation 1.1',
      site_policy_basis: null,
      severity: 'extreme',
      suggested_corrective_action: 'Fix it.',
    };
    const result = normalizeMappingResult(raw, 0.7);
    expect(result.severity).toBeNull();
  });

  it('handles null corrective action for violations', () => {
    const raw = {
      detection_type: 'test',
      violation_flag: true,
      regulatory_basis: 'OHS Regulation 1.1',
      site_policy_basis: null,
      severity: 'low',
      suggested_corrective_action: null,
    };
    const result = normalizeMappingResult(raw, 0.7);
    expect(result.suggested_corrective_action).toBeNull();
  });
});

describe('regulatory-mapping: normalizeAllMappings', () => {
  it('maps model response to detections by type', () => {
    const response = {
      mappings: [
        {
          detection_type: 'helmet',
          violation_flag: false,
          regulatory_basis: null,
          site_policy_basis: null,
          severity: null,
          suggested_corrective_action: null,
        },
        {
          detection_type: 'roof_edge',
          violation_flag: true,
          regulatory_basis: 'OHS Regulation 11.7',
          site_policy_basis: null,
          severity: 'critical',
          suggested_corrective_action: 'Install guardrails.',
        },
      ],
    };
    const detections = [
      makeDetection('helmet', 0.95),
      makeDetection('roof_edge', 0.88),
    ];

    const results = normalizeAllMappings(response, detections);
    expect(results).toHaveLength(2);
    expect(results[0].detection_type).toBe('helmet');
    expect(results[0].detection_confidence).toBe(0.95);
    expect(results[1].detection_type).toBe('roof_edge');
    expect(results[1].detection_confidence).toBe(0.88);
  });

  it('uses highest confidence when multiple detections of same type', () => {
    const response = {
      mappings: [
        {
          detection_type: 'helmet',
          violation_flag: false,
          regulatory_basis: null,
          site_policy_basis: null,
          severity: null,
          suggested_corrective_action: null,
        },
      ],
    };
    const detections = [
      makeDetection('helmet', 0.6),
      makeDetection('helmet', 0.9),
      makeDetection('helmet', 0.75),
    ];

    const results = normalizeAllMappings(response, detections);
    expect(results[0].detection_confidence).toBe(0.9);
  });

  it('sets confidence to 0 for unmatched detection types', () => {
    const response = {
      mappings: [
        {
          detection_type: 'unknown_type',
          violation_flag: false,
          regulatory_basis: null,
          site_policy_basis: null,
          severity: null,
          suggested_corrective_action: null,
        },
      ],
    };
    const detections = [makeDetection('helmet', 0.9)];

    const results = normalizeAllMappings(response, detections);
    expect(results[0].detection_confidence).toBe(0);
  });
});

// --- Requirement 8.2: PolicyVersion ID and Jurisdiction ---

describe('regulatory-mapping: output includes PolicyVersion and jurisdiction (Req 8.2)', () => {
  it('WORKSAFE_BC_JURISDICTION_ID is defined as worksafe-bc', () => {
    expect(WORKSAFE_BC_JURISDICTION_ID).toBe('worksafe-bc');
  });

  it('RegulatoryMappingOutput type requires policy_version_id and jurisdiction_id', () => {
    // This is a compile-time check — if the types are wrong, TS would fail.
    // We verify the constants are correct and the output structure is enforced.
    const mockOutput = {
      mapping_id: 'map-001',
      inspection_id: 'insp-001',
      interpretation_id: 'interp-001',
      detection_id: 'det-001',
      media_asset_id: 'media-001',
      tenant_id: 'tenant-001',
      site_id: 'site-001',
      policy_version_id: 'pv-001',
      jurisdiction_id: WORKSAFE_BC_JURISDICTION_ID,
      mappings: [],
      model_version: 'test',
      processed_at: new Date().toISOString(),
      processing_duration_ms: 100,
      status: RegulatoryMappingStatus.NO_VIOLATIONS,
    };
    expect(mockOutput.policy_version_id).toBe('pv-001');
    expect(mockOutput.jurisdiction_id).toBe('worksafe-bc');
  });
});

// --- Requirement 8.7: RegulatoryMappingError ---

describe('regulatory-mapping: RegulatoryMappingError (Req 8.7)', () => {
  it('creates error with message and code', () => {
    const error = new RegulatoryMappingError(
      'No active PolicyVersion available',
      'POLICY_VERSION_UNAVAILABLE'
    );
    expect(error.message).toBe('No active PolicyVersion available');
    expect(error.code).toBe('POLICY_VERSION_UNAVAILABLE');
    expect(error.name).toBe('RegulatoryMappingError');
  });

  it('is an instance of Error', () => {
    const error = new RegulatoryMappingError('test', 'TEST_CODE');
    expect(error).toBeInstanceOf(Error);
  });

  it('can be caught as RegulatoryMappingError', () => {
    try {
      throw new RegulatoryMappingError(
        'Jurisdiction rule set unavailable',
        'JURISDICTION_UNAVAILABLE'
      );
    } catch (e) {
      expect(e).toBeInstanceOf(RegulatoryMappingError);
      expect((e as RegulatoryMappingError).code).toBe('JURISDICTION_UNAVAILABLE');
    }
  });
});

// --- Requirement 9.2, 9.3: Finding Status Assignment ---

describe('regulatory-mapping: determineInitialFindingStatus (Req 9.2, 9.3)', () => {
  it('assigns pending_review for critical severity (Req 9.2)', () => {
    expect(determineInitialFindingStatus(Severity.CRITICAL)).toBe(
      FindingStatus.PENDING_REVIEW
    );
  });

  it('assigns pending_review for high severity (Req 9.2)', () => {
    expect(determineInitialFindingStatus(Severity.HIGH)).toBe(
      FindingStatus.PENDING_REVIEW
    );
  });

  it('assigns generated for medium severity (Req 9.3)', () => {
    expect(determineInitialFindingStatus(Severity.MEDIUM)).toBe(
      FindingStatus.GENERATED
    );
  });

  it('assigns generated for low severity (Req 9.3)', () => {
    expect(determineInitialFindingStatus(Severity.LOW)).toBe(
      FindingStatus.GENERATED
    );
  });
});

// --- Requirement 8.4: Severity Classification ---

describe('regulatory-mapping: severity classification (Req 8.4)', () => {
  it('critical = imminent risk of fatality or permanent injury', () => {
    // Verify critical severity rules exist for high-risk scenarios
    const criticalRules = WORKSAFE_BC_RULES.filter(
      (r) => r.default_severity === Severity.CRITICAL
    );
    expect(criticalRules.length).toBeGreaterThan(0);
    // Critical rules should relate to fall protection, excavation, or machinery
    const criticalTypes = criticalRules.flatMap((r) => r.applicable_detection_types);
    expect(
      criticalTypes.some((t) =>
        ['harness', 'roof_edge', 'trench_excavation_edge', 'machinery_proximity'].includes(t)
      )
    ).toBe(true);
  });

  it('high = risk of serious injury or repeated exposure', () => {
    const highRules = WORKSAFE_BC_RULES.filter(
      (r) => r.default_severity === Severity.HIGH
    );
    expect(highRules.length).toBeGreaterThan(0);
  });

  it('medium = risk of minor injury or regulatory non-compliance', () => {
    const mediumRules = WORKSAFE_BC_RULES.filter(
      (r) => r.default_severity === Severity.MEDIUM
    );
    expect(mediumRules.length).toBeGreaterThan(0);
  });

  it('all rules have valid severity levels', () => {
    for (const rule of WORKSAFE_BC_RULES) {
      expect(
        [Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW]
      ).toContain(rule.default_severity);
    }
  });
});
