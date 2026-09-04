// Feature: ai-report-validation, Property 8: Score color classification (frontend)
// Feature: ai-report-validation, Property 9: Findings grouped by severity order (frontend)
// Feature: ai-report-validation, Property 14: Estimated validation time by page count (frontend)

/**
 * Property-based tests for frontend utility functions.
 *
 * Property 8: For any integer score in [0, 100], `getScoreColor(score)` SHALL return
 * "green" if score ≥ 80, "yellow" if 50 ≤ score < 80, and "red" if score < 50.
 *
 * Property 9: For any array of ComplianceFinding objects, `groupFindingsBySeverity(findings)`
 * SHALL produce groups ordered as [critical, major, minor, informational], each group containing
 * exactly the findings with that severity, and the total count across all groups SHALL equal
 * the input array length.
 *
 * Property 14: For any positive integer page count, `getEstimatedTimeSeconds(pageCount)`
 * SHALL return 30 for pages 1-5, 60 for pages 6-20, and 90 for pages 21 or more.
 *
 * **Validates: Requirements 5.1, 5.2, 10.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getScoreColor, groupFindingsBySeverity, getEstimatedTimeSeconds } from '../utils';
import type { ComplianceFinding, FindingSeverity } from '../types';

// ─── Generators ───────────────────────────────────────────────────────────────

const SEVERITIES: FindingSeverity[] = ['critical', 'major', 'minor', 'informational'];

const arbSeverity = fc.constantFrom<FindingSeverity>(...SEVERITIES);

const arbRegulationReference = fc.record({
  title: fc.string({ minLength: 1, maxLength: 100 }),
  section: fc.string({ minLength: 1, maxLength: 50 }),
  url: fc.option(fc.webUrl(), { nil: undefined }),
});

const arbComplianceFinding: fc.Arbitrary<ComplianceFinding> = fc.record({
  finding_id: fc.uuid(),
  severity: arbSeverity,
  description: fc.string({ minLength: 1, maxLength: 500 }),
  report_section: fc.string({ minLength: 1, maxLength: 100 }),
  suggested_correction: fc.string({ minLength: 1, maxLength: 500 }),
  regulation_references: fc.array(arbRegulationReference, { minLength: 1, maxLength: 3 }),
});

const arbFindingsArray = fc.array(arbComplianceFinding, { minLength: 0, maxLength: 60 });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Frontend Utility Property Tests', () => {
  // **Validates: Requirements 5.1**
  describe('Property 8: Score color classification', () => {
    it('returns "green" for any score >= 80', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 80, max: 100 }),
          (score) => {
            expect(getScoreColor(score)).toBe('green');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns "yellow" for any score in [50, 79]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 50, max: 79 }),
          (score) => {
            expect(getScoreColor(score)).toBe('yellow');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns "red" for any score < 50', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 49 }),
          (score) => {
            expect(getScoreColor(score)).toBe('red');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('classifies any integer score in [0, 100] into exactly one of green/yellow/red', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          (score) => {
            const color = getScoreColor(score);
            expect(['green', 'yellow', 'red']).toContain(color);

            // Verify the classification matches the specification
            if (score >= 80) {
              expect(color).toBe('green');
            } else if (score >= 50) {
              expect(color).toBe('yellow');
            } else {
              expect(color).toBe('red');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 5.2**
  describe('Property 9: Findings grouped by severity order', () => {
    it('groups are ordered as [critical, major, minor, informational]', () => {
      fc.assert(
        fc.property(
          arbFindingsArray,
          (findings) => {
            const groups = groupFindingsBySeverity(findings);
            const EXPECTED_ORDER: FindingSeverity[] = ['critical', 'major', 'minor', 'informational'];

            // Verify the order of returned groups follows the expected severity order
            const groupSeverities = groups.map((g) => g.severity);
            const expectedFiltered = EXPECTED_ORDER.filter((s) =>
              findings.some((f) => f.severity === s)
            );
            expect(groupSeverities).toEqual(expectedFiltered);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('each group contains exactly the findings with that severity', () => {
      fc.assert(
        fc.property(
          arbFindingsArray,
          (findings) => {
            const groups = groupFindingsBySeverity(findings);

            for (const group of groups) {
              // All findings in the group have the correct severity
              for (const finding of group.findings) {
                expect(finding.severity).toBe(group.severity);
              }

              // The group contains all findings of that severity from the input
              const expectedFindings = findings.filter((f) => f.severity === group.severity);
              expect(group.findings).toHaveLength(expectedFindings.length);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('total count across all groups equals the input array length', () => {
      fc.assert(
        fc.property(
          arbFindingsArray,
          (findings) => {
            const groups = groupFindingsBySeverity(findings);
            const totalCount = groups.reduce((sum, g) => sum + g.findings.length, 0);
            expect(totalCount).toBe(findings.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('empty groups are filtered out from the result', () => {
      fc.assert(
        fc.property(
          arbFindingsArray,
          (findings) => {
            const groups = groupFindingsBySeverity(findings);

            // Every returned group must have at least one finding
            for (const group of groups) {
              expect(group.findings.length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 10.3**
  describe('Property 14: Estimated validation time by page count', () => {
    it('returns 30 seconds for any page count in [1, 5]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          (pageCount) => {
            expect(getEstimatedTimeSeconds(pageCount)).toBe(30);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns 60 seconds for any page count in [6, 20]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 6, max: 20 }),
          (pageCount) => {
            expect(getEstimatedTimeSeconds(pageCount)).toBe(60);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns 90 seconds for any page count >= 21', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 21, max: 10000 }),
          (pageCount) => {
            expect(getEstimatedTimeSeconds(pageCount)).toBe(90);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('maps any positive integer page count to exactly one of 30, 60, or 90 seconds', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10000 }),
          (pageCount) => {
            const time = getEstimatedTimeSeconds(pageCount);
            expect([30, 60, 90]).toContain(time);

            // Verify the classification matches the specification
            if (pageCount <= 5) {
              expect(time).toBe(30);
            } else if (pageCount <= 20) {
              expect(time).toBe(60);
            } else {
              expect(time).toBe(90);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
