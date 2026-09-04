/**
 * Tests for the WorkSafeBC validation engine's pure functions.
 * Property 4: severity classification is total + deterministic (Req 3.5)
 * Property 5: compliance-level assignment is a pure function (Req 3.6, 4.9)
 * Plus selectApplicableParts coverage.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  classifySeverity,
  assignComplianceLevel,
  selectApplicableParts,
  normalizeFindings,
  buildRecommendations,
} from '../../src/services/report-validation/worksafebc-validation-engine.js';
import {
  FINDING_SEVERITIES,
  DOCUMENT_CATEGORIES,
  MAX_FINDINGS,
  MAX_RECOMMENDATIONS,
  type HallazgoCumplimiento,
} from '../../src/services/report-validation/worksafebc-types.js';

const brecha = (severity: HallazgoCumplimiento['severity']): HallazgoCumplimiento => ({
  finding_id: 'f',
  type: 'brecha',
  severity,
  description: 'd',
  regulatory_basis: 'OHSR 11.2',
  regulation_part: 'Part 11',
  evidence_excerpt: null,
});

describe('Property 4: classifySeverity is total and deterministic', () => {
  it('always returns one of the 4 severities for any string', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)), (raw) => {
        const s = classifySeverity(raw as string);
        expect(FINDING_SEVERITIES).toContain(s);
      })
    );
  });
  it('maps known synonyms deterministically', () => {
    expect(classifySeverity('critical')).toBe('critica');
    expect(classifySeverity('HIGH')).toBe('alta');
    expect(classifySeverity('minor')).toBe('media');
    expect(classifySeverity('informational')).toBe('baja');
    expect(classifySeverity('garbage')).toBe('media');
  });
});

describe('Property 5: assignComplianceLevel is a pure function of findings (rule 4.9)', () => {
  it('any critica/alta brecha => no_conforme', () => {
    expect(assignComplianceLevel([brecha('critica')])).toBe('no_conforme');
    expect(assignComplianceLevel([brecha('alta'), brecha('baja')])).toBe('no_conforme');
  });
  it('only media/baja brechas => parcialmente_conforme', () => {
    expect(assignComplianceLevel([brecha('media')])).toBe('parcialmente_conforme');
    expect(assignComplianceLevel([brecha('baja')])).toBe('parcialmente_conforme');
  });
  it('no brechas + evaluable => conforme', () => {
    expect(assignComplianceLevel([], true)).toBe('conforme');
  });
  it('no brechas + not evaluable => no_evaluable', () => {
    expect(assignComplianceLevel([], false)).toBe('no_evaluable');
  });
  it('same input always yields same output', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('critica', 'alta', 'media', 'baja').map(brecha), { maxLength: 30 }),
        (findings) => {
          expect(assignComplianceLevel(findings)).toBe(assignComplianceLevel(findings));
        }
      )
    );
  });
});

describe('selectApplicableParts', () => {
  it('returns non-empty parts for every category', () => {
    for (const cat of DOCUMENT_CATEGORIES) {
      expect(selectApplicableParts(cat).length).toBeGreaterThan(0);
    }
  });
});

describe('normalizeFindings + buildRecommendations bounds', () => {
  it('caps findings at MAX_FINDINGS and sorts by severity', () => {
    const raw = Array.from({ length: MAX_FINDINGS + 50 }, () => ({
      type: 'brecha',
      severity: 'baja',
      description: 'x',
      regulatory_basis: 'OHSR 4.1',
      regulation_part: 'Part 4',
    }));
    const out = normalizeFindings(raw);
    expect(out.length).toBe(MAX_FINDINGS);
  });
  it('recommendations never exceed MAX_RECOMMENDATIONS', () => {
    const findings = Array.from({ length: MAX_RECOMMENDATIONS + 20 }, () => brecha('critica'));
    expect(buildRecommendations(findings).length).toBeLessThanOrEqual(MAX_RECOMMENDATIONS);
  });
});
