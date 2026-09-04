/**
 * Report Validation Service utility functions.
 * Provides helpers for status actions, time estimation, score display,
 * findings grouping, RBAC visibility, S3 key construction, and text validation.
 *
 * Requirements: 2.4, 3.1, 4.5, 5.1, 5.2, 8.5, 8.6, 10.3, 13.4
 */

import { Role } from '../../shared/types/common.js';
import type {
  ReportStatus,
  FindingSeverity,
  ComplianceFinding,
  KBDocumentCategory,
} from './types.js';

/**
 * Actions available to the user on a report.
 */
export type ReportAction = 'request_validation' | 'upload_version' | 'submit';

/**
 * Returns the list of actions available for a given report status.
 *
 * - draft: can request validation or submit directly
 * - validating: no actions (processing in progress)
 * - validated: can upload a new version or submit
 * - submitted: no actions (terminal state)
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
 * Color classification for compliance scores.
 */
export type ScoreColor = 'green' | 'yellow' | 'red';

/**
 * Returns the color classification for a compliance score.
 *
 * - green: 80–100 (good compliance)
 * - yellow: 50–79 (needs improvement)
 * - red: 0–49 (significant issues)
 */
export function getScoreColor(score: number): ScoreColor {
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

/**
 * Returns the estimated validation time in seconds based on document page count.
 *
 * - 1–5 pages: 30 seconds
 * - 6–20 pages: 60 seconds
 * - 21+ pages: 90 seconds
 */
export function getEstimatedTimeSeconds(pageCount: number): number {
  if (pageCount <= 5) return 30;
  if (pageCount <= 20) return 60;
  return 90;
}

/**
 * Severity ordering for findings display (most severe first).
 */
const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'major', 'minor', 'informational'];

/**
 * Groups findings by severity in descending order (critical first).
 * Empty groups are filtered out.
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

/**
 * Visibility scope for report access based on user role.
 */
export type VisibilityScope = 'own' | 'site' | 'tenant';

/**
 * Returns the report visibility scope for a given role.
 *
 * - tenant: tenant_admin and cso can see all reports in their tenant
 * - site: site_admin and supervisor can see reports for their assigned sites
 * - own: all other roles can only see their own reports
 */
export function getReportVisibilityScope(role: Role): VisibilityScope {
  switch (role) {
    case Role.TENANT_ADMIN:
    case Role.CSO:
      return 'tenant';
    case Role.SITE_ADMIN:
    case Role.SUPERVISOR:
      return 'site';
    default:
      return 'own';
  }
}

/**
 * Builds the S3 key for a Knowledge Base context document.
 * Format: {category_prefix}/{documentId}/{fileName}
 */
export function buildKBDocumentS3Key(
  category: KBDocumentCategory,
  documentId: string,
  fileName: string
): string {
  const prefixMap: Record<KBDocumentCategory, string> = {
    worksafebc: 'worksafebc',
    'bc-building-code': 'bc-building-code',
    'safety-standards': 'safety-standards',
    'canada-general': 'canada-general',
  };
  return `${prefixMap[category]}/${documentId}/${fileName}`;
}

/**
 * Checks if extracted text meets the minimum threshold for validation.
 * Documents must contain at least 50 characters to be considered sufficient.
 */
export function isTextSufficient(text: string): boolean {
  return text.length >= 50;
}
