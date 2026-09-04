import type { ReportStatus, FindingSeverity, ComplianceFinding } from './types';

export type ReportAction = 'request_validation' | 'upload_version' | 'submit';
export type ScoreColor = 'green' | 'yellow' | 'red';

/**
 * Determines which actions are available for a report based on its current status.
 *
 * Rules:
 * - 'draft' → "Request Validation" and "Submit"
 * - 'validating' → no actions (processing in progress)
 * - 'validated' → "Upload New Version" and "Submit"
 * - 'submitted' → no actions (terminal state)
 */
export function getAvailableActions(status: ReportStatus): ReportAction[] {
  switch (status) {
    case 'draft':
      return ['request_validation', 'submit'];
    case 'validating':
      return [];
    case 'validated':
      return ['upload_version', 'submit'];
    case 'submitted':
      return [];
  }
}

/**
 * Returns the color classification for a compliance score.
 * - green: 80-100 (good compliance)
 * - yellow: 50-79 (moderate compliance)
 * - red: 0-49 (poor compliance)
 */
export function getScoreColor(score: number): ScoreColor {
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

/**
 * Returns the estimated validation time in seconds based on document page count.
 * - 1-5 pages: 30 seconds
 * - 6-20 pages: 60 seconds
 * - 21+ pages: 90 seconds
 */
export function getEstimatedTimeSeconds(pageCount: number): number {
  if (pageCount <= 5) return 30;
  if (pageCount <= 20) return 60;
  return 90;
}

const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'major', 'minor', 'informational'];

/**
 * Groups compliance findings by severity level in descending order
 * (critical first, then major, minor, informational).
 * Empty groups are filtered out from the result.
 */
export function groupFindingsBySeverity(
  findings: ComplianceFinding[]
): { severity: FindingSeverity; findings: ComplianceFinding[] }[] {
  return SEVERITY_ORDER
    .map((severity) => ({
      severity,
      findings: findings.filter((f) => f.severity === severity),
    }))
    .filter((group) => group.findings.length > 0);
}
