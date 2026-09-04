/**
 * PDF Report Generation.
 * Uses PDFKit to generate compliance reports in PDF format.
 *
 * Requirement 13.4: Support export of compliance summaries in PDF format.
 */

import PDFDocument from 'pdfkit';
import type { DailyComplianceSummary, Report } from './types.js';

/**
 * Generates a PDF buffer from a Daily Compliance Summary.
 */
export function generateDailySummaryPdf(summary: DailyComplianceSummary): Buffer {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks: Buffer[] = [];

  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // Header
  doc
    .fontSize(20)
    .font('Helvetica-Bold')
    .text('Daily Compliance Summary', { align: 'center' });
  doc.moveDown(0.5);

  // Site and period info
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(`Site ID: ${summary.site_id}`, { align: 'center' });
  doc.text(
    `Reporting Period: ${formatDate(summary.reporting_period_start)} — ${formatDate(summary.reporting_period_end)}`,
    { align: 'center' }
  );
  doc.text(`Generated: ${formatDate(summary.generated_at)}`, { align: 'center' });
  doc.moveDown(1);

  // No activity indicator
  if (summary.no_activity) {
    doc
      .fontSize(12)
      .font('Helvetica-Oblique')
      .text('No activity was recorded for this site during the reporting period.', {
        align: 'center',
      });
    doc.end();
    return Buffer.concat(chunks);
  }

  // Divider
  drawDivider(doc);

  // Access Decisions Section
  doc.fontSize(14).font('Helvetica-Bold').text('Access Decisions');
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Total: ${summary.access_decisions.total}`);
  doc.text(`  Allowed: ${summary.access_decisions.allowed}`);
  doc.text(`  Conditional: ${summary.access_decisions.conditional}`);
  doc.text(`  Denied: ${summary.access_decisions.denied}`);
  doc.moveDown(0.8);

  // Findings Section
  doc.fontSize(14).font('Helvetica-Bold').text('Safety Findings');
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Total: ${summary.findings.total}`);
  doc.text(`  Generated: ${summary.findings.generated}`);
  doc.text(`  Confirmed: ${summary.findings.confirmed}`);
  doc.text(`  Dismissed: ${summary.findings.dismissed}`);
  doc.text(`  Pending Review: ${summary.findings.pending_review}`);
  doc.moveDown(0.8);

  // Unresolved Enforcement Actions
  doc.fontSize(14).font('Helvetica-Bold').text('Unresolved Enforcement Actions');
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Count: ${summary.unresolved_enforcement_actions.count}`);
  if (summary.unresolved_enforcement_actions.actions.length > 0) {
    for (const action of summary.unresolved_enforcement_actions.actions.slice(0, 10)) {
      doc.text(`  • ${action.action_type} (${action.status}) — Created: ${formatDate(action.created_at)}`);
    }
    if (summary.unresolved_enforcement_actions.actions.length > 10) {
      doc.text(`  ... and ${summary.unresolved_enforcement_actions.actions.length - 10} more`);
    }
  }
  doc.moveDown(0.8);

  // Certification Compliance
  doc.fontSize(14).font('Helvetica-Bold').text('Certification Compliance');
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica');
  const compliant = summary.certification_compliance.filter(
    (c) => c.compliance_status === 'compliant'
  ).length;
  const nonCompliant = summary.certification_compliance.filter(
    (c) => c.compliance_status === 'non_compliant'
  ).length;
  const expired = summary.certification_compliance.filter(
    (c) => c.compliance_status === 'expired'
  ).length;
  doc.text(`Compliant: ${compliant} | Non-Compliant: ${nonCompliant} | Expired: ${expired}`);
  doc.moveDown(0.8);

  // Active Policy Versions
  if (summary.active_policy_versions.length > 0) {
    doc.fontSize(14).font('Helvetica-Bold').text('Active Policy Versions');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica');
    for (const pv of summary.active_policy_versions) {
      doc.text(
        `  • ${pv.policy_name ?? pv.policy_id} v${pv.version_number} (effective: ${formatDate(pv.effective_from)})`
      );
    }
    doc.moveDown(0.8);
  }

  // AI Narrative
  drawDivider(doc);
  doc.fontSize(14).font('Helvetica-Bold').text('AI Analysis Summary');
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica');
  doc.text(summary.ai_narrative.summary_text);
  doc.moveDown(0.5);

  if (summary.ai_narrative.key_observations.length > 0) {
    doc.font('Helvetica-Bold').text('Key Observations:');
    doc.font('Helvetica');
    for (const obs of summary.ai_narrative.key_observations) {
      doc.text(`  • ${obs}`);
    }
    doc.moveDown(0.3);
  }

  if (summary.ai_narrative.regulatory_highlights.length > 0) {
    doc.font('Helvetica-Bold').text('Regulatory Highlights:');
    doc.font('Helvetica');
    for (const highlight of summary.ai_narrative.regulatory_highlights) {
      doc.text(`  • ${highlight}`);
    }
    doc.moveDown(0.3);
  }

  doc.font('Helvetica-Bold').text(`Risk Trend: `);
  doc.font('Helvetica').text(summary.ai_narrative.risk_trend, { continued: false });
  doc.moveDown(0.3);

  if (summary.ai_narrative.recommended_focus_areas.length > 0) {
    doc.font('Helvetica-Bold').text('Recommended Focus Areas:');
    doc.font('Helvetica');
    for (const area of summary.ai_narrative.recommended_focus_areas) {
      doc.text(`  • ${area}`);
    }
  }

  doc.end();
  return Buffer.concat(chunks);
}

/**
 * Generates a generic report PDF based on report metadata and data.
 */
export function generateReportPdf(report: Report, data: Record<string, unknown>): Buffer {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks: Buffer[] = [];

  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  // Header
  doc
    .fontSize(18)
    .font('Helvetica-Bold')
    .text(formatReportTitle(report.report_type), { align: 'center' });
  doc.moveDown(0.5);

  doc
    .fontSize(10)
    .font('Helvetica')
    .text(`Site ID: ${report.site_id}`, { align: 'center' });
  doc.text(
    `Period: ${formatDate(report.reporting_period_start)} — ${formatDate(report.reporting_period_end)}`,
    { align: 'center' }
  );
  doc.text(`Generated: ${formatDate(new Date().toISOString())}`, { align: 'center' });
  doc.moveDown(1);

  drawDivider(doc);

  // Render data as key-value pairs
  doc.fontSize(10).font('Helvetica');
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null) {
      doc.font('Helvetica-Bold').text(`${formatKey(key)}:`);
      doc.font('Helvetica').text(JSON.stringify(value, null, 2));
      doc.moveDown(0.3);
    } else {
      doc.text(`${formatKey(key)}: ${String(value)}`);
    }
  }

  doc.end();
  return Buffer.concat(chunks);
}

// --- Helper Functions ---

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return isoDate;
  }
}

function formatReportTitle(reportType: string): string {
  return reportType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatKey(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function drawDivider(doc: PDFKit.PDFDocument): void {
  doc.moveDown(0.5);
  doc
    .strokeColor('#cccccc')
    .lineWidth(0.5)
    .moveTo(50, doc.y)
    .lineTo(545, doc.y)
    .stroke();
  doc.moveDown(0.5);
}
