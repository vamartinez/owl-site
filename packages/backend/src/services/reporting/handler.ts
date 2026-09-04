/**
 * Reporting Service Lambda Handler.
 * Handles reporting endpoints and SQS consumer for DailyComplianceSummaryRequested events.
 *
 * Endpoints:
 * - GET /sites/{id}/daily-summary — Get daily compliance summary
 * - POST /reports — Request report generation
 * - GET /reports/{id} — Get generated report
 * - GET /reports/{id}/export — Export report (PDF/CSV)
 * - GET /workers/{id}/compliance-summary — Worker compliance summary
 *
 * SQS Consumer:
 * - DailyComplianceSummaryRequested — Generate and store daily summary
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent } from '../../shared/auth-middleware.js';
import { enforcePermission } from '../../shared/rbac.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { publishEvent } from '../../shared/event-publisher.js';
import { EventTypes } from '../../shared/types/events.js';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { buildFilterExpression } from '../../shared/filter-utils.js';
import { computeSiteCompliance } from '../../shared/site-compliance.js';
import {
  generateDailyComplianceSummary,
  generateWorkerComplianceSummary,
} from './summary-generator.js';
import { generateDailySummaryPdf, generateReportPdf } from './pdf-export.js';
import { generateDailySummaryCsv, generateReportCsv } from './csv-export.js';
import type {
  Report,
  ReportType,
  ExportFormat,
  DailyComplianceSummary,
  CreateReportRequest,
} from './types.js';

// --- Zod Schemas ---

const createReportSchema = z.object({
  site_id: z.string().min(1, 'site_id is required'),
  report_type: z.enum([
    'daily_compliance_summary',
    'access_decision_log',
    'certification_compliance_summary',
    'inspection_finding_summary',
    'worker_compliance_summary',
  ]),
  format: z.enum(['pdf', 'csv']).optional(),
  reporting_period_start: z.string().min(1, 'reporting_period_start is required'),
  reporting_period_end: z.string().min(1, 'reporting_period_end is required'),
});

// --- SQS Event Types ---

interface SQSEvent {
  Records: SQSRecord[];
}

interface SQSRecord {
  body: string;
  messageId: string;
  receiptHandle: string;
}

// --- Lambda Handler ---

/**
 * Main handler that routes between API Gateway events and SQS events.
 */
export async function handler(
  event: ApiGatewayEvent | SQSEvent
): Promise<ApiGatewayResponse | void> {
  // Detect SQS event
  if ('Records' in event && Array.isArray((event as SQSEvent).Records)) {
    return handleSqsEvent(event as SQSEvent);
  }

  // Handle API Gateway event
  return handleApiEvent(event as ApiGatewayEvent);
}

// --- SQS Consumer ---

/**
 * Processes DailyComplianceSummaryRequested events from SQS.
 * Requirement 13.1: Generate within 60s of request.
 */
async function handleSqsEvent(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body) as {
        event_type?: string;
        payload?: {
          site_id?: string;
          tenant_id?: string;
          reporting_period_start?: string;
          reporting_period_end?: string;
        };
      };

      if (message.event_type === EventTypes.DAILY_COMPLIANCE_SUMMARY_REQUESTED) {
        const payload = message.payload;
        if (!payload?.site_id || !payload?.tenant_id || !payload?.reporting_period_start || !payload?.reporting_period_end) {
          console.error('Invalid DailyComplianceSummaryRequested payload:', payload);
          continue;
        }

        const summary = await generateDailyComplianceSummary(
          payload.tenant_id,
          payload.site_id,
          payload.reporting_period_start,
          payload.reporting_period_end
        );

        // Publish DailyComplianceSummaryGenerated event
        await publishEvent({
          event_type: EventTypes.DAILY_COMPLIANCE_SUMMARY_GENERATED,
          source_service: 'reporting',
          tenant_id: payload.tenant_id,
          payload: {
            summary_id: summary.summary_id,
            site_id: summary.site_id,
            tenant_id: summary.tenant_id,
            reporting_period_start: summary.reporting_period_start,
            reporting_period_end: summary.reporting_period_end,
            generated_at: summary.generated_at,
          },
        });

        console.log(
          `Generated daily compliance summary ${summary.summary_id} for site ${payload.site_id}`
        );
      }
    } catch (error) {
      console.error('Error processing SQS record:', error);
      throw error; // Re-throw to trigger DLQ after retries
    }
  }
}

// --- API Gateway Handler ---

async function handleApiEvent(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    const resource = (event as Record<string, unknown>)['resource'] as string;
    const pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;
    const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;

    // Authenticate
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    // Route to appropriate handler
    if (httpMethod === 'GET' && resource === '/sites/{id}/daily-summary') {
      const siteId = pathParameters?.['id'];
      if (!siteId) return badRequest('Site ID is required');
      return handleGetDailySummary(user, siteId, queryStringParameters);
    }

    if (httpMethod === 'POST' && resource === '/reports') {
      return handleCreateReport(event, user);
    }

    if (httpMethod === 'GET' && resource === '/reports/{id}') {
      const reportId = pathParameters?.['id'];
      if (!reportId) return badRequest('Report ID is required');
      return handleGetReport(user, reportId);
    }

    if (httpMethod === 'GET' && resource === '/reports/{id}/export') {
      const reportId = pathParameters?.['id'];
      if (!reportId) return badRequest('Report ID is required');
      const format = (queryStringParameters?.['format'] ?? 'pdf') as ExportFormat;
      return handleExportReport(user, reportId, format);
    }

    if (httpMethod === 'GET' && resource === '/workers/{id}/compliance-summary') {
      const workerId = pathParameters?.['id'];
      if (!workerId) return badRequest('Worker ID is required');
      return handleGetWorkerComplianceSummary(user, workerId);
    }

    if (httpMethod === 'GET' && resource === '/dashboard/kpis') {
      return handleDashboardKpis(user);
    }

    if (httpMethod === 'GET' && resource === '/dashboard/risks') {
      return handleDashboardRisks(user);
    }

    if (httpMethod === 'GET' && resource === '/dashboard/blocked-access') {
      return handleDashboardBlockedAccess(user);
    }

    if (httpMethod === 'GET' && resource === '/dashboard/expiring-certs') {
      return handleDashboardExpiringCerts(user);
    }

    if (httpMethod === 'GET' && resource === '/reports/compliance-summary') {
      return handleComplianceSummary(user);
    }

    if (httpMethod === 'GET' && resource === '/reports/site-access-logs') {
      return handleSiteAccessLogs(user, queryStringParameters);
    }

    return badRequest('Unsupported route');
  } catch (error) {
    console.error('Reporting handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// --- Route Handlers ---

/**
 * GET /sites/{id}/daily-summary
 * Returns the most recent daily compliance summary for a site.
 * Optionally accepts date query parameter for a specific day.
 */
async function handleGetDailySummary(
  user: { user_id: string; tenant_id: string; role: string },
  siteId: string,
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:read'
  );
  if (permError) return permError;

  const date = queryParams?.['date'];
  let summary: DailyComplianceSummary | null = null;

  if (date) {
    // Get summary for specific date
    summary = await getSummaryByDate(user.tenant_id, siteId, date);
  } else {
    // Get most recent summary
    summary = await getMostRecentSummary(user.tenant_id, siteId);
  }

  if (!summary) {
    // Generate on-demand if not found
    const now = new Date();
    const periodEnd = now.toISOString();
    const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    summary = await generateDailyComplianceSummary(
      user.tenant_id,
      siteId,
      periodStart,
      periodEnd
    );
  }

  return createSuccessResponse(200, { summary });
}

/**
 * POST /reports
 * Requests generation of a new report.
 * Requirement 13.5: Generate within 60s of request.
 */
async function handleCreateReport(
  event: ApiGatewayEvent,
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:generate'
  );
  if (permError) return permError;

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = createReportSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const input = validation.data as CreateReportRequest;

  // Validate date range
  const start = new Date(input.reporting_period_start);
  const end = new Date(input.reporting_period_end);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return badRequest('Invalid date format. Use ISO 8601 format.');
  }
  if (end <= start) {
    return badRequest('reporting_period_end must be after reporting_period_start');
  }

  // Create report record
  const report: Report = {
    report_id: uuidv4(),
    tenant_id: user.tenant_id,
    site_id: input.site_id,
    report_type: input.report_type,
    status: 'generating',
    format: input.format,
    reporting_period_start: input.reporting_period_start,
    reporting_period_end: input.reporting_period_end,
    requested_by: user.user_id,
    requested_at: new Date().toISOString(),
  };

  await storeReport(report);

  // Generate the report synchronously (within 60s requirement)
  try {
    const summary = await generateDailyComplianceSummary(
      user.tenant_id,
      input.site_id,
      input.reporting_period_start,
      input.reporting_period_end
    );

    // Update report as completed
    report.status = 'completed';
    report.completed_at = new Date().toISOString();
    report.metadata = { summary_id: summary.summary_id };
    await storeReport(report);

    return createSuccessResponse(201, { report, summary });
  } catch (error) {
    // Mark report as failed
    report.status = 'failed';
    report.error_message = error instanceof Error ? error.message : 'Unknown error';
    await storeReport(report);

    console.error('Report generation failed:', error);
    return internalError('Report generation failed');
  }
}

/**
 * GET /reports/{id}
 * Gets a generated report by ID.
 */
async function handleGetReport(
  user: { user_id: string; tenant_id: string; role: string },
  reportId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:read'
  );
  if (permError) return permError;

  const report = await getReport(user.tenant_id, reportId);
  if (!report) {
    return notFound('Report not found');
  }

  return createSuccessResponse(200, { report });
}

/**
 * GET /reports/{id}/export
 * Exports a report in PDF or CSV format.
 * Requirement 13.4: Support PDF and CSV export.
 */
async function handleExportReport(
  user: { user_id: string; tenant_id: string; role: string },
  reportId: string,
  format: ExportFormat
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:export'
  );
  if (permError) return permError;

  if (format !== 'pdf' && format !== 'csv') {
    return badRequest('Format must be "pdf" or "csv"');
  }

  const report = await getReport(user.tenant_id, reportId);
  if (!report) {
    return notFound('Report not found');
  }

  if (report.status !== 'completed') {
    return badRequest('Report is not yet completed', { status: report.status });
  }

  // Get the associated summary data
  const summaryId = (report.metadata as Record<string, unknown>)?.['summary_id'] as string | undefined;
  let summary: DailyComplianceSummary | null = null;

  if (summaryId) {
    summary = await getSummaryById(user.tenant_id, report.site_id, summaryId);
  }

  if (!summary) {
    // Regenerate if summary not found
    summary = await generateDailyComplianceSummary(
      user.tenant_id,
      report.site_id,
      report.reporting_period_start,
      report.reporting_period_end
    );
  }

  if (format === 'pdf') {
    const pdfBuffer = generateDailySummaryPdf(summary);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="report-${reportId}.pdf"`,
        'Access-Control-Allow-Origin': '*',
      },
      body: pdfBuffer.toString('base64'),
    };
  }

  // CSV format
  const csvContent = generateDailySummaryCsv(summary);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="report-${reportId}.csv"`,
      'Access-Control-Allow-Origin': '*',
    },
    body: csvContent,
  };
}

/**
 * GET /workers/{id}/compliance-summary
 * Gets a worker's compliance summary.
 */
async function handleGetWorkerComplianceSummary(
  user: { user_id: string; tenant_id: string; role: string },
  workerId: string
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:read'
  );
  if (permError) return permError;

  const summary = await generateWorkerComplianceSummary(user.tenant_id, workerId);
  if (!summary) {
    return notFound('Worker not found');
  }

  return createSuccessResponse(200, { summary });
}

/**
 * GET /dashboard/kpis
 * Returns key performance indicators for the executive dashboard.
 * Queries Workers, Certifications, Findings, and ScanSessions tables.
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */
async function handleDashboardKpis(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:read'
  );
  if (permError) return permError;

  const tenantId = user.tenant_id;

  // Query active workers count
  const workersResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Workers'),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':active': 'active',
      },
      Select: 'COUNT',
    })
  );
  const totalActiveWorkers = workersResult.Count ?? 0;

  // Query certifications expiring within 30 days
  const now = new Date();
  const today = now.toISOString().split('T')[0]!;
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]!;

  const expiringCertsResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Certifications'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':start': `CERT#${today}`,
        ':end': `CERT#${thirtyDaysFromNow}`,
      },
      Select: 'COUNT',
    })
  );
  const certsExpiringIn30Days = expiringCertsResult.Count ?? 0;

  // Query unresolved findings (pendingFindings)
  const findingsResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Findings'),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#status <> :resolved',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':resolved': 'resolved',
      },
      Select: 'COUNT',
    })
  );
  const pendingFindings = findingsResult.Count ?? 0;

  // Query unresolved enforcements
  const enforcementsResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Findings'),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#status = :open AND #severity = :critical',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#severity': 'severity',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':open': 'open',
        ':critical': 'critical',
      },
      Select: 'COUNT',
    })
  );
  const unresolvedEnforcements = enforcementsResult.Count ?? 0;

  // Compute 7-day compliance trend from ScanSessions
  const complianceTrend: Array<{ date: string; value: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const dayDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dayStr = dayDate.toISOString().split('T')[0]!;
    const dayStart = `${dayStr}T00:00:00.000Z`;
    const dayEnd = `${dayStr}T23:59:59.999Z`;

    const dayResult = await docClient.send(
      new QueryCommand({
        TableName: getTableName('ScanSessions'),
        KeyConditionExpression: 'PK = :pk',
        FilterExpression: '#ts BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':start': dayStart,
          ':end': dayEnd,
        },
      })
    );

    const sessions = dayResult.Items ?? [];
    const totalSessions = sessions.length;
    const allowedSessions = sessions.filter(
      (s: Record<string, unknown>) => s['result'] === 'allowed'
    ).length;

    const compliancePercent =
      totalSessions > 0 ? Math.round((allowedSessions / totalSessions) * 100) : 100;

    complianceTrend.push({ date: dayStr, value: compliancePercent });
  }

  // Compute overall site compliance percent (average of last 7 days)
  const trendValues = complianceTrend.map((t) => t.value);
  const siteCompliancePercent =
    trendValues.length > 0
      ? Math.round(trendValues.reduce((a, b) => a + b, 0) / trendValues.length)
      : 100;

  return createSuccessResponse(200, {
    totalActiveWorkers,
    siteCompliancePercent,
    pendingFindings,
    unresolvedEnforcements,
    certsExpiringIn30Days,
    complianceTrend,
  });
}

/**
 * GET /dashboard/expiring-certs
 * Returns certifications expiring within 30 days for the dashboard.
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */
async function handleDashboardExpiringCerts(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:read'
  );
  if (permError) return permError;

  const tenantId = user.tenant_id;
  const now = new Date();
  const today = now.toISOString().split('T')[0]!;
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]!;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Certifications'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':start': `CERT#${today}`,
        ':end': `CERT#${thirtyDaysFromNow}`,
      },
    })
  );

  const certifications = (result.Items ?? []).map((item: Record<string, unknown>) => {
    const expiryDate = item['expiry_date'] as string;
    const expiryMs = new Date(expiryDate).getTime();
    const nowMs = now.getTime();
    const daysRemaining = Math.max(0, Math.ceil((expiryMs - nowMs) / (1000 * 60 * 60 * 24)));

    return {
      id: item['certification_id'] as string,
      workerName: item['worker_name'] as string,
      certType: item['cert_type'] as string,
      expiryDate,
      daysRemaining,
    };
  });

  return createSuccessResponse(200, { certifications, total: certifications.length });
}

/**
 * GET /dashboard/blocked-access
 * Returns today's blocked access events (denied scan sessions) for the dashboard.
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */
async function handleDashboardBlockedAccess(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:read'
  );
  if (permError) return permError;

  const tenantId = user.tenant_id;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('ScanSessions'),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#result = :denied AND #ts >= :todayStart',
      ExpressionAttributeNames: {
        '#result': 'result',
        '#ts': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':denied': 'denied',
        ':todayStart': todayStart,
      },
    })
  );

  const events = (result.Items ?? []).map((item: Record<string, unknown>) => ({
    id: item['session_id'] as string ?? '',
    workerName: item['worker_name'] as string ?? '',
    site: item['site_name'] as string ?? item['site_id'] as string ?? '',
    reason: item['reason'] as string ?? (item['reasons'] as string[] ?? [])[0] ?? '',
    timestamp: item['timestamp'] as string ?? item['check_in_time'] as string ?? '',
  }));

  return createSuccessResponse(200, { events, total: events.length });
}

/**
 * GET /dashboard/risks
 * Returns open safety risks (unresolved findings) for the dashboard.
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */
async function handleDashboardRisks(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:read'
  );
  if (permError) return permError;

  const tenantId = user.tenant_id;

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Findings'),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#status <> :resolved',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':resolved': 'resolved',
      },
    })
  );

  const risks = (result.Items ?? []).map((item: Record<string, unknown>) => ({
    id: item['finding_id'] as string ?? '',
    title: item['title'] as string ?? item['description'] as string ?? '',
    severity: item['severity'] as string ?? '',
    site: item['site_name'] as string ?? item['site_id'] as string ?? '',
    createdAt: item['created_at'] as string ?? '',
  }));

  return createSuccessResponse(200, { risks, total: risks.length });
}

/**
 * GET /reports/compliance-summary
 * Returns platform-wide compliance summary report.
 * Computes overall compliance percent, site breakdown, and 30-day trend.
 * Requirements: 15.1, 15.2, 15.3, 15.4
 */
async function handleComplianceSummary(
  user: { user_id: string; tenant_id: string; role: string }
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:read'
  );
  if (permError) return permError;

  const tenantId = user.tenant_id;
  const now = new Date();

  // Query total sites
  const sitesResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Sites'),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
      },
    })
  );
  const sites = sitesResult.Items ?? [];
  const totalSites = sites.length;

  // Query workers
  const workersResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Workers'),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':active': 'active',
      },
    })
  );
  const workers = workersResult.Items ?? [];

  // Query certifications to determine compliance
  const certsResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName('Certifications'),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
      },
    })
  );
  const certifications = certsResult.Items ?? [];

  // Determine non-compliant workers (workers with expired or missing required certs)
  const today = now.toISOString().split('T')[0]!;
  const expiredCertWorkerIds = new Set(
    certifications
      .filter((c: Record<string, unknown>) => {
        const expiry = c['expiry_date'] as string | undefined;
        return expiry && expiry < today;
      })
      .map((c: Record<string, unknown>) => c['worker_id'] as string)
  );
  const nonCompliantWorkers = expiredCertWorkerIds.size;

  // Compute per-site compliance based on scan sessions
  const bySite: Array<{ site: string; percent: number }> = [];
  let compliantSites = 0;

  for (const site of sites) {
    const siteName = site['site_name'] as string ?? site['site_id'] as string ?? '';
    const siteId = site['site_id'] as string ?? '';

    const { compliancePercent: sitePercent } = await computeSiteCompliance(
      tenantId,
      siteId,
      site as Record<string, unknown>
    );

    bySite.push({ site: siteName, percent: sitePercent });
    if (sitePercent >= 80) compliantSites++;
  }

  // Compute 30-day compliance trend from ScanSessions
  const trend: Array<{ date: string; value: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const dayDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dayStr = dayDate.toISOString().split('T')[0]!;
    const dayStart = `${dayStr}T00:00:00.000Z`;
    const dayEnd = `${dayStr}T23:59:59.999Z`;

    const dayResult = await docClient.send(
      new QueryCommand({
        TableName: getTableName('ScanSessions'),
        KeyConditionExpression: 'PK = :pk',
        FilterExpression: '#ts BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':start': dayStart,
          ':end': dayEnd,
        },
      })
    );

    const sessions = dayResult.Items ?? [];
    const totalSessions = sessions.length;
    const allowedSessions = sessions.filter(
      (s: Record<string, unknown>) => s['result'] === 'allowed'
    ).length;

    const compliancePercent =
      totalSessions > 0 ? Math.round((allowedSessions / totalSessions) * 100) : 100;

    trend.push({ date: dayStr, value: compliancePercent });
  }

  // Compute overall compliance percent (average of 30-day trend)
  const trendValues = trend.map((t) => t.value);
  const overallPercent =
    trendValues.length > 0
      ? Math.round(trendValues.reduce((a, b) => a + b, 0) / trendValues.length)
      : 100;

  return createSuccessResponse(200, {
    overallPercent,
    totalSites,
    compliantSites,
    nonCompliantWorkers,
    trend,
    bySite,
  });
}

/**
 * GET /reports/site-access-logs
 * Returns filterable site access log entries for the reports section.
 * Supports optional search (worker name), decision, and period filters.
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */
async function handleSiteAccessLogs(
  user: { user_id: string; tenant_id: string; role: string },
  queryStringParameters: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const permError = enforcePermission(
    user as Parameters<typeof enforcePermission>[0],
    'reports:read'
  );
  if (permError) return permError;

  const search = queryStringParameters?.['search'];
  const decision = queryStringParameters?.['decision'];
  const period = queryStringParameters?.['period'];

  const filterResult = buildFilterExpression({ search, decision, period });

  const queryParams: Record<string, unknown> = {
    TableName: getTableName('ScanSessions'),
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `TENANT#${user.tenant_id}`,
    },
  };

  if (filterResult.filterExpression) {
    queryParams['FilterExpression'] = filterResult.filterExpression;
    queryParams['ExpressionAttributeNames'] = filterResult.expressionAttributeNames;
    queryParams['ExpressionAttributeValues'] = {
      ...(queryParams['ExpressionAttributeValues'] as Record<string, unknown>),
      ...filterResult.expressionAttributeValues,
    };
  }

  const result = await docClient.send(new QueryCommand(queryParams as ConstructorParameters<typeof QueryCommand>[0]));

  const logs = (result.Items ?? []).map((item: Record<string, unknown>) => ({
    id: item['session_id'] as string ?? '',
    workerName: item['worker_name'] as string ?? '',
    site: item['site_name'] as string ?? item['site_id'] as string ?? '',
    decision: item['result'] as string ?? '',
    timestamp: item['timestamp'] as string ?? item['check_in_time'] as string ?? '',
    method: item['method'] as string ?? item['scan_method'] as string ?? 'manual',
    operator: item['operator'] as string ?? item['operator_name'] as string ?? '',
  }));

  return createSuccessResponse(200, { logs, total: logs.length });
}

// --- Data Access ---

async function storeReport(report: Report): Promise<void> {
  const tableName = getTableName('Reports');

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `TENANT#${report.tenant_id}`,
        SK: `REPORT#${report.report_id}`,
        GSI1PK: `TENANT#${report.tenant_id}#SITE#${report.site_id}`,
        GSI1SK: report.requested_at,
        ...report,
      },
    })
  );
}

async function getReport(tenantId: string, reportId: string): Promise<Report | null> {
  const tableName = getTableName('Reports');

  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `REPORT#${reportId}`,
      },
    })
  );

  return (result.Item as Report) ?? null;
}

async function getSummaryByDate(
  tenantId: string,
  siteId: string,
  date: string
): Promise<DailyComplianceSummary | null> {
  const tableName = getTableName('DailyComplianceSummaries');

  // Query for summaries on the given date
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#SITE#${siteId}`,
        ':start': dayStart,
        ':end': dayEnd,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
  );

  return (result.Items?.[0] as DailyComplianceSummary) ?? null;
}

async function getMostRecentSummary(
  tenantId: string,
  siteId: string
): Promise<DailyComplianceSummary | null> {
  const tableName = getTableName('DailyComplianceSummaries');

  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#SITE#${siteId}`,
      },
      ScanIndexForward: false,
      Limit: 1,
    })
  );

  return (result.Items?.[0] as DailyComplianceSummary) ?? null;
}

async function getSummaryById(
  tenantId: string,
  siteId: string,
  summaryId: string
): Promise<DailyComplianceSummary | null> {
  const tableName = getTableName('DailyComplianceSummaries');

  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: `TENANT#${tenantId}#SITE#${siteId}`,
        SK: `SUMMARY#${summaryId}`,
      },
    })
  );

  return (result.Item as DailyComplianceSummary) ?? null;
}

// --- Helper Functions ---

function parseBody(event: ApiGatewayEvent): Record<string, unknown> | null {
  const body = (event as Record<string, unknown>)['body'];
  if (!body) return null;

  try {
    if (typeof body === 'string') {
      return JSON.parse(body) as Record<string, unknown>;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
