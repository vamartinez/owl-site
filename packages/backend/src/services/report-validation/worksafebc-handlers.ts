/**
 * WorkSafeBC PDF Compliance Agent — API handlers.
 *
 * Session lifecycle (upload → categorize → poll/get → list → reanalyze →
 * export) plus regulatory-version publish/list. Reuses report-validation's
 * S3 presigned pattern, DynamoDB client, RBAC, and the report-schema
 * pretty-printer. Async work is enqueued on pdf-compliance-analysis-queue.
 *
 * Requirements: 1.1-1.8, 3.4, 4.5, 5.1-5.7, 7.3, 7.6
 */

import { v4 as uuidv4 } from 'uuid';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { enforcePermission, hasPermission } from '../../shared/rbac.js';
import type { AuthenticatedUser } from '../../shared/auth-middleware.js';
import {
  createSuccessResponse,
  badRequest,
  notFound,
  forbidden,
  internalError,
  type ApiGatewayResponse,
} from '../../shared/error-handler.js';
import { createLogger } from '../../shared/logger.js';
import { prettyPrintReporteCumplimiento } from './report-schema.js';
import { publishRegulatoryVersion, listVersions, RegulatoryKBError } from './regulatory-kb-manager.js';
import {
  ANALYSIS_SESSIONS_TABLE,
  DOCUMENT_CATEGORIES,
  RETENTION_YEARS,
  type AnalysisSession,
  type DocumentCategory,
} from './worksafebc-types.js';

const logger = createLogger('worksafebc-handlers');
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});

const DOCUMENTS_BUCKET = (): string =>
  process.env['REPORT_DOCUMENTS_BUCKET'] ?? process.env['MEDIA_BUCKET_NAME'] ?? '';
const ANALYSIS_QUEUE_URL = (): string => process.env['PDF_COMPLIANCE_QUEUE_URL'] ?? '';
const SIGNED_URL_EXPIRY_SECONDS = 900;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 500;

/** Roles allowed to upload (Requirement 1.1, 1.7) — enforced via permission. */
function requireUpload(user: AuthenticatedUser): ApiGatewayResponse | null {
  return enforcePermission(user, 'worksafebc:upload');
}

function sessionPk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}
function sessionSk(sessionId: string): string {
  return `SESSION#${sessionId}`;
}

async function loadSession(tenantId: string, sessionId: string): Promise<AnalysisSession | null> {
  const res = await docClient.send(
    new GetCommand({
      TableName: getTableName(ANALYSIS_SESSIONS_TABLE),
      Key: { PK: sessionPk(tenantId), SK: sessionSk(sessionId) },
    })
  );
  return (res.Item as AnalysisSession | undefined) ?? null;
}

async function enqueue(kind: 'extract' | 'analyze', session: AnalysisSession): Promise<void> {
  const queueUrl = ANALYSIS_QUEUE_URL();
  if (!queueUrl) {
    logger.warn('PDF_COMPLIANCE_QUEUE_URL not set; skipping enqueue', { kind });
    return;
  }
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ kind, session_id: session.session_id, tenant_id: session.tenant_id }),
    })
  );
}

// ── 4.1 Create session (presigned upload) ───────────────────────────────────

export interface CreateSessionBody {
  document_name?: string;
  document_size_bytes?: number;
  document_page_count?: number;
  site_id?: string;
}

export async function handleCreateSession(
  user: AuthenticatedUser,
  body: CreateSessionBody
): Promise<ApiGatewayResponse> {
  const denied = requireUpload(user);
  if (denied) return denied;

  if (!body.site_id) return badRequest('site_id is required');
  const size = body.document_size_bytes ?? 0;
  if (size <= 0 || size > MAX_PDF_BYTES) {
    return badRequest(`document_size_bytes must be > 0 and <= ${MAX_PDF_BYTES}`);
  }
  if ((body.document_page_count ?? 0) > MAX_PAGES) {
    return badRequest(`document_page_count must be <= ${MAX_PAGES}`);
  }
  if (!DOCUMENTS_BUCKET()) return internalError('Document storage is not configured');

  const sessionId = uuidv4();
  const documentGroupId = uuidv4();
  const now = new Date().toISOString();
  const documentKey = `worksafebc/${user.tenant_id}/${sessionId}/${(body.document_name ?? 'document.pdf').replace(/[^\w.\-]/g, '_')}`;
  const retentionExpires = new Date(Date.now() + RETENTION_YEARS * 365 * 24 * 60 * 60 * 1000).toISOString();

  const session: AnalysisSession = {
    session_id: sessionId,
    tenant_id: user.tenant_id,
    site_id: body.site_id,
    document_group_id: documentGroupId,
    document_key: documentKey,
    document_name: body.document_name ?? 'document.pdf',
    document_size_bytes: size,
    document_page_count: body.document_page_count ?? 0,
    category: null,
    status: 'recibido',
    started_by: user.user_id,
    started_at: now,
    completed_at: null,
    extraction_metrics: null,
    ai_model_version: null,
    regulatory_kb_version_id: null,
    report: null,
    previous_session_id: null,
    failure_reason: null,
    notification_delivered: false,
    retention_expires_at: retentionExpires,
  };

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: DOCUMENTS_BUCKET(), Key: documentKey, ContentType: 'application/pdf' }),
      { expiresIn: SIGNED_URL_EXPIRY_SECONDS }
    );
  } catch (err) {
    logger.error('Presigned URL generation failed', { error: String(err) });
    return internalError('Upload service temporarily unavailable');
  }

  await docClient.send(
    new PutCommand({
      TableName: getTableName(ANALYSIS_SESSIONS_TABLE),
      Item: {
        PK: sessionPk(user.tenant_id),
        SK: sessionSk(sessionId),
        GSI1PK: `TENANT#${user.tenant_id}#SITE#${body.site_id}`,
        GSI1SK: `SESSION#${now}`,
        GSI2PK: `TENANT#${user.tenant_id}#DOCUMENT#${documentGroupId}`,
        GSI2SK: `SESSION#${now}`,
        ...session,
      },
    })
  );

  return createSuccessResponse(201, {
    session_id: sessionId,
    upload_url: uploadUrl,
    document_key: documentKey,
    status: session.status,
  });
}

// ── 4.4 Categorize + enqueue extraction ──────────────────────────────────────

export async function handleCategorize(
  user: AuthenticatedUser,
  sessionId: string,
  body: { category?: string }
): Promise<ApiGatewayResponse> {
  const denied = requireUpload(user);
  if (denied) return denied;

  const category = body.category as DocumentCategory | undefined;
  if (!category || !DOCUMENT_CATEGORIES.includes(category)) {
    return badRequest(`category must be one of: ${DOCUMENT_CATEGORIES.join(', ')}`);
  }

  const session = await loadSession(user.tenant_id, sessionId);
  if (!session) return notFound('Session not found');
  if (session.status !== 'recibido') {
    return badRequest(`session must be in 'recibido' to categorize (is '${session.status}')`);
  }

  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(ANALYSIS_SESSIONS_TABLE),
      Key: { PK: sessionPk(user.tenant_id), SK: sessionSk(sessionId) },
      UpdateExpression: 'SET category = :c, #s = :st',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':c': category, ':st': 'categorizado' },
    })
  );

  await enqueue('extract', { ...session, category, status: 'categorizado' });
  return createSuccessResponse(200, { session_id: sessionId, status: 'categorizado', category });
}

// ── 10.1 Get session (tenant isolation, non-disclosure) ──────────────────────

export async function handleGetSession(
  user: AuthenticatedUser,
  sessionId: string
): Promise<ApiGatewayResponse> {
  const session = await loadSession(user.tenant_id, sessionId);
  // Tenant isolation: never confirm existence cross-tenant (Requirement 5.6).
  if (!session || session.tenant_id !== user.tenant_id) return notFound('Session not found');
  return createSuccessResponse(200, { session });
}

// ── 10.3 List sessions (paginated, role-scoped, filtered) ─────────────────────

export async function handleListSessions(
  user: AuthenticatedUser,
  query: Record<string, string> | null
): Promise<ApiGatewayResponse> {
  const pageSize = Math.min(Math.max(parseInt(query?.['page_size'] ?? '20', 10) || 20, 1), 100);
  const siteFilter = query?.['site'];
  const categoryFilter = query?.['category'];
  const levelFilter = query?.['compliance_level'];

  // Tenant-admins/platform-admins see all tenant sessions; site-scoped roles
  // are limited to assigned sites (Requirement 5.3). We query the base table
  // by tenant PK and filter in-handler (assigned_sites lists are small).
  const res = await docClient.send(
    new QueryCommand({
      TableName: getTableName(ANALYSIS_SESSIONS_TABLE),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': sessionPk(user.tenant_id), ':sk': 'SESSION#' },
      ScanIndexForward: false,
      Limit: pageSize * 4, // over-fetch to allow post-filtering
    })
  );

  const seesAllSites =
    hasPermission(user.role, 'tenant:configure') || hasPermission(user.role, 'users:manage');
  const assigned = new Set(user.assigned_sites ?? []);

  let items = (res.Items ?? []) as AnalysisSession[];
  items = items.filter((s) => {
    if (!seesAllSites && !assigned.has(s.site_id)) return false;
    if (siteFilter && s.site_id !== siteFilter) return false;
    if (categoryFilter && s.category !== categoryFilter) return false;
    if (levelFilter && s.report?.compliance_level !== levelFilter) return false;
    return true;
  });

  return createSuccessResponse(200, {
    sessions: items.slice(0, pageSize),
    page_size: pageSize,
    filters: { site: siteFilter ?? null, category: categoryFilter ?? null, compliance_level: levelFilter ?? null },
  });
}

// ── 10.4 Reanalyze (new session, same document_group_id) ─────────────────────

export async function handleReanalyze(
  user: AuthenticatedUser,
  sessionId: string
): Promise<ApiGatewayResponse> {
  const denied = requireUpload(user);
  if (denied) return denied;

  const original = await loadSession(user.tenant_id, sessionId);
  if (!original || original.tenant_id !== user.tenant_id) return notFound('Session not found');
  if (!original.category) return badRequest('original session was never categorized');

  const newId = uuidv4();
  const now = new Date().toISOString();
  const retentionExpires = new Date(Date.now() + RETENTION_YEARS * 365 * 24 * 60 * 60 * 1000).toISOString();

  const next: AnalysisSession = {
    ...original,
    session_id: newId,
    status: 'categorizado', // category already known; skip re-upload
    started_at: now,
    completed_at: null,
    extraction_metrics: null,
    ai_model_version: null,
    regulatory_kb_version_id: null,
    report: null,
    previous_session_id: original.session_id,
    failure_reason: null,
    notification_delivered: false,
    retention_expires_at: retentionExpires,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(ANALYSIS_SESSIONS_TABLE),
      Item: {
        PK: sessionPk(user.tenant_id),
        SK: sessionSk(newId),
        GSI1PK: `TENANT#${user.tenant_id}#SITE#${next.site_id}`,
        GSI1SK: `SESSION#${now}`,
        GSI2PK: `TENANT#${user.tenant_id}#DOCUMENT#${next.document_group_id}`,
        GSI2SK: `SESSION#${now}`,
        ...next,
      },
    })
  );
  await enqueue('extract', next);
  return createSuccessResponse(201, { session_id: newId, status: next.status, document_group_id: next.document_group_id });
}

// ── 12.4 Export report as JSON (pretty-printed) ──────────────────────────────

export async function handleExportReport(
  user: AuthenticatedUser,
  sessionId: string,
  format: string
): Promise<ApiGatewayResponse> {
  const session = await loadSession(user.tenant_id, sessionId);
  if (!session || session.tenant_id !== user.tenant_id) return notFound('Session not found');
  if (!session.report) return badRequest('report is not available for this session');

  if (format === 'json' || !format) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="compliance-report-${sessionId}.json"`,
      },
      body: prettyPrintReporteCumplimiento(session.report),
    };
  }
  // PDF export (task 12.5) is HTML+client-print per product decision — the
  // server returns the JSON and the frontend renders/print-to-PDF.
  return badRequest("format 'pdf' is produced client-side; request format=json");
}

// ── 3.4 Regulatory versions (publish / list) ─────────────────────────────────

export async function handlePublishRegulatoryVersion(
  user: AuthenticatedUser,
  body: unknown
): Promise<ApiGatewayResponse> {
  const denied = enforcePermission(user, 'kb:manage');
  if (denied) return denied;
  try {
    const version = await publishRegulatoryVersion({
      ...(body as { effective_date: string; change_summary: string; clauses: [] }),
      published_by: user.user_id,
    });
    return createSuccessResponse(201, { version });
  } catch (err) {
    if (err instanceof RegulatoryKBError) {
      return badRequest(err.message);
    }
    logger.error('publishRegulatoryVersion failed', { error: String(err) });
    return internalError('Failed to publish regulatory version');
  }
}

export async function handleListRegulatoryVersions(
  user: AuthenticatedUser
): Promise<ApiGatewayResponse> {
  const denied = enforcePermission(user, 'kb:manage');
  if (denied) return denied;
  const versions = await listVersions();
  return createSuccessResponse(200, { versions });
}

void forbidden; // reserved for future explicit-forbidden paths
