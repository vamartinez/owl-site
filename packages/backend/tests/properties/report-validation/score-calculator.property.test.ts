// Feature: ai-report-validation, Property 6: Compliance score calculation

/**
 * Property-based tests for compliance score calculator.
 *
 * Property 6: For any array of ComplianceFinding objects, `calculateComplianceScore(findings)`
 * SHALL return a value equal to max(0, 100 - (15 × critical_count + 8 × major_count +
 * 3 × minor_count + 0 × informational_count)), and the result SHALL always be in the
 * range [0, 100].
 *
 * **Validates: Requirements 4.5, 4.6**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ComplianceFinding, FindingSeverity } from '../../../src/services/report-validation/types.js';
import { calculateComplianceScore } from '../../../src/services/report-validation/score-calculator.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_SEVERITIES: FindingSeverity[] = ['critical', 'major', 'minor', 'informational'];

const SEVERITY_DEDUCTIONS: Record<FindingSeverity, number> = {
  critical: 15,
  major: 8,
  minor: 3,
  informational: 0,
};

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for any valid FindingSeverity */
const arbSeverity: fc.Arbitrary<FindingSeverity> = fc.constantFrom(...ALL_SEVERITIES);

/** Arbitrary for a RegulationReference */
const arbRegulationReference = fc.record({
  title: fc.string({ minLength: 1, maxLength: 100 }),
  section: fc.string({ minLength: 1, maxLength: 50 }),
  url: fc.option(fc.webUrl(), { nil: undefined }),
});

/** Arbitrary for a ComplianceFinding */
const arbComplianceFinding: fc.Arbitrary<ComplianceFinding> = fc.record({
  finding_id: fc.uuid(),
  severity: arbSeverity,
  description: fc.string({ minLength: 1, maxLength: 500 }),
  report_section: fc.string({ minLength: 1, maxLength: 100 }),
  suggested_correction: fc.string({ minLength: 1, maxLength: 500 }),
  regulation_references: fc.array(arbRegulationReference, { minLength: 1, maxLength: 3 }),
});

/** Arbitrary for an array of ComplianceFinding objects (0 to 50 findings) */
const arbFindings: fc.Arbitrary<ComplianceFinding[]> = fc.array(arbComplianceFinding, {
  minLength: 0,
  maxLength: 50,
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Reference implementation of the expected score calculation.
 * Computes max(0, 100 - sum of severity-weighted deductions).
 */
function expectedScore(findings: ComplianceFinding[]): number {
  const totalDeduction = findings.reduce(
    (sum, finding) => sum + SEVERITY_DEDUCTIONS[finding.severity],
    0
  );
  return Math.max(0, 100 - totalDeduction);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Score Calculator Property Tests', () => {
  // **Validates: Requirements 4.5, 4.6**
  describe('Property 6: Compliance score calculation', () => {
    it('calculateComplianceScore returns max(0, 100 - weighted deductions) for any findings array', () => {
      fc.assert(
        fc.property(arbFindings, (findings) => {
          const result = calculateComplianceScore(findings);
          const expected = expectedScore(findings);

          expect(result).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('score is always in the range [0, 100]', () => {
      fc.assert(
        fc.property(arbFindings, (findings) => {
          const result = calculateComplianceScore(findings);

          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(100);
        }),
        { numRuns: 100 },
      );
    });

    it('empty findings array returns a score of 100', () => {
      fc.assert(
        fc.property(fc.constant([] as ComplianceFinding[]), (findings) => {
          const result = calculateComplianceScore(findings);

          expect(result).toBe(100);
        }),
        { numRuns: 100 },
      );
    });

    it('informational findings do not reduce the score', () => {
      fc.assert(
        fc.property(
          fc.array(
            arbComplianceFinding.map((f) => ({ ...f, severity: 'informational' as FindingSeverity })),
            { minLength: 1, maxLength: 50 },
          ),
          (findings) => {
            const result = calculateComplianceScore(findings);

            expect(result).toBe(100);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('each critical finding deducts exactly 15 points', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (count) => {
            const findings: ComplianceFinding[] = Array.from({ length: count }, (_, i) => ({
              finding_id: `finding-${i}`,
              severity: 'critical' as FindingSeverity,
              description: 'Critical issue',
              report_section: 'Section 1',
              suggested_correction: 'Fix it',
              regulation_references: [{ title: 'Reg', section: '1.1' }],
            }));

            const result = calculateComplianceScore(findings);
            const expected = Math.max(0, 100 - 15 * count);

            expect(result).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('each major finding deducts exactly 8 points', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (count) => {
            const findings: ComplianceFinding[] = Array.from({ length: count }, (_, i) => ({
              finding_id: `finding-${i}`,
              severity: 'major' as FindingSeverity,
              description: 'Major issue',
              report_section: 'Section 1',
              suggested_correction: 'Fix it',
              regulation_references: [{ title: 'Reg', section: '1.1' }],
            }));

            const result = calculateComplianceScore(findings);
            const expected = Math.max(0, 100 - 8 * count);

            expect(result).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('each minor finding deducts exactly 3 points', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          (count) => {
            const findings: ComplianceFinding[] = Array.from({ length: count }, (_, i) => ({
              finding_id: `finding-${i}`,
              severity: 'minor' as FindingSeverity,
              description: 'Minor issue',
              report_section: 'Section 1',
              suggested_correction: 'Fix it',
              regulation_references: [{ title: 'Reg', section: '1.1' }],
            }));

            const result = calculateComplianceScore(findings);
            const expected = Math.max(0, 100 - 3 * count);

            expect(result).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('score never goes below 0 regardless of the number of findings', () => {
      fc.assert(
        fc.property(
          fc.array(arbComplianceFinding, { minLength: 10, maxLength: 50 }),
          (findings) => {
            const result = calculateComplianceScore(findings);

            expect(result).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('score is monotonically non-increasing as findings are added', () => {
      fc.assert(
        fc.property(
          arbFindings.filter((f) => f.length >= 1),
          (findings) => {
            // Score with all findings should be <= score with subset (all but last)
            const fullScore = calculateComplianceScore(findings);
            const subsetScore = calculateComplianceScore(findings.slice(0, -1));

            expect(fullScore).toBeLessThanOrEqual(subsetScore);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
