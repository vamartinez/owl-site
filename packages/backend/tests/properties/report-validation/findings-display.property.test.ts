// Feature: ai-report-validation, Property 9: Findings grouped by severity order

/**
 * Property-based tests for findings display grouping.
 *
 * Property 9: For any array of ComplianceFinding objects, `groupFindingsBySeverity(findings)`
 * SHALL produce groups ordered as [critical, major, minor, informational], each group containing
 * exactly the findings with that severity, and the total count across all groups SHALL equal
 * the input array length.
 *
 * **Validates: Requirements 5.2, 5.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { groupFindingsBySeverity } from '../../../src/services/report-validation/utils.js';
import type { ComplianceFinding, FindingSeverity } from '../../../src/services/report-validation/types.js';

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

describe('Findings Display Property Tests', () => {
  // **Validates: Requirements 5.2, 5.4**
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

    it('returns empty array for empty input', () => {
      const groups = groupFindingsBySeverity([]);
      expect(groups).toEqual([]);
    });
  });
});
