/**
 * Reporting Service domain types.
 * Defines Daily Compliance Summary, Report, and export interfaces.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import { DecisionResult, FindingStatus, CertificationStatus } from '../../shared/types/common.js';

/**
 * Access decision counts for a reporting period.
 * Requirement 13.2: allowed, conditional, denied counts.
 */
export interface AccessDecisionCounts {
  allowed: number;
  conditional: number;
  denied: number;
  total: number;
}

/**
 * AI finding counts for a reporting period.
 * Requirement 13.2: generated, confirmed, dismissed counts.
 */
export interface FindingCounts {
  generated: number;
  confirmed: number;
  dismissed: number;
  pending_review: number;
  total: number;
}

/**
 * Unresolved enforcement action summary.
 * Requirement 13.2: actions not resolved or dismissed by end of reporting period.
 */
export interface UnresolvedEnforcementSummary {
  count: number;
  actions: EnforcementActionSummaryItem[];
}

export interface EnforcementActionSummaryItem {
  enforcement_action_id: string;
  action_type: string;
  status: string;
  created_at: string;
  worker_id?: string;
  finding_id?: string;
}

/**
 * Certification compliance status for a worker.
 * Requirement 13.2: compliant, non_compliant, or expired.
 */
export interface CertificationComplianceItem {
  worker_id: string;
  worker_name: string;
  certification_type: string;
  status: CertificationStatus;
  compliance_status: 'compliant' | 'non_compliant' | 'expired';
  expiry_date?: string;
}

/**
 * AI narrative section for the daily summary.
 */
export interface AINarrative {
  summary_text: string;
  key_observations: string[];
  regulatory_highlights: string[];
  risk_trend: 'improving' | 'stable' | 'worsening';
  recommended_focus_areas: string[];
}

/**
 * Daily Compliance Summary — the main report entity.
 * Requirements: 13.1, 13.2, 13.3
 */
export interface DailyComplianceSummary {
  summary_id: string;
  tenant_id: string;
  site_id: string;
  reporting_period_start: string; // ISO 8601 UTC
  reporting_period_end: string; // ISO 8601 UTC
  generated_at: string; // ISO 8601 UTC
  access_decisions: AccessDecisionCounts;
  findings: FindingCounts;
  unresolved_enforcement_actions: UnresolvedEnforcementSummary;
  certification_compliance: CertificationComplianceItem[];
  active_policy_versions: PolicyVersionReference[];
  ai_narrative: AINarrative;
  no_activity: boolean; // true if no data exists for the period
}

/**
 * Reference to a PolicyVersion active during the reporting period.
 * Requirement 13.3.
 */
export interface PolicyVersionReference {
  policy_id: string;
  policy_version_id: string;
  version_number: number;
  effective_from: string;
  policy_name?: string;
}

/**
 * Report types supported by the reporting service.
 * Requirement 13.5.
 */
export type ReportType =
  | 'daily_compliance_summary'
  | 'access_decision_log'
  | 'certification_compliance_summary'
  | 'inspection_finding_summary'
  | 'worker_compliance_summary';

/**
 * Report status lifecycle.
 */
export type ReportStatus = 'requested' | 'generating' | 'completed' | 'failed';

/**
 * Export format options.
 * Requirement 13.4.
 */
export type ExportFormat = 'pdf' | 'csv';

/**
 * Report entity stored in DynamoDB.
 */
export interface Report {
  report_id: string;
  tenant_id: string;
  site_id: string;
  report_type: ReportType;
  status: ReportStatus;
  format?: ExportFormat;
  reporting_period_start: string;
  reporting_period_end: string;
  requested_by: string;
  requested_at: string;
  completed_at?: string;
  download_url?: string;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Worker compliance summary for GET /workers/{id}/compliance-summary.
 */
export interface WorkerComplianceSummary {
  worker_id: string;
  tenant_id: string;
  worker_name: string;
  overall_status: 'compliant' | 'non_compliant' | 'expired';
  certifications: WorkerCertificationSummary[];
  recent_access_decisions: RecentAccessDecision[];
  active_enforcement_actions: number;
  generated_at: string;
}

export interface WorkerCertificationSummary {
  certification_id: string;
  certification_type: string;
  status: CertificationStatus;
  expiry_date?: string;
  days_until_expiry?: number;
}

export interface RecentAccessDecision {
  decision_id: string;
  site_id: string;
  result: DecisionResult;
  timestamp: string;
  reasons?: string[];
}

/**
 * Request body for POST /reports.
 */
export interface CreateReportRequest {
  site_id: string;
  report_type: ReportType;
  format?: ExportFormat;
  reporting_period_start: string;
  reporting_period_end: string;
}

/**
 * Maximum time (ms) to generate a report.
 * Requirement 13.1, 13.5: within 60 seconds.
 */
export const MAX_REPORT_GENERATION_TIME_MS = 60_000;
