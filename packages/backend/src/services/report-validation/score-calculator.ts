/**
 * Compliance score calculator for report validation.
 * Computes a deterministic score based on severity-weighted deductions from findings.
 *
 * Requirements: 4.5, 4.6
 */

import type { ComplianceFinding, FindingSeverity } from './types.js';

/**
 * Severity-weighted point deductions per finding.
 * - critical: 15 points (regulatory violation)
 * - major: 8 points (significant compliance gap)
 * - minor: 3 points (improvement recommendation)
 * - informational: 0 points (best practice suggestion)
 */
const SEVERITY_DEDUCTIONS: Record<FindingSeverity, number> = {
  critical: 15,
  major: 8,
  minor: 3,
  informational: 0,
};

/**
 * Calculates the compliance score for a set of findings.
 *
 * Starts from a perfect score of 100 and deducts points based on the number
 * and severity of findings. The result is clamped to the [0, 100] range.
 *
 * - Empty findings array returns 100 (no issues found).
 * - Score cannot go below 0 regardless of the number of findings.
 *
 * @param findings - Array of compliance findings from validation
 * @returns Compliance score in the range [0, 100]
 */
export function calculateComplianceScore(findings: ComplianceFinding[]): number {
  const totalDeduction = findings.reduce(
    (sum, finding) => sum + SEVERITY_DEDUCTIONS[finding.severity],
    0
  );

  return Math.max(0, 100 - totalDeduction);
}
