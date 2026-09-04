/**
 * Incident Export Service Handler.
 * Generates CSV/PDF exports for incident data, OSHA Form 300 logs,
 * WorkSafeBC emergency summaries, and OSHA Form 300A annual summaries.
 *
 * Routes:
 * - POST /incidents/export — Operational CSV export with filters
 * - POST /incidents/{id}/worksafebc-summary/export — WorkSafeBC PDF export
 * - GET /incidents/osha-300a — OSHA Form 300A annual summary
 *
 * Requirements: 10.3, 17.1, 17.2, 17.3, 17.4
 */

import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent, AuthenticatedUser } from '../../shared/auth-middleware.js';
import { Role } from '../../shared/types/common.js';
import {
  createSuccessResponse,
  badRequest,
  forbidden,
  notFound,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { listIncidents, listBySite, getIncident } from './incident-repository.js';
import type { IncidentRecord, OshaRecordingData, OshaCaseOutcome } from './types.js';

// --- Permission constants for export module (Req 21.3) ---

/** Roles that can export data */
const EXPORT_ROLES: Role[] = [
  Role.TENANT_ADMIN,
  Role.CSO,
  Role.SUPERVISOR,
];

const INCIDENTS_TABLE = 'Incidents';
const REGULATORY_DATA_TABLE = 'IncidentRegulatoryData';

// --- Lambda Handler ---

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
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

    // Req 21.3: Only specific roles can export
    if (!EXPORT_ROLES.includes(user.role)) {
      return forbidden('You do not have permission to perform this action');
    }

    // Route matching
    return routeRequest(event, httpMethod, resource, pathParameters, queryStringParameters, user);
  } catch (error) {
    console.error('Export handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

// --- Route Dispatcher ---

function routeRequest(
  event: ApiGatewayEvent,
  httpMethod: string,
  resource: string,
  pathParameters: Record<string, string> | null,
  queryStringParameters: Record<string, string> | null,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // POST /incidents/export — Operational CSV export
  if (httpMethod === 'POST' && resource === '/incidents/export') {
    return handleOperationalExport(event, user);
  }

  // POST /incidents/{id}/worksafebc-summary/export — WorkSafeBC PDF export
  if (httpMethod === 'POST' && resource === '/incidents/{id}/worksafebc-summary/export') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleWorksafebcExport(user, incidentId);
  }

  // GET /incidents/osha-300a — OSHA Form 300A annual summary
  if (httpMethod === 'GET' && resource === '/incidents/osha-300a') {
    return handleOsha300aSummary(user, queryStringParameters);
  }

  return Promise.resolve(badRequest('Unsupported route'));
}

// --- Export Interfaces ---

interface ExportFilters {
  date_range?: { start: string; end: string };
  status?: string;
  site_id?: string;
  regulatory_flag?: string;
  format?: 'operational' | 'osha_300';
}

interface Osha300ARecord {
  year: number;
  total_cases: number;
  total_deaths: number;
  total_days_away: number;
  total_restricted_work: number;
  total_job_transfer: number;
  total_other_recordable: number;
  total_days_away_count: number;
  total_days_restricted_count: number;
}

// --- Route Implementations ---

/**
 * POST /incidents/export
 * Generates a UTF-8 CSV with filtered incidents or OSHA Form 300 data.
 * Includes metadata header: generation date, period, filters, user.
 *
 * Requirements: 17.1, 17.2, 17.4
 */
export async function handleOperationalExport(
  event: ApiGatewayEvent,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const filters: ExportFilters = {
    date_range: body['date_range'] as ExportFilters['date_range'],
    status: body['status'] as string | undefined,
    site_id: body['site_id'] as string | undefined,
    regulatory_flag: body['regulatory_flag'] as string | undefined,
    format: (body['format'] as string | undefined) as ExportFilters['format'] ?? 'operational',
  };

  try {
    // Fetch incidents matching filters
    const incidents = await fetchFilteredIncidents(user, filters);

    if (filters.format === 'osha_300') {
      // Req 17.2: OSHA Form 300 CSV export
      const oshaData = await fetchOshaRecordingData(user.tenant_id, incidents);
      const csv = generateOsha300Csv(oshaData, filters, user);
      return createSuccessResponse(200, {
        content_type: 'text/csv',
        charset: 'utf-8',
        filename: `osha-form-300-${new Date().toISOString().split('T')[0]}.csv`,
        content: csv,
        record_count: oshaData.length,
      });
    }

    // Req 17.1: Operational CSV export
    const csv = generateOperationalCsv(incidents, filters, user);
    return createSuccessResponse(200, {
      content_type: 'text/csv',
      charset: 'utf-8',
      filename: `incidents-export-${new Date().toISOString().split('T')[0]}.csv`,
      content: csv,
      record_count: incidents.length,
    });
  } catch (error) {
    console.error('Export generation failed:', error);
    return internalError('Failed to generate export');
  }
}

/**
 * POST /incidents/{id}/worksafebc-summary/export
 * Generates a PDF document (structured JSON) with WorkSafeBC emergency summary data.
 *
 * Requirements: 8.2, 17.3
 */
export async function handleWorksafebcExport(
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // Fetch WorkSafeBC emergency summary data from regulatory data table
  const summaryData = await fetchWorksafebcSummary(incidentId);

  const now = new Date().toISOString();

  // Req 8.2, 17.3: Generate structured PDF content
  const pdfContent = {
    document_type: 'worksafebc_emergency_summary',
    metadata: {
      generation_date: now,
      generated_by: user.email ?? user.user_id,
      incident_id: incidentId,
      disclaimer: 'The regulatory suggestions provided by this system are operational support and do not constitute legal advice. Consult with a qualified legal professional to determine your specific regulatory obligations.',
    },
    content: {
      title: 'WorkSafeBC Emergency Notification Summary',
      incident_reference: incident.incident_id,
      incident_title: incident.title,
      incident_datetime: incident.incident_datetime,
      location: incident.location,
      site_id: incident.site_id,
      description: incident.description.substring(0, 500),
      persons_involved_count: incident.persons_involved_count,
      severity: incident.severity,
      regulatory_flag: incident.regulatory_flag,
      reporting_user: incident.reporting_user_name,
      report_datetime: incident.report_datetime,
      ...(summaryData && {
        employer_contact: summaryData.employer_name,
        employer_phone: summaryData.employer_phone,
        worker_name: summaryData.worker_name,
        worker_occupation: summaryData.worker_occupation,
        body_part_affected: summaryData.body_part_affected,
        nature_of_injury: summaryData.nature_of_injury,
      }),
    },
    missing_fields: getMissingWorksafebcFields(incident, summaryData),
  };

  return createSuccessResponse(200, {
    content_type: 'application/pdf',
    filename: `worksafebc-summary-${incidentId}-${now.split('T')[0]}.pdf`,
    pdf_content: pdfContent,
    generation_date: now,
    generated_by: user.email ?? user.user_id,
  });
}

/**
 * GET /incidents/osha-300a
 * Calculates annual summary totals by outcome category for OSHA Form 300A.
 *
 * Requirements: 10.3
 */
export async function handleOsha300aSummary(
  user: AuthenticatedUser,
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const yearParam = queryParams?.['year'];
  if (!yearParam) {
    return badRequest('Year parameter is required');
  }

  const year = parseInt(yearParam, 10);
  if (isNaN(year) || year < 2000 || year > 2100) {
    return badRequest('Year must be a valid year between 2000 and 2100');
  }

  try {
    // Fetch all incidents for the tenant in the given year
    const allIncidents = await fetchAllIncidentsForYear(user.tenant_id, year);

    // Filter to OSHA recordable incidents only
    const recordableIncidents = allIncidents.filter(
      (inc) => inc.osha_recordability && inc.osha_recordability !== 'first_aid_only'
    );

    // Fetch OSHA recording data for recordable incidents
    const oshaData = await fetchOshaRecordingData(user.tenant_id, recordableIncidents);

    // Calculate totals by outcome category
    const summary = calculateOsha300aSummary(oshaData, year);

    return createSuccessResponse(200, {
      year,
      summary,
      total_recordable_cases: recordableIncidents.length,
      generation_date: new Date().toISOString(),
      generated_by: user.email ?? user.user_id,
    });
  } catch (error) {
    console.error('OSHA 300A summary generation failed:', error);
    return internalError('Failed to generate OSHA 300A summary');
  }
}

// --- Data Fetching Helpers ---

/**
 * Fetches incidents matching the provided filters with tenant isolation.
 */
async function fetchFilteredIncidents(
  user: AuthenticatedUser,
  filters: ExportFilters
): Promise<IncidentRecord[]> {
  const queryFilters: { siteId?: string; status?: string; regulatoryFlag?: string } = {};

  if (filters.site_id) queryFilters.siteId = filters.site_id;
  if (filters.status) queryFilters.status = filters.status;
  if (filters.regulatory_flag) queryFilters.regulatoryFlag = filters.regulatory_flag;

  // Fetch all matching incidents (paginate through all results)
  const allIncidents: IncidentRecord[] = [];
  let cursor: string | undefined;

  do {
    const result = await listIncidents(user.tenant_id, queryFilters, {
      limit: 100,
      cursor,
    });
    allIncidents.push(...result.incidents);
    cursor = result.nextCursor;
  } while (cursor);

  // Apply date range filter if provided
  if (filters.date_range?.start || filters.date_range?.end) {
    return allIncidents.filter((incident) => {
      const incidentDate = incident.incident_datetime;
      if (filters.date_range?.start && incidentDate < filters.date_range.start) {
        return false;
      }
      if (filters.date_range?.end && incidentDate > filters.date_range.end) {
        return false;
      }
      return true;
    });
  }

  return allIncidents;
}

/**
 * Fetches all incidents for a tenant within a specific calendar year.
 */
async function fetchAllIncidentsForYear(
  tenantId: string,
  year: number
): Promise<IncidentRecord[]> {
  const startDate = `${year}-01-01T00:00:00.000Z`;
  const endDate = `${year}-12-31T23:59:59.999Z`;

  const allIncidents: IncidentRecord[] = [];
  let cursor: string | undefined;

  do {
    const result = await listIncidents(tenantId, {}, { limit: 100, cursor });
    allIncidents.push(...result.incidents);
    cursor = result.nextCursor;
  } while (cursor);

  // Filter by year based on incident_datetime
  return allIncidents.filter((incident) => {
    return incident.incident_datetime >= startDate && incident.incident_datetime <= endDate;
  });
}

/**
 * Fetches OSHA recording data for a set of incidents from the regulatory data table.
 */
async function fetchOshaRecordingData(
  tenantId: string,
  incidents: IncidentRecord[]
): Promise<OshaRecordingData[]> {
  const oshaData: OshaRecordingData[] = [];

  for (const incident of incidents) {
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: getTableName(REGULATORY_DATA_TABLE),
          Key: {
            PK: `INCIDENT#${incident.incident_id}`,
            SK: 'REGDATA#osha_300',
          },
        })
      );

      if (result.Item) {
        oshaData.push(result.Item as OshaRecordingData);
      }
    } catch (error) {
      // Skip incidents without OSHA data
      console.warn(`No OSHA data for incident ${incident.incident_id}:`, error);
    }
  }

  return oshaData;
}

/**
 * Fetches WorkSafeBC emergency summary data for an incident.
 */
async function fetchWorksafebcSummary(
  incidentId: string
): Promise<Record<string, unknown> | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: getTableName(REGULATORY_DATA_TABLE),
        Key: {
          PK: `INCIDENT#${incidentId}`,
          SK: 'REGDATA#worksafebc_emergency',
        },
      })
    );

    return (result.Item as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

// --- CSV Generation ---

/**
 * Generates an operational CSV with all incident fields.
 * Includes metadata header per Req 17.4.
 *
 * Requirements: 17.1, 17.4
 */
export function generateOperationalCsv(
  incidents: IncidentRecord[],
  filters: ExportFilters,
  user: AuthenticatedUser
): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  // Req 17.4: Metadata header
  lines.push(`# Incident Export Report`);
  lines.push(`# Generation Date: ${now}`);
  lines.push(`# Period: ${formatPeriod(filters.date_range)}`);
  lines.push(`# Filters: ${formatFilters(filters)}`);
  lines.push(`# Generated By: ${user.email ?? user.user_id}`);
  lines.push(`# Total Records: ${incidents.length}`);
  lines.push('');

  // CSV header row
  const headers = [
    'incident_id',
    'title',
    'description',
    'incident_type',
    'incident_datetime',
    'report_datetime',
    'site_id',
    'location',
    'persons_involved_count',
    'reporting_user_name',
    'severity',
    'regulatory_flag',
    'status',
    'external_report_status',
    'jurisdiction',
    'osha_recordability',
    'resolution_notes',
    'closure_date',
    'created_at',
    'updated_at',
  ];
  lines.push(headers.join(','));

  // CSV data rows
  for (const incident of incidents) {
    const row = [
      escapeCsvField(incident.incident_id),
      escapeCsvField(incident.title),
      escapeCsvField(incident.description),
      escapeCsvField(incident.incident_type),
      escapeCsvField(incident.incident_datetime),
      escapeCsvField(incident.report_datetime),
      escapeCsvField(incident.site_id),
      escapeCsvField(incident.location),
      String(incident.persons_involved_count),
      escapeCsvField(incident.reporting_user_name),
      escapeCsvField(incident.severity),
      escapeCsvField(incident.regulatory_flag),
      escapeCsvField(incident.status),
      escapeCsvField(incident.external_report_status),
      escapeCsvField(incident.jurisdiction),
      escapeCsvField(incident.osha_recordability ?? ''),
      escapeCsvField(incident.resolution_notes ?? ''),
      escapeCsvField(incident.closure_date ?? ''),
      escapeCsvField(incident.created_at),
      escapeCsvField(incident.updated_at),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

/**
 * Generates an OSHA Form 300 CSV with required fields.
 * Includes metadata header per Req 17.4.
 *
 * Requirements: 17.2, 17.4
 */
export function generateOsha300Csv(
  oshaData: OshaRecordingData[],
  filters: ExportFilters,
  user: AuthenticatedUser
): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  // Req 17.4: Metadata header
  lines.push(`# OSHA Form 300 - Log of Work-Related Injuries and Illnesses`);
  lines.push(`# Generation Date: ${now}`);
  lines.push(`# Period: ${formatPeriod(filters.date_range)}`);
  lines.push(`# Filters: ${formatFilters(filters)}`);
  lines.push(`# Generated By: ${user.email ?? user.user_id}`);
  lines.push(`# Total Records: ${oshaData.length}`);
  lines.push(`# Disclaimer: The regulatory suggestions provided by this system are operational support and do not constitute legal advice.`);
  lines.push('');

  // OSHA Form 300 header row
  const headers = [
    'case_identifier',
    'worker_name',
    'job_title',
    'incident_date',
    'location',
    'description',
    'case_outcome',
    'days_away',
    'days_restricted',
  ];
  lines.push(headers.join(','));

  // Data rows
  for (const record of oshaData) {
    const row = [
      escapeCsvField(record.case_identifier),
      escapeCsvField(record.worker_name),
      escapeCsvField(record.job_title),
      escapeCsvField(record.incident_date),
      escapeCsvField(record.location_within_site),
      escapeCsvField(record.injury_illness_description),
      escapeCsvField(record.case_outcome),
      String(record.days_away_from_work),
      String(record.days_restricted_work),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

// --- OSHA 300A Summary Calculation ---

/**
 * Calculates OSHA Form 300A annual summary totals by outcome category.
 *
 * Requirement: 10.3
 */
export function calculateOsha300aSummary(
  oshaData: OshaRecordingData[],
  year: number
): Osha300ARecord {
  const summary: Osha300ARecord = {
    year,
    total_cases: oshaData.length,
    total_deaths: 0,
    total_days_away: 0,
    total_restricted_work: 0,
    total_job_transfer: 0,
    total_other_recordable: 0,
    total_days_away_count: 0,
    total_days_restricted_count: 0,
  };

  for (const record of oshaData) {
    switch (record.case_outcome) {
      case 'death' as OshaCaseOutcome:
        summary.total_deaths++;
        break;
      case 'days_away_from_work' as OshaCaseOutcome:
        summary.total_days_away++;
        summary.total_days_away_count += record.days_away_from_work;
        break;
      case 'restricted_work' as OshaCaseOutcome:
        summary.total_restricted_work++;
        summary.total_days_restricted_count += record.days_restricted_work;
        break;
      case 'job_transfer' as OshaCaseOutcome:
        summary.total_job_transfer++;
        break;
      case 'other_recordable' as OshaCaseOutcome:
        summary.total_other_recordable++;
        break;
    }
  }

  return summary;
}

// --- WorkSafeBC Helpers ---

/**
 * Identifies missing fields required for the WorkSafeBC emergency summary.
 *
 * Requirement: 8.3
 */
function getMissingWorksafebcFields(
  incident: IncidentRecord,
  summaryData: Record<string, unknown> | null
): string[] {
  const missing: string[] = [];

  if (!incident.location) missing.push('location');
  if (!incident.incident_datetime) missing.push('incident_datetime');
  if (incident.persons_involved_count === 0) missing.push('persons_involved');

  if (!summaryData) {
    missing.push('employer_contact_name', 'contact_phone', 'worker_names');
  } else {
    if (!summaryData['employer_name']) missing.push('employer_contact_name');
    if (!summaryData['employer_phone']) missing.push('contact_phone');
    if (!summaryData['worker_name']) missing.push('worker_name');
  }

  return missing;
}

// --- CSV Utility Functions ---

/**
 * Escapes a field value for CSV output.
 * Wraps in double quotes if the value contains commas, quotes, or newlines.
 */
export function escapeCsvField(value: string): string {
  if (!value) return '""';
  // If the value contains special characters, wrap in quotes and escape internal quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Formats the date range for the metadata header.
 */
function formatPeriod(dateRange?: { start: string; end: string }): string {
  if (!dateRange) return 'All time';
  const parts: string[] = [];
  if (dateRange.start) parts.push(`from ${dateRange.start}`);
  if (dateRange.end) parts.push(`to ${dateRange.end}`);
  return parts.length > 0 ? parts.join(' ') : 'All time';
}

/**
 * Formats the applied filters for the metadata header.
 */
function formatFilters(filters: ExportFilters): string {
  const parts: string[] = [];
  if (filters.status) parts.push(`status=${filters.status}`);
  if (filters.site_id) parts.push(`site_id=${filters.site_id}`);
  if (filters.regulatory_flag) parts.push(`regulatory_flag=${filters.regulatory_flag}`);
  if (filters.date_range?.start) parts.push(`start_date=${filters.date_range.start}`);
  if (filters.date_range?.end) parts.push(`end_date=${filters.date_range.end}`);
  return parts.length > 0 ? parts.join(', ') : 'None';
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
