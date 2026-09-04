/**
 * CSV Export for compliance reports.
 * Generates CSV-formatted data for download.
 *
 * Requirement 13.4: Support export of compliance summaries in CSV format.
 */

import type {
  DailyComplianceSummary,
  Report,
  AccessDecisionCounts,
  FindingCounts,
  CertificationComplianceItem,
  EnforcementActionSummaryItem,
} from './types.js';

/**
 * Generates a CSV string from a Daily Compliance Summary.
 * Produces multiple sections separated by blank lines.
 */
export function generateDailySummaryCsv(summary: DailyComplianceSummary): string {
  const sections: string[] = [];

  // Header section
  sections.push(buildHeaderSection(summary));

  // Access decisions section
  sections.push(buildAccessDecisionsSection(summary.access_decisions));

  // Findings section
  sections.push(buildFindingsSection(summary.findings));

  // Unresolved enforcement actions section
  sections.push(
    buildEnforcementActionsSection(summary.unresolved_enforcement_actions.actions)
  );

  // Certification compliance section
  sections.push(buildCertificationComplianceSection(summary.certification_compliance));

  // Active policy versions section
  sections.push(buildPolicyVersionsSection(summary));

  // AI narrative section
  sections.push(buildAINarrativeSection(summary));

  return sections.join('\n\n');
}

/**
 * Generates a CSV string for a generic report with tabular data.
 */
export function generateReportCsv(report: Report, data: Record<string, unknown>): string {
  const sections: string[] = [];

  // Report metadata header
  sections.push(
    [
      'Report Metadata',
      `Report ID,${escapeCsvField(report.report_id)}`,
      `Report Type,${escapeCsvField(report.report_type)}`,
      `Site ID,${escapeCsvField(report.site_id)}`,
      `Period Start,${escapeCsvField(report.reporting_period_start)}`,
      `Period End,${escapeCsvField(report.reporting_period_end)}`,
      `Generated At,${escapeCsvField(new Date().toISOString())}`,
    ].join('\n')
  );

  // Data section
  if (Array.isArray(data['records'])) {
    const records = data['records'] as Record<string, unknown>[];
    if (records.length > 0) {
      const headers = Object.keys(records[0]!);
      const rows = records.map((record) =>
        headers.map((h) => escapeCsvField(String(record[h] ?? ''))).join(',')
      );
      sections.push([headers.join(','), ...rows].join('\n'));
    }
  } else {
    // Flatten data as key-value pairs
    const rows = Object.entries(data).map(
      ([key, value]) => `${escapeCsvField(key)},${escapeCsvField(String(value))}`
    );
    sections.push(['Field,Value', ...rows].join('\n'));
  }

  return sections.join('\n\n');
}

// --- Section Builders ---

function buildHeaderSection(summary: DailyComplianceSummary): string {
  const lines = [
    'Daily Compliance Summary',
    `Site ID,${escapeCsvField(summary.site_id)}`,
    `Tenant ID,${escapeCsvField(summary.tenant_id)}`,
    `Reporting Period Start,${escapeCsvField(summary.reporting_period_start)}`,
    `Reporting Period End,${escapeCsvField(summary.reporting_period_end)}`,
    `Generated At,${escapeCsvField(summary.generated_at)}`,
    `No Activity,${summary.no_activity}`,
  ];
  return lines.join('\n');
}

function buildAccessDecisionsSection(counts: AccessDecisionCounts): string {
  const lines = [
    'Access Decisions',
    'Category,Count',
    `Allowed,${counts.allowed}`,
    `Conditional,${counts.conditional}`,
    `Denied,${counts.denied}`,
    `Total,${counts.total}`,
  ];
  return lines.join('\n');
}

function buildFindingsSection(counts: FindingCounts): string {
  const lines = [
    'Safety Findings',
    'Status,Count',
    `Generated,${counts.generated}`,
    `Confirmed,${counts.confirmed}`,
    `Dismissed,${counts.dismissed}`,
    `Pending Review,${counts.pending_review}`,
    `Total,${counts.total}`,
  ];
  return lines.join('\n');
}

function buildEnforcementActionsSection(actions: EnforcementActionSummaryItem[]): string {
  const lines = [
    'Unresolved Enforcement Actions',
    'Action ID,Action Type,Status,Created At,Worker ID,Finding ID',
  ];

  if (actions.length === 0) {
    lines.push('No unresolved enforcement actions');
  } else {
    for (const action of actions) {
      lines.push(
        [
          escapeCsvField(action.enforcement_action_id),
          escapeCsvField(action.action_type),
          escapeCsvField(action.status),
          escapeCsvField(action.created_at),
          escapeCsvField(action.worker_id ?? ''),
          escapeCsvField(action.finding_id ?? ''),
        ].join(',')
      );
    }
  }

  return lines.join('\n');
}

function buildCertificationComplianceSection(items: CertificationComplianceItem[]): string {
  const lines = [
    'Certification Compliance',
    'Worker ID,Worker Name,Certification Type,Status,Compliance Status,Expiry Date',
  ];

  if (items.length === 0) {
    lines.push('No certification data available');
  } else {
    for (const item of items) {
      lines.push(
        [
          escapeCsvField(item.worker_id),
          escapeCsvField(item.worker_name),
          escapeCsvField(item.certification_type),
          escapeCsvField(item.status),
          escapeCsvField(item.compliance_status),
          escapeCsvField(item.expiry_date ?? ''),
        ].join(',')
      );
    }
  }

  return lines.join('\n');
}

function buildPolicyVersionsSection(summary: DailyComplianceSummary): string {
  const lines = [
    'Active Policy Versions',
    'Policy ID,Version ID,Version Number,Effective From,Policy Name',
  ];

  if (summary.active_policy_versions.length === 0) {
    lines.push('No active policy versions');
  } else {
    for (const pv of summary.active_policy_versions) {
      lines.push(
        [
          escapeCsvField(pv.policy_id),
          escapeCsvField(pv.policy_version_id),
          String(pv.version_number),
          escapeCsvField(pv.effective_from),
          escapeCsvField(pv.policy_name ?? ''),
        ].join(',')
      );
    }
  }

  return lines.join('\n');
}

function buildAINarrativeSection(summary: DailyComplianceSummary): string {
  const narrative = summary.ai_narrative;
  const lines = [
    'AI Analysis',
    `Summary,${escapeCsvField(narrative.summary_text)}`,
    `Risk Trend,${escapeCsvField(narrative.risk_trend)}`,
    `Key Observations,${escapeCsvField(narrative.key_observations.join('; '))}`,
    `Regulatory Highlights,${escapeCsvField(narrative.regulatory_highlights.join('; '))}`,
    `Recommended Focus Areas,${escapeCsvField(narrative.recommended_focus_areas.join('; '))}`,
  ];
  return lines.join('\n');
}

// --- Utility ---

/**
 * Escapes a field value for CSV output.
 * Wraps in quotes if the value contains commas, quotes, or newlines.
 */
export function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
