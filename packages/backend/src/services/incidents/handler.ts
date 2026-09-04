/**
 * Incident Service Lambda Handler.
 * Routes all 23 API Gateway paths for the incident reporting module.
 *
 * Implements:
 * - POST /incidents (create with validation, regulatory eval, audit trail)
 * - GET /incidents (list with role-based filtering)
 * - GET /incidents/{id} (detail with tenant isolation)
 * - PATCH /incidents/{id} (update fields with audit trail)
 * - Stubs for remaining routes (state transitions, comments, persons, attachments, etc.)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 3.4, 21.1, 21.2, 21.3, 21.4, 21.5
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, DeleteCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticateRequest } from '../../shared/auth-middleware.js';
import type { ApiGatewayEvent, AuthenticatedUser } from '../../shared/auth-middleware.js';
import { Role } from '../../shared/types/common.js';
import {
  createSuccessResponse,
  badRequest,
  forbidden,
  notFound,
  conflict,
  unprocessableEntity,
  internalError,
} from '../../shared/error-handler.js';
import type { ApiGatewayResponse } from '../../shared/error-handler.js';
import { incidentCreateSchema, incidentUpdateSchema, commentSchema, personSchema, createAttachmentSchema, closureSchema, reopenSchema, regulatoryDataSchema } from './validators.js';
import { unlinkSchema, filterLinkedDocsSchema, createLinkSchema, searchResponsesSchema } from './linked-documents-validators.js';
import { unlinkDocument, getLinkedDocuments, createLinkedDocument, isAlreadyLinked, getLinkableResponses } from './linked-documents-repository.js';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import {
  createIncident,
  getIncident,
  updateIncident,
  listIncidents,
  listBySite,
  decrementLinkedDocumentsCount,
  incrementLinkedDocumentsCount,
} from './incident-repository.js';
import { appendEvent, getTimeline } from './timeline-repository.js';
import { evaluateRegulatory } from './regulatory-engine.js';
import { isValidTransition, getValidTransitions } from './state-machine.js';
import { publishEvent } from '../../shared/event-publisher.js';
import {
  publishIncidentCreated,
  publishIncidentUpdated,
  publishRegulatoryImmediateNotification,
} from './event-publisher.js';
import { createDeadlineSchedule } from './deadline-scheduler.js';
import {
  IncidentStatus,
  OperationalSeverity,
  RegulatoryFlag,
  ExternalReportStatus,
  TimelineEventType,
} from './types.js';
import type { IncidentRecord, TimelineEvent, IncidentComment, InvolvedPerson, IncidentAttachment, DocumentCategory } from './types.js';
import {
  handleOperationalExport,
  handleWorksafebcExport,
  handleOsha300aSummary,
} from './export-handler.js';
import { z } from 'zod';

// --- S3 Client for evidence uploads ---
const s3Client = new S3Client({});
const SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes
const INCIDENTS_TABLE = 'Incidents';
const REGULATORY_DATA_TABLE = 'IncidentRegulatoryData';

// --- Permission constants for incident module ---

/** Roles that can create incidents (Req 21.1) */
const INCIDENT_CREATE_ROLES: Role[] = [
  Role.TENANT_ADMIN,
  Role.SITE_ADMIN,
  Role.SUPERVISOR,
  Role.CSO,
];

/** Roles that see all incidents in the tenant (Req 21.5) */
const FULL_VISIBILITY_ROLES: Role[] = [
  Role.TENANT_ADMIN,
  Role.CSO,
];

/** Roles that see incidents for assigned sites only (Req 21.5) */
const SITE_SCOPED_ROLES: Role[] = [
  Role.SITE_ADMIN,
  Role.SUPERVISOR,
];

/** Roles that can manage external report status (Req 21.2) */
const EXTERNAL_STATUS_ROLES: Role[] = [
  Role.TENANT_ADMIN,
  Role.CSO,
];

/** Roles that can close incidents (Req 21.2) */
const CLOSURE_ROLES: Role[] = [
  Role.TENANT_ADMIN,
  Role.CSO,
];

/** Roles that can export data (Req 21.3) */
const EXPORT_ROLES: Role[] = [
  Role.TENANT_ADMIN,
  Role.CSO,
  Role.SUPERVISOR,
];

/** Roles that can unlink documents from incidents (Req 8.2) */
const UNLINK_ROLES: Role[] = [
  Role.TENANT_ADMIN,
  Role.CSO,
];

// --- Lambda Handler ---

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  try {
    const httpMethod = (event as Record<string, unknown>)['httpMethod'] as string;
    let resource = (event as Record<string, unknown>)['resource'] as string;
    let pathParameters = (event as Record<string, unknown>)['pathParameters'] as Record<string, string> | null;
    const queryStringParameters = (event as Record<string, unknown>)['queryStringParameters'] as Record<string, string> | null;

    // When using {proxy+} routing, resolve the effective resource pattern from the actual path
    if (resource === '/incidents/{proxy+}' || resource === '/incidents/{id}/{proxy+}') {
      const path = ((event as Record<string, unknown>)['path'] as string) || '';
      const resolved = resolveProxyRoute(path);
      resource = resolved.resource;
      pathParameters = { ...pathParameters, ...resolved.params };
    }

    // Authenticate
    const authResult = authenticateRequest(event);
    if ('error' in authResult) {
      return authResult.error;
    }
    const { user } = authResult;

    // Route matching
    return routeRequest(event, httpMethod, resource, pathParameters, queryStringParameters, user);
  } catch (error) {
    console.error('Incident handler error:', error);
    return internalError('An unexpected error occurred');
  }
}

/**
 * Resolves proxy path to a resource pattern and extracts path parameters.
 * Maps actual paths like /incidents/abc123/state to /incidents/{id}/state with params { id: 'abc123' }.
 */
function resolveProxyRoute(path: string): { resource: string; params: Record<string, string> } {
  // Remove leading slash and split
  const parts = path.replace(/^\//, '').split('/');
  // parts[0] = 'incidents', rest are the sub-path segments

  if (parts.length === 1) {
    // /incidents
    return { resource: '/incidents', params: {} };
  }

  if (parts.length === 2) {
    // /incidents/export or /incidents/osha-300a or /incidents/{id}
    if (parts[1] === 'export') return { resource: '/incidents/export', params: {} };
    if (parts[1] === 'osha-300a') return { resource: '/incidents/osha-300a', params: {} };
    return { resource: '/incidents/{id}', params: { id: parts[1] } };
  }

  if (parts.length === 3) {
    // /incidents/{id}/state, /incidents/{id}/severity, etc.
    const id = parts[1];
    const sub = parts[2];
    return { resource: `/incidents/{id}/${sub}`, params: { id } };
  }

  if (parts.length === 4) {
    // /incidents/{id}/persons/{personId}, /incidents/{id}/attachments/{attachId}, 
    // /incidents/{id}/linked-documents/{linkId}, /incidents/{id}/worksafebc-summary/export
    const id = parts[1];
    const sub = parts[2];
    const sub2 = parts[3];

    if (sub === 'persons') return { resource: '/incidents/{id}/persons/{personId}', params: { id, personId: sub2 } };
    if (sub === 'linked-documents') return { resource: '/incidents/{id}/linked-documents/{linkId}', params: { id, linkId: sub2 } };
    if (sub === 'worksafebc-summary' && sub2 === 'export') return { resource: '/incidents/{id}/worksafebc-summary/export', params: { id } };
    // /incidents/{id}/attachments/{attachId}
    return { resource: `/incidents/{id}/${sub}/{sub2}`, params: { id, [sub === 'attachments' ? 'attachId' : sub2]: sub2 } };
  }

  if (parts.length === 5) {
    // /incidents/{id}/attachments/{attachId}/confirm
    const id = parts[1];
    const attachId = parts[3];
    return { resource: '/incidents/{id}/attachments/{attachId}/confirm', params: { id, attachId } };
  }

  return { resource: path, params: {} };
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
  // POST /incidents — Create incident
  if (httpMethod === 'POST' && resource === '/incidents') {
    return handleCreateIncident(event, user);
  }

  // GET /incidents — List incidents
  if (httpMethod === 'GET' && resource === '/incidents') {
    return handleListIncidents(user, queryStringParameters);
  }

  // GET /incidents/{id} — Get incident detail
  if (httpMethod === 'GET' && resource === '/incidents/{id}') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleGetIncident(user, incidentId);
  }

  // PATCH /incidents/{id} — Update incident fields
  if (httpMethod === 'PATCH' && resource === '/incidents/{id}') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleUpdateIncident(event, user, incidentId);
  }

  // PATCH /incidents/{id}/state — Transition state (Task 2.6)
  if (httpMethod === 'PATCH' && resource === '/incidents/{id}/state') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleStateTransition(event, user, incidentId);
  }

  // PATCH /incidents/{id}/severity — Change severity (Task 2.6)
  if (httpMethod === 'PATCH' && resource === '/incidents/{id}/severity') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleSeverityChange(event, user, incidentId);
  }

  // PATCH /incidents/{id}/regulatory-flag — Change regulatory flag (Task 2.6)
  if (httpMethod === 'PATCH' && resource === '/incidents/{id}/regulatory-flag') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleRegulatoryFlagChange(event, user, incidentId);
  }

  // PATCH /incidents/{id}/external-status — Change external report status (Task 2.6)
  if (httpMethod === 'PATCH' && resource === '/incidents/{id}/external-status') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleExternalStatusChange(event, user, incidentId);
  }

  // POST /incidents/{id}/comments — Add comment (Task 2.7)
  if (httpMethod === 'POST' && resource === '/incidents/{id}/comments') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleAddComment(event, user, incidentId);
  }

  // GET /incidents/{id}/comments — List comments (Task 2.7)
  if (httpMethod === 'GET' && resource === '/incidents/{id}/comments') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleListComments(user, incidentId);
  }

  // POST /incidents/{id}/persons — Add involved person (Task 2.7)
  if (httpMethod === 'POST' && resource === '/incidents/{id}/persons') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleAddPerson(event, user, incidentId);
  }

  // DELETE /incidents/{id}/persons/{personId} — Remove involved person (Task 2.7)
  if (httpMethod === 'DELETE' && resource === '/incidents/{id}/persons/{personId}') {
    const incidentId = pathParameters?.['id'];
    const personId = pathParameters?.['personId'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    if (!personId) return Promise.resolve(badRequest('Person ID is required'));
    return handleRemovePerson(user, incidentId, personId);
  }

  // POST /incidents/{id}/attachments — Initiate attachment upload (Task 2.8)
  if (httpMethod === 'POST' && resource === '/incidents/{id}/attachments') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleCreateAttachment(event, user, incidentId);
  }

  // PATCH /incidents/{id}/attachments/{attachId}/confirm — Confirm upload (Task 2.8)
  if (httpMethod === 'PATCH' && resource === '/incidents/{id}/attachments/{attachId}/confirm') {
    const incidentId = pathParameters?.['id'];
    const attachId = pathParameters?.['attachId'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    if (!attachId) return Promise.resolve(badRequest('Attachment ID is required'));
    return handleConfirmAttachment(user, incidentId, attachId);
  }

  // GET /incidents/{id}/timeline — Get audit timeline (Task 2.9)
  if (httpMethod === 'GET' && resource === '/incidents/{id}/timeline') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleGetTimeline(user, incidentId, queryStringParameters);
  }

  // POST /incidents/{id}/close — Close incident (Task 2.9)
  if (httpMethod === 'POST' && resource === '/incidents/{id}/close') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleCloseIncident(event, user, incidentId);
  }

  // POST /incidents/{id}/reopen — Reopen incident (Task 2.9)
  if (httpMethod === 'POST' && resource === '/incidents/{id}/reopen') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleReopenIncident(event, user, incidentId);
  }

  // POST /incidents/{id}/regulatory-data — Save regulatory form data (Task 5.1)
  if (httpMethod === 'POST' && resource === '/incidents/{id}/regulatory-data') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleSaveRegulatoryData(event, user, incidentId);
  }

  // GET /incidents/{id}/regulatory-data — Get regulatory form data (Task 5.1)
  if (httpMethod === 'GET' && resource === '/incidents/{id}/regulatory-data') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleGetRegulatoryData(user, incidentId);
  }

  // POST /incidents/export — Generate export (Task 5.2)
  if (httpMethod === 'POST' && resource === '/incidents/export') {
    return handleExportRequest(event, user);
  }

  // GET /incidents/{id}/worksafebc-summary — WorkSafeBC emergency summary (Task 5.1)
  if (httpMethod === 'GET' && resource === '/incidents/{id}/worksafebc-summary') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleGetWorksafebcSummary(user, incidentId);
  }

  // POST /incidents/{id}/worksafebc-summary/export — Export WorkSafeBC PDF (Task 5.2)
  if (httpMethod === 'POST' && resource === '/incidents/{id}/worksafebc-summary/export') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleWorksafebcExportRoute(event, user, incidentId);
  }

  // GET /incidents/osha-300a — OSHA Form 300A annual summary (Task 5.2)
  if (httpMethod === 'GET' && resource === '/incidents/osha-300a') {
    return handleOsha300aRoute(user, queryStringParameters);
  }

  // POST /incidents/{id}/linked-documents — Create linked document (incident-timeline)
  if (httpMethod === 'POST' && resource === '/incidents/{id}/linked-documents') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleCreateLinkedDocument(event, user, incidentId);
  }

  // GET /incidents/{id}/linkable-responses — Search linkable form responses (incident-timeline)
  if (httpMethod === 'GET' && resource === '/incidents/{id}/linkable-responses') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleSearchLinkableResponses(user, incidentId, queryStringParameters);
  }

  // GET /incidents/{id}/linked-documents — List linked documents (incident-timeline)
  if (httpMethod === 'GET' && resource === '/incidents/{id}/linked-documents') {
    const incidentId = pathParameters?.['id'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    return handleGetLinkedDocuments(user, incidentId, queryStringParameters);
  }

  // DELETE /incidents/{id}/linked-documents/{linkId} — Unlink document (Task 2.3)
  if (httpMethod === 'DELETE' && resource === '/incidents/{id}/linked-documents/{linkId}') {
    const incidentId = pathParameters?.['id'];
    const linkId = pathParameters?.['linkId'];
    if (!incidentId) return Promise.resolve(badRequest('Incident ID is required'));
    if (!linkId) return Promise.resolve(badRequest('Link ID is required'));
    return handleUnlinkDocument(event, user, incidentId, linkId);
  }

  return Promise.resolve(badRequest('Unsupported route'));
}

// --- Route Implementations ---

/**
 * POST /incidents
 * Creates a new incident with validation, regulatory evaluation, and audit trail.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */
async function handleCreateIncident(
  event: ApiGatewayEvent,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // Req 21.1: Only specific roles can create incidents
  if (!INCIDENT_CREATE_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Req 1.3: Validate mandatory fields
  const validation = incidentCreateSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const data = validation.data;
  const now = new Date().toISOString();
  const incidentId = uuidv4();

  // Req 1.2: Evaluate regulatory classification
  // Zod defaults guarantee all indicator fields are present after parsing
  const indicators = data.regulatory_indicators as unknown as import('./types.js').RegulatoryIndicators;
  const regulatoryResult = evaluateRegulatory({
    indicators,
    jurisdiction: data.jurisdiction ?? 'unknown',
    incident_datetime: data.incident_datetime,
  });

  // Req 1.1: Build incident record with initial state
  const incident: IncidentRecord = {
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    site_id: data.site_id,
    title: data.title,
    description: data.description,
    incident_type: data.incident_type,
    other_type_description: data.other_type_description,
    incident_datetime: data.incident_datetime,
    report_datetime: now,
    location: data.location,
    persons_involved_count: data.persons_involved_count,
    reporting_user_id: user.user_id,
    reporting_user_name: user.email ?? user.user_id,
    severity: data.severity,
    regulatory_flag: regulatoryResult.regulatory_flag,
    status: IncidentStatus.OPEN,
    external_report_status: ExternalReportStatus.NOT_REPORTABLE,
    regulatory_indicators: indicators,
    jurisdiction: data.jurisdiction ?? 'unknown',
    created_at: now,
    updated_at: now,
  };

  // Persist incident
  await createIncident(incident);

  // Req 1.4: Record creation audit event
  const creationEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.CREATION,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      title: incident.title,
      incident_type: incident.incident_type,
      severity: incident.severity,
      site_id: incident.site_id,
    },
    timestamp: now,
  };
  await appendEvent(creationEvent);

  // Req 6.6: Record regulatory evaluation audit event
  const regulatoryEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.REGULATORY_EVALUATION,
    actor_id: 'system',
    actor_name: 'Regulatory Engine',
    data: {
      regulatory_flag: regulatoryResult.regulatory_flag,
      applied_rules: regulatoryResult.applied_rules,
      suggestions_count: regulatoryResult.suggestions.length,
      deadlines_count: regulatoryResult.deadlines.length,
    },
    timestamp: now,
  };
  await appendEvent(regulatoryEvent);

  // Req 18.1: Publish incident.created event (triggers notifications for Critical severity)
  try {
    await publishIncidentCreated(incident);
  } catch (error) {
    // Non-blocking: log error but don't fail the creation
    console.error('Failed to publish incident.created event:', error);
  }

  // Req 18.2: Publish regulatory.immediate_notification for immediate deadlines
  for (const deadline of regulatoryResult.deadlines) {
    if (deadline.deadline_hours === 0 || regulatoryResult.regulatory_flag === RegulatoryFlag.IMMEDIATELY_REPORTABLE) {
      try {
        await publishRegulatoryImmediateNotification(incident, deadline);
      } catch (error) {
        console.error('Failed to publish regulatory.immediate_notification event:', error);
      }
    }
  }

  // Create EventBridge Scheduler schedules for non-immediate deadlines
  for (const deadline of regulatoryResult.deadlines) {
    if (deadline.deadline_hours > 0) {
      try {
        await createDeadlineSchedule(incidentId, deadline);
      } catch (error) {
        console.error('Failed to create deadline schedule:', error);
      }
    }
  }

  return createSuccessResponse(201, {
    incident,
    regulatory_result: regulatoryResult,
  });
}

/**
 * GET /incidents
 * Lists incidents with role-based filtering.
 *
 * Req 21.5:
 * - tenant_admin, cso: see all incidents in the tenant
 * - site_admin, supervisor: see incidents for assigned sites only
 * - contractor: sees only incidents they reported (not implemented in this version)
 * - worker, gate_operator: no access
 */
async function handleListIncidents(
  user: AuthenticatedUser,
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  // Roles with no incident visibility
  if (user.role === Role.WORKER || user.role === Role.GATE_OPERATOR) {
    return forbidden('You do not have permission to perform this action');
  }

  const filters: {
    siteId?: string;
    status?: string;
    regulatoryFlag?: string;
  } = {};

  if (queryParams?.['site_id']) {
    filters.siteId = queryParams['site_id'];
  }
  if (queryParams?.['status']) {
    filters.status = queryParams['status'];
  }
  if (queryParams?.['regulatory_flag']) {
    filters.regulatoryFlag = queryParams['regulatory_flag'];
  }

  const limit = queryParams?.['limit'] ? parseInt(queryParams['limit'], 10) : undefined;
  const cursor = queryParams?.['cursor'] ?? undefined;

  const options = {
    ...(limit && { limit }),
    ...(cursor && { cursor }),
  };

  // Full visibility roles: tenant_admin, cso
  if (FULL_VISIBILITY_ROLES.includes(user.role)) {
    const result = await listIncidents(user.tenant_id, filters, options);
    return createSuccessResponse(200, {
      incidents: result.incidents,
      next_cursor: result.nextCursor ?? null,
      count: result.incidents.length,
    });
  }

  // Site-scoped roles: site_admin, supervisor — see only assigned sites
  if (SITE_SCOPED_ROLES.includes(user.role)) {
    const assignedSites = user.assigned_sites ?? [];

    // If a specific site filter is provided, verify it's in assigned sites
    if (filters.siteId) {
      if (!assignedSites.includes(filters.siteId)) {
        return forbidden('Access denied');
      }
      const result = await listBySite(user.tenant_id, filters.siteId, options);
      return createSuccessResponse(200, {
        incidents: result.incidents,
        next_cursor: result.nextCursor ?? null,
        count: result.incidents.length,
      });
    }

    // No site filter: query each assigned site and merge results
    const allIncidents: IncidentRecord[] = [];
    for (const siteId of assignedSites) {
      const result = await listBySite(user.tenant_id, siteId, options);
      allIncidents.push(...result.incidents);
    }

    // Sort by created_at descending
    allIncidents.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // Apply limit
    const limitedIncidents = limit ? allIncidents.slice(0, limit) : allIncidents.slice(0, 50);

    return createSuccessResponse(200, {
      incidents: limitedIncidents,
      next_cursor: null,
      count: limitedIncidents.length,
    });
  }

  // Platform admin: full access across tenants (handled by full visibility)
  if (user.role === Role.PLATFORM_ADMIN) {
    const result = await listIncidents(user.tenant_id, filters, options);
    return createSuccessResponse(200, {
      incidents: result.incidents,
      next_cursor: result.nextCursor ?? null,
      count: result.incidents.length,
    });
  }

  // Default: deny access for unrecognized roles
  return forbidden('You do not have permission to perform this action');
}

/**
 * GET /incidents/{id}
 * Gets a single incident by ID with tenant isolation.
 *
 * Req 3.4: Tenant isolation enforced via partition key.
 */
async function handleGetIncident(
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Roles with no incident visibility
  if (user.role === Role.WORKER || user.role === Role.GATE_OPERATOR) {
    return forbidden('You do not have permission to perform this action');
  }

  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // Site-scoped roles: verify the incident is in an assigned site
  if (SITE_SCOPED_ROLES.includes(user.role)) {
    const assignedSites = user.assigned_sites ?? [];
    if (!assignedSites.includes(incident.site_id)) {
      return forbidden('Access denied');
    }
  }

  return createSuccessResponse(200, { incident });
}

/**
 * PATCH /incidents/{id}
 * Updates incident fields with audit trail for each changed field.
 *
 * Req 3.4: Record audit for each modified field.
 * Req 21.1: Only specific roles can update incidents.
 */
async function handleUpdateIncident(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Only roles that can create can also update
  if (!INCIDENT_CREATE_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Validate update payload
  const validation = incidentUpdateSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const data = validation.data;

  // Check if there are any fields to update
  const fieldsToUpdate = Object.entries(data).filter(([, v]) => v !== undefined);
  if (fieldsToUpdate.length === 0) {
    return badRequest('No fields to update');
  }

  // Verify incident exists and belongs to tenant
  const existing = await getIncident(user.tenant_id, incidentId);
  if (!existing) {
    return notFound('Incident not found');
  }

  // Site-scoped roles: verify the incident is in an assigned site
  if (SITE_SCOPED_ROLES.includes(user.role)) {
    const assignedSites = user.assigned_sites ?? [];
    if (!assignedSites.includes(existing.site_id)) {
      return forbidden('Access denied');
    }
  }

  // Perform the update — cast to satisfy the repository's stricter type
  const updatePayload = data as Partial<Omit<IncidentRecord, 'incident_id' | 'tenant_id' | 'created_at'>>;
  const updated = await updateIncident(user.tenant_id, incidentId, updatePayload);

  // Req 3.4: Record audit trail for each changed field
  const now = new Date().toISOString();
  for (const [field, newValue] of fieldsToUpdate) {
    const previousValue = (existing as unknown as Record<string, unknown>)[field];
    // Only record if value actually changed
    if (JSON.stringify(previousValue) !== JSON.stringify(newValue)) {
      const fieldEvent: TimelineEvent = {
        event_id: uuidv4(),
        incident_id: incidentId,
        tenant_id: user.tenant_id,
        event_type: TimelineEventType.FIELD_UPDATED,
        actor_id: user.user_id,
        actor_name: user.email ?? user.user_id,
        data: {
          field,
          previous_value: previousValue ?? null,
          new_value: newValue,
        },
        timestamp: now,
      };
      await appendEvent(fieldEvent);
    }
  }

  // Req 18.2: Publish incident.updated event
  if (updated) {
    try {
      await publishIncidentUpdated(updated, 'field_update');
    } catch (error) {
      console.error('Failed to publish incident.updated event:', error);
    }
  }

  return createSuccessResponse(200, { incident: updated });
}

// --- State Transition, Severity, Regulatory Flag, External Status Handlers ---

/**
 * PATCH /incidents/{id}/state
 * Transitions the incident to a new state with state machine validation.
 *
 * Requirements: 5.2, 5.3, 5.4
 */
async function handleStateTransition(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Validate body: requires { status: string }
  const schema = z.object({
    status: z.nativeEnum(IncidentStatus, {
      errorMap: () => ({ message: 'Invalid incident status' }),
    }),
  });

  const validation = schema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { status: newStatus } = validation.data;

  // Verify incident exists and belongs to tenant
  const existing = await getIncident(user.tenant_id, incidentId);
  if (!existing) {
    return notFound('Incident not found');
  }

  // Validate state transition
  const currentStatus = existing.status;
  if (!isValidTransition(currentStatus, newStatus)) {
    const validTransitions = getValidTransitions(currentStatus);
    return unprocessableEntity('Invalid state transition', {
      current_state: currentStatus,
      valid_transitions: validTransitions,
    });
  }

  // Perform the update
  const updated = await updateIncident(user.tenant_id, incidentId, { status: newStatus });

  // Record STATE_CHANGE audit event (Req 5.3)
  const now = new Date().toISOString();
  const stateChangeEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.STATE_CHANGE,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      previous_state: currentStatus,
      new_state: newStatus,
    },
    timestamp: now,
  };
  await appendEvent(stateChangeEvent);

  // Publish incident.updated event
  if (updated) {
    try {
      await publishIncidentUpdated(updated, 'state_change');
    } catch (error) {
      console.error('Failed to publish incident.updated event:', error);
    }
  }

  return createSuccessResponse(200, { incident: updated });
}

/**
 * PATCH /incidents/{id}/severity
 * Changes the operational severity with audit trail.
 *
 * Requirements: 4.3
 */
async function handleSeverityChange(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Validate body: requires { severity: OperationalSeverity }
  const schema = z.object({
    severity: z.nativeEnum(OperationalSeverity, {
      errorMap: () => ({ message: 'Invalid severity level' }),
    }),
  });

  const validation = schema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { severity: newSeverity } = validation.data;

  // Verify incident exists and belongs to tenant
  const existing = await getIncident(user.tenant_id, incidentId);
  if (!existing) {
    return notFound('Incident not found');
  }

  const previousSeverity = existing.severity;

  // Perform the update
  const updated = await updateIncident(user.tenant_id, incidentId, { severity: newSeverity });

  // Record SEVERITY_CHANGE audit event (Req 4.3)
  const now = new Date().toISOString();
  const severityChangeEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.SEVERITY_CHANGE,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      previous_severity: previousSeverity,
      new_severity: newSeverity,
    },
    timestamp: now,
  };
  await appendEvent(severityChangeEvent);

  // Publish incident.updated event
  if (updated) {
    try {
      await publishIncidentUpdated(updated, 'severity_change');
    } catch (error) {
      console.error('Failed to publish incident.updated event:', error);
    }
  }

  return createSuccessResponse(200, { incident: updated });
}

/**
 * PATCH /incidents/{id}/regulatory-flag
 * Changes the regulatory flag with audit trail.
 * If new flag is "immediately_reportable", publishes an Immediate_Notification_Alert.
 *
 * Requirements: 4.4, 16.2
 */
async function handleRegulatoryFlagChange(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Validate body: requires { regulatory_flag: RegulatoryFlag }
  const schema = z.object({
    regulatory_flag: z.nativeEnum(RegulatoryFlag, {
      errorMap: () => ({ message: 'Invalid regulatory flag' }),
    }),
  });

  const validation = schema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { regulatory_flag: newFlag } = validation.data;

  // Verify incident exists and belongs to tenant
  const existing = await getIncident(user.tenant_id, incidentId);
  if (!existing) {
    return notFound('Incident not found');
  }

  const previousFlag = existing.regulatory_flag;

  // Perform the update
  const updated = await updateIncident(user.tenant_id, incidentId, { regulatory_flag: newFlag });

  // Record REGULATORY_FLAG_CHANGE audit event
  const now = new Date().toISOString();
  const flagChangeEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.REGULATORY_FLAG_CHANGE,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      previous_flag: previousFlag,
      new_flag: newFlag,
    },
    timestamp: now,
  };
  await appendEvent(flagChangeEvent);

  // Req 4.4: If new flag is "immediately_reportable", generate Immediate_Notification_Alert
  if (newFlag === RegulatoryFlag.IMMEDIATELY_REPORTABLE && updated) {
    try {
      await publishRegulatoryImmediateNotification(updated, {
        authority: existing.jurisdiction?.startsWith('us') ? 'OSHA' : 'WorkSafeBC',
        deadline_hours: 0,
        deadline_from: 'employer_knowledge',
        absolute_deadline: now,
        description: 'Regulatory flag changed to immediately reportable',
      });
    } catch (error) {
      console.error('Failed to publish regulatory.immediate_notification event:', error);
    }
  }

  // Publish incident.updated event
  if (updated) {
    try {
      await publishIncidentUpdated(updated, 'regulatory_flag_change');
    } catch (error) {
      console.error('Failed to publish incident.updated event:', error);
    }
  }

  return createSuccessResponse(200, { incident: updated });
}

/**
 * PATCH /incidents/{id}/external-status
 * Changes the external report status with audit trail.
 * Restricted to tenant_admin and cso roles only (Req 21.2).
 *
 * Requirements: 16.1, 16.2
 */
async function handleExternalStatusChange(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Req 21.2: Only tenant_admin and cso can manage external report status
  if (!EXTERNAL_STATUS_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Validate body: requires { external_report_status: ExternalReportStatus }
  const schema = z.object({
    external_report_status: z.nativeEnum(ExternalReportStatus, {
      errorMap: () => ({ message: 'Invalid external report status' }),
    }),
  });

  const validation = schema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { external_report_status: newStatus } = validation.data;

  // Verify incident exists and belongs to tenant
  const existing = await getIncident(user.tenant_id, incidentId);
  if (!existing) {
    return notFound('Incident not found');
  }

  const previousStatus = existing.external_report_status;

  // Perform the update
  const updated = await updateIncident(user.tenant_id, incidentId, {
    external_report_status: newStatus,
  });

  // Record EXTERNAL_STATUS_CHANGE audit event (Req 16.2)
  const now = new Date().toISOString();
  const statusChangeEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.EXTERNAL_STATUS_CHANGE,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      previous_status: previousStatus,
      new_status: newStatus,
    },
    timestamp: now,
  };
  await appendEvent(statusChangeEvent);

  // Publish incident.updated event
  if (updated) {
    try {
      await publishIncidentUpdated(updated, 'external_status_change');
    } catch (error) {
      console.error('Failed to publish incident.updated event:', error);
    }
  }

  return createSuccessResponse(200, { incident: updated });
}

// --- Comments and Persons Involved Implementations (Task 2.7) ---

/**
 * POST /incidents/{id}/comments
 * Adds a comment to an incident with validation and audit trail.
 *
 * Requirements: 14.1, 14.3, 14.4
 */
async function handleAddComment(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Req 14.4: Validate comment content (non-empty after trim, max 5000 chars)
  const validation = commentSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { content } = validation.data;

  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  const now = new Date().toISOString();
  const commentId = uuidv4();

  // Req 14.1: Store comment with author, content, and timestamp
  const comment: IncidentComment = {
    comment_id: commentId,
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    author_id: user.user_id,
    author_name: user.email ?? user.user_id,
    content,
    created_at: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Item: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `INCIDENT#${incidentId}#COMMENT#${commentId}`,
        ...comment,
      },
    })
  );

  // Req 14.3: Record audit trail for comment addition
  const timelineEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.COMMENT_ADDED,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      comment_id: commentId,
      content_preview: content.substring(0, 100),
    },
    timestamp: now,
  };
  await appendEvent(timelineEvent);

  return createSuccessResponse(201, { comment });
}

/**
 * GET /incidents/{id}/comments
 * Lists comments for an incident in chronological order.
 *
 * Requirement: 14.2
 */
async function handleListComments(
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // Req 14.2: Query comments in ascending chronological order
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':skPrefix': `INCIDENT#${incidentId}#COMMENT#`,
      },
      ScanIndexForward: true, // Chronological order (oldest first)
    })
  );

  const comments = (result.Items ?? []) as IncidentComment[];

  return createSuccessResponse(200, { comments });
}

/**
 * POST /incidents/{id}/persons
 * Adds an involved person to an incident with validation and audit trail.
 *
 * Requirements: 13.1, 13.2, 13.3
 */
async function handleAddPerson(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Req 13.2: Validate person fields (full_name, involvement_type, organization mandatory)
  const validation = personSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const data = validation.data;

  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  const now = new Date().toISOString();
  const personId = uuidv4();

  // Store person record
  const person: InvolvedPerson = {
    person_id: personId,
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    full_name: data.full_name,
    involvement_type: data.involvement_type,
    organization: data.organization,
    worker_id: data.worker_id,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Item: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `INCIDENT#${incidentId}#PERSON#${personId}`,
        ...person,
      },
    })
  );

  // Req 13.3: Record audit trail for person addition
  const timelineEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.PERSON_ADDED,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      person_id: personId,
      full_name: person.full_name,
      involvement_type: person.involvement_type,
      organization: person.organization,
    },
    timestamp: now,
  };
  await appendEvent(timelineEvent);

  return createSuccessResponse(201, { person });
}

/**
 * DELETE /incidents/{id}/persons/{personId}
 * Removes an involved person from an incident with audit trail.
 *
 * Requirement: 13.3
 */
async function handleRemovePerson(
  user: AuthenticatedUser,
  incidentId: string,
  personId: string
): Promise<ApiGatewayResponse> {
  // Verify the person record exists
  const personKey = {
    PK: `TENANT#${user.tenant_id}`,
    SK: `INCIDENT#${incidentId}#PERSON#${personId}`,
  };

  const existing = await docClient.send(
    new GetCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Key: personKey,
    })
  );

  if (!existing.Item) {
    return notFound('Person not found');
  }

  const person = existing.Item as InvolvedPerson;

  // Delete the person record
  await docClient.send(
    new DeleteCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Key: personKey,
    })
  );

  // Req 13.3: Record audit trail for person removal
  const now = new Date().toISOString();
  const timelineEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.PERSON_REMOVED,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      person_id: personId,
      full_name: person.full_name,
      involvement_type: person.involvement_type,
      organization: person.organization,
    },
    timestamp: now,
  };
  await appendEvent(timelineEvent);

  return createSuccessResponse(200, { message: 'Person removed successfully' });
}

// --- Attachment Handlers ---

/**
 * POST /incidents/{id}/attachments
 * Validates file metadata, generates a presigned S3 PUT URL, and stores attachment metadata.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */
async function handleCreateAttachment(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Only roles that can create incidents can attach evidence
  if (!INCIDENT_CREATE_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Validate attachment metadata (MIME type, size, video duration)
  const validation = createAttachmentSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const data = validation.data;

  // Verify incident exists and belongs to tenant
  const existing = await getIncident(user.tenant_id, incidentId);
  if (!existing) {
    return notFound('Incident not found');
  }

  // Site-scoped roles: verify the incident is in an assigned site
  if (SITE_SCOPED_ROLES.includes(user.role)) {
    const assignedSites = user.assigned_sites ?? [];
    if (!assignedSites.includes(existing.site_id)) {
      return forbidden('Access denied');
    }
  }

  const attachmentId = uuidv4();
  const now = new Date().toISOString();
  const bucketName = process.env['INCIDENT_EVIDENCE_BUCKET'] ?? 'incident-evidence';
  const s3Key = `${user.tenant_id}/${incidentId}/${attachmentId}/${data.file_name}`;

  // Generate presigned PUT URL for direct upload to S3
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
    ContentType: data.mime_type,
  });

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: SIGNED_URL_EXPIRY_SECONDS,
    });
  } catch (error) {
    console.error('Failed to generate presigned URL:', error);
    return internalError('Failed to generate upload URL');
  }

  // Store attachment metadata in DynamoDB
  const attachment: IncidentAttachment = {
    attachment_id: attachmentId,
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    file_name: data.file_name,
    mime_type: data.mime_type,
    size_bytes: data.size_bytes,
    s3_key: s3Key,
    uploaded_by: user.user_id,
    confirmed: false,
    created_at: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Item: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `INCIDENT#${incidentId}#ATTACHMENT#${attachmentId}`,
        ...attachment,
      },
    })
  );

  return createSuccessResponse(201, {
    attachment_id: attachmentId,
    upload_url: uploadUrl,
    s3_key: s3Key,
  });
}

/**
 * PATCH /incidents/{id}/attachments/{attachId}/confirm
 * Marks an attachment as confirmed after successful upload and records audit.
 *
 * Requirements: 12.4
 */
async function handleConfirmAttachment(
  user: AuthenticatedUser,
  incidentId: string,
  attachmentId: string
): Promise<ApiGatewayResponse> {
  // Only roles that can create incidents can confirm attachments
  if (!INCIDENT_CREATE_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }

  // Verify the attachment exists and belongs to this incident/tenant
  const attachmentResult = await docClient.send(
    new GetCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Key: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `INCIDENT#${incidentId}#ATTACHMENT#${attachmentId}`,
      },
    })
  );

  const attachment = attachmentResult.Item as IncidentAttachment | undefined;
  if (!attachment) {
    return notFound('Attachment not found');
  }

  // Mark as confirmed
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      Key: {
        PK: `TENANT#${user.tenant_id}`,
        SK: `INCIDENT#${incidentId}#ATTACHMENT#${attachmentId}`,
      },
      UpdateExpression: 'SET #confirmed = :confirmed',
      ExpressionAttributeNames: {
        '#confirmed': 'confirmed',
      },
      ExpressionAttributeValues: {
        ':confirmed': true,
      },
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    })
  );

  // Record ATTACHMENT_ADDED timeline event (Req 12.4)
  const timelineEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.ATTACHMENT_ADDED,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      attachment_id: attachmentId,
      file_name: attachment.file_name,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
    },
    timestamp: now,
  };
  await appendEvent(timelineEvent);

  return createSuccessResponse(200, { confirmed: true });
}

// --- Closure, Reopening, and Timeline Handlers (Task 2.9) ---

/**
 * GET /incidents/{id}/timeline
 * Retrieves the audit timeline for an incident in chronological order with pagination.
 *
 * Requirements: 15.1, 15.2, 15.3
 */
async function handleGetTimeline(
  user: AuthenticatedUser,
  incidentId: string,
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // Site-scoped roles: verify the incident is in an assigned site
  if (SITE_SCOPED_ROLES.includes(user.role)) {
    const assignedSites = user.assigned_sites ?? [];
    if (!assignedSites.includes(incident.site_id)) {
      return forbidden('Access denied');
    }
  }

  const limit = queryParams?.['limit'] ? parseInt(queryParams['limit'], 10) : undefined;
  const cursor = queryParams?.['cursor'] ?? undefined;

  const result = await getTimeline(incidentId, {
    ...(limit && { limit }),
    ...(cursor && { cursor }),
  });

  return createSuccessResponse(200, {
    events: result.events,
    next_cursor: result.nextCursor ?? null,
    count: result.events.length,
  });
}

/**
 * POST /incidents/{id}/close
 * Closes an incident that is in "Resolved" status.
 * Restricted to tenant_admin and cso roles (Req 21.2).
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 21.2
 */
async function handleCloseIncident(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Req 21.2: Only tenant_admin and cso can close incidents
  if (!CLOSURE_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Req 19.1, 19.2: Validate resolution_notes (minimum 20 chars after trimming)
  const validation = closureSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { resolution_notes } = validation.data;

  // Verify incident exists and belongs to tenant
  const existing = await getIncident(user.tenant_id, incidentId);
  if (!existing) {
    return notFound('Incident not found');
  }

  // Req 19.1: Incident must be in "Resolved" status to close
  if (existing.status !== IncidentStatus.RESOLVED) {
    return unprocessableEntity('Cannot close incident: must be in Resolved state');
  }

  const now = new Date().toISOString();

  // Req 19.3: Update incident to "Closed" with resolution data
  const updated = await updateIncident(user.tenant_id, incidentId, {
    status: IncidentStatus.CLOSED,
    resolution_notes,
    closure_date: now,
    closed_by: user.user_id,
  });

  // Req 19.3: Record CLOSURE audit event
  const closureEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.CLOSURE,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      resolution_notes,
      closure_date: now,
      closed_by: user.user_id,
      previous_state: existing.status,
      new_state: IncidentStatus.CLOSED,
    },
    timestamp: now,
  };
  await appendEvent(closureEvent);

  return createSuccessResponse(200, { incident: updated });
}

/**
 * POST /incidents/{id}/reopen
 * Reopens a closed incident with mandatory justification.
 *
 * Requirements: 20.1, 20.2, 20.3
 */
async function handleReopenIncident(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Req 20.1, 20.3: Validate justification (minimum 20 chars after trimming)
  const validation = reopenSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { justification } = validation.data;

  // Verify incident exists and belongs to tenant
  const existing = await getIncident(user.tenant_id, incidentId);
  if (!existing) {
    return notFound('Incident not found');
  }

  // Req 20.1: Incident must be in "Closed" status to reopen
  if (existing.status !== IncidentStatus.CLOSED) {
    return unprocessableEntity('Cannot reopen incident: must be in Closed state');
  }

  const now = new Date().toISOString();

  // Req 20.2: Update incident to "Open" with reopen justification
  const updated = await updateIncident(user.tenant_id, incidentId, {
    status: IncidentStatus.OPEN,
    reopen_justification: justification,
  });

  // Req 20.2: Record REOPENING audit event
  const reopenEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.REOPENING,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      justification,
      previous_state: existing.status,
      new_state: IncidentStatus.OPEN,
    },
    timestamp: now,
  };
  await appendEvent(reopenEvent);

  return createSuccessResponse(200, { incident: updated });
}

// --- Regulatory Data Handlers (Task 5.1) ---

/**
 * Required fields for each regulatory data type when marking as complete.
 */
const REQUIRED_FIELDS_BY_TYPE: Record<string, string[]> = {
  worksafebc_employer: [
    'employer_name',
    'employer_address',
    'employer_phone',
    'worksafebc_account_number',
    'worker_name',
    'worker_address',
    'worker_date_of_birth',
    'worker_occupation',
    'worker_hire_date',
    'incident_description',
    'body_part_affected',
    'nature_of_injury',
    'days_shifts_lost',
  ],
  osha_300: [
    'case_identifier',
    'worker_name',
    'job_title',
    'incident_date',
    'location_within_site',
    'injury_illness_description',
    'case_outcome',
    'days_away_from_work',
    'days_restricted_work',
  ],
  worksafebc_emergency: [
    'employer_contact_name',
    'employer_contact_phone',
    'incident_location',
    'incident_datetime',
    'workers_involved_count',
    'worker_names',
    'brief_description',
  ],
};

/**
 * POST /incidents/{id}/regulatory-data
 * Saves OSHA/WorkSafeBC form data to the IncidentRegulatoryData table.
 * Allows draft saves without full validation; validates completeness when is_complete=true.
 *
 * Requirements: 8.1, 8.3, 9.1, 9.2, 9.3, 10.1, 10.4
 */
async function handleSaveRegulatoryData(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Validate payload structure
  const validation = regulatoryDataSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { type, data } = validation.data;

  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // If is_complete=true, validate all required fields are present
  const isComplete = (data as Record<string, unknown>).is_complete === true;
  if (isComplete) {
    const requiredFields = REQUIRED_FIELDS_BY_TYPE[type] ?? [];
    const missingFields: string[] = [];
    for (const field of requiredFields) {
      const value = (data as Record<string, unknown>)[field];
      if (value === undefined || value === null || value === '') {
        missingFields.push(field);
      }
    }
    if (missingFields.length > 0) {
      return badRequest('Cannot mark as complete: missing required fields', {
        missing_fields: missingFields,
      });
    }
  }

  const now = new Date().toISOString();

  // Store in IncidentRegulatoryData table: PK = INCIDENT#{incident_id}, SK = REGDATA#{type}
  await docClient.send(
    new PutCommand({
      TableName: getTableName(REGULATORY_DATA_TABLE),
      Item: {
        PK: `INCIDENT#${incidentId}`,
        SK: `REGDATA#${type}`,
        incident_id: incidentId,
        tenant_id: user.tenant_id,
        type,
        data,
        is_complete: isComplete,
        last_updated: now,
        updated_by: user.user_id,
      },
    })
  );

  return createSuccessResponse(201, {
    incident_id: incidentId,
    type,
    data,
    is_complete: isComplete,
    last_updated: now,
  });
}

/**
 * GET /incidents/{id}/regulatory-data
 * Retrieves all regulatory form data records for an incident.
 *
 * Requirements: 9.1, 10.1
 */
async function handleGetRegulatoryData(
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // Query IncidentRegulatoryData table for all records with PK = INCIDENT#{incident_id}
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(REGULATORY_DATA_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': `INCIDENT#${incidentId}`,
        ':skPrefix': 'REGDATA#',
      },
    })
  );

  const records = (result.Items ?? []).map((item) => ({
    incident_id: item['incident_id'],
    type: item['type'],
    data: item['data'],
    is_complete: item['is_complete'],
    last_updated: item['last_updated'],
    updated_by: item['updated_by'],
  }));

  return createSuccessResponse(200, { regulatory_data: records });
}

/**
 * GET /incidents/{id}/worksafebc-summary
 * Generates a WorkSafeBC emergency summary view with missing field indicators.
 *
 * Requirements: 8.1, 8.3
 */
async function handleGetWorksafebcSummary(
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // Get the worksafebc_emergency regulatory data if it exists
  const regDataResult = await docClient.send(
    new GetCommand({
      TableName: getTableName(REGULATORY_DATA_TABLE),
      Key: {
        PK: `INCIDENT#${incidentId}`,
        SK: 'REGDATA#worksafebc_emergency',
      },
    })
  );

  const regData = regDataResult.Item?.['data'] as Record<string, unknown> | undefined;

  // Get persons involved for worker names
  const personsResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName(INCIDENTS_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${user.tenant_id}`,
        ':skPrefix': `INCIDENT#${incidentId}#PERSON#`,
      },
    })
  );

  const persons = (personsResult.Items ?? []) as InvolvedPerson[];
  const workerNames = persons.map((p) => p.full_name);

  // Build summary view from incident data + regulatory data
  // Req 8.1: employer contact name, phone, incident location, date/time,
  //           workers involved count, worker names, brief description (max 500 chars)
  const summary: Record<string, unknown> = {
    employer_contact_name: regData?.['employer_contact_name'] ?? null,
    employer_contact_phone: regData?.['employer_contact_phone'] ?? null,
    incident_location: incident.location || null,
    incident_datetime: incident.incident_datetime || null,
    workers_involved_count: incident.persons_involved_count ?? null,
    worker_names: workerNames.length > 0 ? workerNames : (regData?.['worker_names'] ?? null),
    brief_description: incident.description
      ? incident.description.substring(0, 500)
      : null,
  };

  // Req 8.3: Indicate missing fields with a visual marker
  const missingFields: string[] = [];
  if (!summary['employer_contact_name']) missingFields.push('employer_contact_name');
  if (!summary['employer_contact_phone']) missingFields.push('employer_contact_phone');
  if (!summary['incident_location']) missingFields.push('incident_location');
  if (!summary['incident_datetime']) missingFields.push('incident_datetime');
  if (summary['workers_involved_count'] === null || summary['workers_involved_count'] === undefined) {
    missingFields.push('workers_involved_count');
  }
  if (!summary['worker_names'] || (Array.isArray(summary['worker_names']) && (summary['worker_names'] as string[]).length === 0)) {
    missingFields.push('worker_names');
  }
  if (!summary['brief_description']) missingFields.push('brief_description');

  return createSuccessResponse(200, {
    incident_id: incidentId,
    summary,
    missing_fields: missingFields,
    is_complete: missingFields.length === 0,
  });
}

// --- Export Route Wrappers (Task 5.2) ---

/**
 * POST /incidents/export
 * Delegates to the export handler for operational CSV or OSHA Form 300 CSV generation.
 *
 * Requirements: 17.1, 17.2, 17.4
 */
async function handleExportRequest(
  event: ApiGatewayEvent,
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  // Req 21.3: Only specific roles can export
  if (!EXPORT_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }
  return handleOperationalExport(event, user);
}

/**
 * POST /incidents/{id}/worksafebc-summary/export
 * Delegates to the export handler for WorkSafeBC PDF generation.
 *
 * Requirements: 8.2, 17.3
 */
async function handleWorksafebcExportRoute(
  _event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Req 21.3: Only specific roles can export
  if (!EXPORT_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }
  return handleWorksafebcExport(user, incidentId);
}

/**
 * GET /incidents/osha-300a
 * Delegates to the export handler for OSHA Form 300A annual summary.
 *
 * Requirements: 10.3
 */
async function handleOsha300aRoute(
  user: AuthenticatedUser,
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  // Req 21.3: Only specific roles can export
  if (!EXPORT_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }
  return handleOsha300aSummary(user, queryParams);
}

// --- Linked Documents Handlers (incident-timeline) ---

/** Roles that can create links between incidents and form responses (Req 8.1) */
const LINK_CREATE_ROLES: Role[] = [
  Role.TENANT_ADMIN,
  Role.SITE_ADMIN,
  Role.SUPERVISOR,
  Role.CSO,
];

const FORM_RESPONSES_TABLE = 'FormResponses';

/**
 * POST /incidents/{id}/linked-documents
 * Creates a link between an incident and a form response.
 * Validates payload, checks for duplicates, looks up form response data,
 * creates the linked document record, audit event, and increments count.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.2, 2.3, 8.1
 */
async function handleCreateLinkedDocument(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string
): Promise<ApiGatewayResponse> {
  // Req 8.1: Only specific roles can create links
  if (!LINK_CREATE_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }

  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  // Req 1.5, 2.2, 2.3: Validate payload with createLinkSchema
  const validation = createLinkSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const data = validation.data;

  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // Site-scoped roles: verify the incident is in an assigned site
  if (SITE_SCOPED_ROLES.includes(user.role)) {
    const assignedSites = user.assigned_sites ?? [];
    if (!assignedSites.includes(incident.site_id)) {
      return forbidden('Access denied');
    }
  }

  // Req 1.4: Check for duplicate active link
  const alreadyLinked = await isAlreadyLinked(incidentId, data.response_id);
  if (alreadyLinked) {
    return conflict('This form response is already linked to this incident');
  }

  // Verify form response exists and belongs to same tenant
  const formResponseResult = await docClient.send(
    new GetCommand({
      TableName: getTableName(FORM_RESPONSES_TABLE),
      Key: {
        PK: `FORM#${data.form_id}`,
        SK: `RESPONSE#${data.response_id}`,
      },
    })
  );

  if (!formResponseResult.Item) {
    return notFound('Form response not found');
  }

  const formResponse = formResponseResult.Item as Record<string, unknown>;

  // Tenant isolation: verify the form response belongs to the same tenant
  if (formResponse['tenant_id'] !== user.tenant_id) {
    return notFound('Form response not found');
  }

  // Extract denormalized data from form response
  const formName = (formResponse['form_name'] as string) ?? '';
  const folio = (formResponse['folio'] as string) ?? '';
  const responseSubmittedAt = (formResponse['submitted_at'] as string) ?? '';
  const responseSubmittedBy = (formResponse['submitted_by_name'] as string) ?? (formResponse['respondent_name'] as string) ?? '';

  // Req 1.2: Create the linked document record
  const linkedDocument = await createLinkedDocument({
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    response_id: data.response_id,
    form_id: data.form_id,
    document_category: data.document_category,
    custom_category_description: data.custom_category_description,
    context_note: data.context_note,
    linked_by: user.user_id,
    linked_by_name: user.email ?? user.user_id,
    form_name: formName,
    folio,
    response_submitted_at: responseSubmittedAt,
    response_submitted_by: responseSubmittedBy,
  });

  // Req 1.3: Create audit trail event for document_linked
  const now = new Date().toISOString();
  const timelineEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.DOCUMENT_LINKED,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      link_id: linkedDocument.link_id,
      response_id: data.response_id,
      form_id: data.form_id,
      form_name: formName,
      folio,
      document_category: data.document_category,
    },
    timestamp: now,
  };
  await appendEvent(timelineEvent);

  // Increment the denormalized linked_documents_count on the incident
  await incrementLinkedDocumentsCount(user.tenant_id, incidentId);

  return createSuccessResponse(201, { linked_document: linkedDocument });
}

/**
 * GET /incidents/{id}/linked-documents
 * Lists active linked documents for an incident with optional category filtering.
 * Any authenticated user with read access to the incident can view linked documents.
 *
 * Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 8.3
 */
async function handleGetLinkedDocuments(
  user: AuthenticatedUser,
  incidentId: string,
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  // Roles with no incident visibility
  if (user.role === Role.WORKER || user.role === Role.GATE_OPERATOR) {
    return forbidden('You do not have permission to perform this action');
  }

  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // Site-scoped roles: verify the incident is in an assigned site
  if (SITE_SCOPED_ROLES.includes(user.role)) {
    const assignedSites = user.assigned_sites ?? [];
    if (!assignedSites.includes(incident.site_id)) {
      return forbidden('Access denied');
    }
  }

  // Parse and validate query params
  const validation = filterLinkedDocsSchema.safeParse(queryParams ?? {});
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { categories: categoriesParam } = validation.data;

  // Extract categories from comma-separated string into an array of DocumentCategory values
  let categories: DocumentCategory[] | undefined;
  if (categoriesParam) {
    categories = categoriesParam.split(',').map((c) => c.trim()) as DocumentCategory[];
  }

  // Fetch linked documents with optional category filter
  const result = await getLinkedDocuments(incidentId, { categories });

  return createSuccessResponse(200, {
    linked_documents: result.linked_documents,
    total_count: result.total_count,
  });
}

/**
 * GET /incidents/{id}/linkable-responses
 * Searches for form responses available to link to an incident.
 * Validates query params, checks permissions, filters by tenant,
 * excludes already-linked responses, and paginates results.
 *
 * Requirements: 1.1, 6.1, 6.2, 6.3, 6.4, 8.1
 */
async function handleSearchLinkableResponses(
  user: AuthenticatedUser,
  incidentId: string,
  queryParams: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  // Req 8.1: Only specific roles can search for linkable responses
  if (!LINK_CREATE_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }

  // Validate query params with searchResponsesSchema
  const validation = searchResponsesSchema.safeParse(queryParams ?? {});
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { search, date_from, date_to, page, page_size } = validation.data;

  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // Site-scoped roles: verify the incident is in an assigned site
  if (SITE_SCOPED_ROLES.includes(user.role)) {
    const assignedSites = user.assigned_sites ?? [];
    if (!assignedSites.includes(incident.site_id)) {
      return forbidden('Access denied');
    }
  }

  // Req 1.1, 6.1, 6.2, 6.4: Query linkable responses filtered by tenant_id
  const result = await getLinkableResponses(user.tenant_id, {
    search,
    dateFrom: date_from,
    dateTo: date_to,
    page,
    pageSize: page_size,
  });

  // Exclude responses already actively linked to this incident
  const linkedDocs = await getLinkedDocuments(incidentId);
  const linkedResponseIds = new Set(
    linkedDocs.linked_documents.map((doc) => doc.response_id)
  );

  const filteredResponses = result.responses.filter(
    (r) => !linkedResponseIds.has(r.response_id)
  );

  return createSuccessResponse(200, {
    responses: filteredResponses,
    total_count: result.total_count - (result.responses.length - filteredResponses.length),
    page: result.page,
    page_size: result.page_size,
  });
}

/**
 * DELETE /incidents/{id}/linked-documents/{linkId}
 * Soft-deletes a linked document (marks it as unlinked) with justification,
 * creates an audit trail event, and decrements the linked documents count.
 *
 * Restricted to tenant_admin and cso roles only (Req 8.2).
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 8.2
 */
async function handleUnlinkDocument(
  event: ApiGatewayEvent,
  user: AuthenticatedUser,
  incidentId: string,
  linkId: string
): Promise<ApiGatewayResponse> {
  // Req 8.2: Only tenant_admin and cso can unlink documents
  if (!UNLINK_ROLES.includes(user.role)) {
    return forbidden('You do not have permission to perform this action');
  }

  // Validate body with unlinkSchema (justification min 10 chars)
  const body = parseBody(event);
  if (!body) return badRequest('Request body is required');

  const validation = unlinkSchema.safeParse(body);
  if (!validation.success) {
    return badRequest('Validation failed', {
      errors: validation.error.flatten().fieldErrors,
    });
  }

  const { justification } = validation.data;

  // Verify incident exists and belongs to tenant
  const incident = await getIncident(user.tenant_id, incidentId);
  if (!incident) {
    return notFound('Incident not found');
  }

  // Execute soft delete
  const unlinkedDoc = await unlinkDocument(incidentId, linkId, {
    unlinked_by: user.user_id,
    unlinked_by_name: user.email ?? user.user_id,
    unlink_justification: justification,
  });

  // If the document was not found (already unlinked or doesn't exist), return 404
  if (!unlinkedDoc) {
    return notFound('Linked document not found');
  }

  // Create audit trail event (document_unlinked)
  const now = new Date().toISOString();
  const timelineEvent: TimelineEvent = {
    event_id: uuidv4(),
    incident_id: incidentId,
    tenant_id: user.tenant_id,
    event_type: TimelineEventType.DOCUMENT_UNLINKED,
    actor_id: user.user_id,
    actor_name: user.email ?? user.user_id,
    data: {
      link_id: linkId,
      response_id: unlinkedDoc.response_id,
      form_name: unlinkedDoc.form_name,
      folio: unlinkedDoc.folio,
      justification,
    },
    timestamp: now,
  };
  await appendEvent(timelineEvent);

  // Decrement linked_documents_count on the incident
  await decrementLinkedDocumentsCount(user.tenant_id, incidentId);

  return createSuccessResponse(200, { linked_document: unlinkedDoc });
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
