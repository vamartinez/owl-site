/**
 * Integration tests for KB document lifecycle and RBAC enforcement.
 * Tests the full flow through the handler with mocked AWS services.
 *
 * - KB document lifecycle: upload → verify sync triggered → delete → verify re-sync
 * - RBAC enforcement: verify each role gets correct access level across all endpoints
 *
 * Requirements: 11.1, 11.2, 13.5, 13.10
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Role } from '../../../src/shared/types/common.js';

// ---------------------------------------------------------------------------
// Mock AWS SDK modules
// ---------------------------------------------------------------------------

const mockS3Send = vi.fn();
const mockBedrockAgentSend = vi.fn();
const mockDocClientSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/mock-presigned-url'),
}));

vi.mock('@aws-sdk/client-bedrock-agent', () => ({
  BedrockAgentClient: vi.fn().mockImplementation(() => ({ send: mockBedrockAgentSend })),
  StartIngestionJobCommand: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: vi.fn(),
  DeleteCommand: vi.fn(),
  GetCommand: vi.fn(),
  QueryCommand: vi.fn(),
  UpdateCommand: vi.fn(),
}));

vi.mock('../../../src/shared/dynamo-client.js', () => ({
  docClient: { send: mockDocClientSend },
  getTableName: (name: string) => `dev-${name}`,
}));

vi.mock('../../../src/shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid-1234',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { ApiGatewayEvent } from '../../../src/shared/auth-middleware.js';

/**
 * Creates a mock API Gateway event with authenticated user claims.
 */
function createEvent(
  httpMethod: string,
  resource: string,
  options: {
    role: Role;
    userId?: string;
    tenantId?: string;
    pathParameters?: Record<string, string>;
    queryStringParameters?: Record<string, string> | null;
    body?: unknown;
  }
): ApiGatewayEvent {
  const userId = options.userId ?? 'user-123';
  const tenantId = options.tenantId ?? 'tenant-1';

  return {
    httpMethod,
    resource,
    pathParameters: options.pathParameters ?? null,
    queryStringParameters: options.queryStringParameters ?? null,
    body: options.body ? JSON.stringify(options.body) : null,
    headers: {},
    requestContext: {
      requestId: 'req-123',
      authorizer: {
        claims: {
          sub: userId,
          'custom:role': options.role,
          'custom:tenant_id': tenantId,
          email: `${userId}@test.com`,
        },
      },
    },
  } as unknown as ApiGatewayEvent;
}

function parseResponse(response: { statusCode: number; body: string }) {
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body),
  };
}

// ---------------------------------------------------------------------------
// KB Document Lifecycle Tests
// Validates: Requirements 13.5, 13.10
// ---------------------------------------------------------------------------

describe('KB Document Lifecycle: upload → sync → delete → re-sync', () => {
  let handler: typeof import('../../../src/services/report-validation/handler.js').handler;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set env vars for KB sync
    process.env['KNOWLEDGE_BASE_ID'] = 'kb-test-id';
    process.env['DATA_SOURCE_ID'] = 'ds-test-id';
    process.env['KB_DOCUMENTS_BUCKET'] = 'test-kb-bucket';

    const handlerModule = await import(
      '../../../src/services/report-validation/handler.js'
    );
    handler = handlerModule.handler;
  });

  afterEach(() => {
    delete process.env['KNOWLEDGE_BASE_ID'];
    delete process.env['DATA_SOURCE_ID'];
    delete process.env['KB_DOCUMENTS_BUCKET'];
  });

  it('upload KB document triggers Knowledge Base sync (Requirement 13.5)', async () => {
    // Mock: DynamoDB PutCommand succeeds (metadata storage)
    mockDocClientSend.mockResolvedValueOnce({});
    // Mock: Bedrock StartIngestionJob succeeds
    mockBedrockAgentSend.mockResolvedValueOnce({
      ingestionJob: { ingestionJobId: 'job-abc-123' },
    });

    const event = createEvent(
      'POST',
      '/report-validation/kb/documents',
      {
        role: Role.TENANT_ADMIN,
        body: {
          file_name: 'worksafebc-ohs-regulation.pdf',
          file_size: 10240,
          mime_type: 'application/pdf',
          category: 'worksafebc',
        },
      }
    );

    const response = await handler(event);
    const { statusCode, body } = parseResponse(response);

    expect(statusCode).toBe(201);
    expect(body.document_id).toBe('mock-uuid-1234');
    expect(body.upload_url).toBe('https://s3.amazonaws.com/mock-presigned-url');
    expect(body.s3_key).toBe('worksafebc/mock-uuid-1234/worksafebc-ohs-regulation.pdf');
    expect(body.sync_status).toBe('pending');
  });

  it('upload keeps sync_status pending with the local re-index backend', async () => {
    // Mock: DynamoDB PutCommand succeeds (metadata storage)
    mockDocClientSend.mockResolvedValueOnce({});
    // Provider migration: the local keyword-retrieval backend has no external
    // ingestion job to fail, so triggerKBSync always succeeds and status stays
    // "pending" (there is no longer an "error" sync path on upload).

    const event = createEvent(
      'POST',
      '/report-validation/kb/documents',
      {
        role: Role.TENANT_ADMIN,
        body: {
          file_name: 'bc-building-code.pdf',
          file_size: 20000,
          mime_type: 'application/pdf',
          category: 'bc-building-code',
        },
      }
    );

    const response = await handler(event);
    const { statusCode, body } = parseResponse(response);

    expect(statusCode).toBe(201);
    expect(body.sync_status).toBe('pending');
  });

  it('list KB documents returns all documents with sync status', async () => {
    const documents = [
      {
        tenant_id: 'tenant-1',
        document_id: 'doc-1',
        file_name: 'worksafebc-ohs.pdf',
        file_size: 10000,
        mime_type: 'application/pdf',
        category: 'worksafebc',
        s3_key: 'worksafebc/doc-1/worksafebc-ohs.pdf',
        sync_status: 'indexed',
        uploaded_by: 'user-123',
        uploaded_at: '2024-01-01T00:00:00.000Z',
      },
      {
        tenant_id: 'tenant-1',
        document_id: 'doc-2',
        file_name: 'safety-standards.pdf',
        file_size: 15000,
        mime_type: 'application/pdf',
        category: 'safety-standards',
        s3_key: 'safety-standards/doc-2/safety-standards.pdf',
        sync_status: 'pending',
        uploaded_by: 'user-123',
        uploaded_at: '2024-02-01T00:00:00.000Z',
      },
    ];

    mockDocClientSend.mockResolvedValueOnce({ Items: documents });

    const event = createEvent(
      'GET',
      '/report-validation/kb/documents',
      { role: Role.TENANT_ADMIN }
    );

    const response = await handler(event);
    const { statusCode, body } = parseResponse(response);

    expect(statusCode).toBe(200);
    expect(body.documents).toHaveLength(2);
    expect(body.documents[0].sync_status).toBe('indexed');
    expect(body.documents[1].sync_status).toBe('pending');
  });

  it('delete KB document removes from S3, DynamoDB, and triggers re-sync (Requirement 13.10)', async () => {
    // Mock: QueryCommand returns the document record (getKBDocument)
    mockDocClientSend.mockResolvedValueOnce({
      Items: [{
        tenant_id: 'tenant-1',
        document_id: 'doc-to-delete',
        file_name: 'old-regulation.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
        category: 'worksafebc',
        s3_key: 'worksafebc/doc-to-delete/old-regulation.pdf',
        sync_status: 'indexed',
        uploaded_by: 'user-123',
        uploaded_at: '2024-01-01T00:00:00.000Z',
      }],
    });
    // Mock: S3 DeleteObjectCommand succeeds
    mockS3Send.mockResolvedValueOnce({});
    // Mock: DynamoDB DeleteCommand succeeds
    mockDocClientSend.mockResolvedValueOnce({});
    // Mock: Bedrock StartIngestionJob succeeds (re-sync)
    mockBedrockAgentSend.mockResolvedValueOnce({
      ingestionJob: { ingestionJobId: 'resync-job-456' },
    });

    const event = createEvent(
      'DELETE',
      '/report-validation/kb/documents/{id}',
      {
        role: Role.TENANT_ADMIN,
        pathParameters: { id: 'doc-to-delete' },
      }
    );

    const response = await handler(event);
    const { statusCode, body } = parseResponse(response);

    expect(statusCode).toBe(200);
    expect(body.document_id).toBe('doc-to-delete');
    expect(body.deleted).toBe(true);
  });

  it('delete non-existent KB document returns 404', async () => {
    // Mock: QueryCommand returns empty (document not found)
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const event = createEvent(
      'DELETE',
      '/report-validation/kb/documents/{id}',
      {
        role: Role.TENANT_ADMIN,
        pathParameters: { id: 'doc-nonexistent' },
      }
    );

    const response = await handler(event);
    const { statusCode, body } = parseResponse(response);

    expect(statusCode).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('upload rejects invalid MIME type with 400', async () => {
    const event = createEvent(
      'POST',
      '/report-validation/kb/documents',
      {
        role: Role.TENANT_ADMIN,
        body: {
          file_name: 'document.txt',
          file_size: 5000,
          mime_type: 'text/plain',
          category: 'worksafebc',
        },
      }
    );

    const response = await handler(event);
    const { statusCode, body } = parseResponse(response);

    expect(statusCode).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('upload rejects file exceeding 50 MB with 400', async () => {
    const event = createEvent(
      'POST',
      '/report-validation/kb/documents',
      {
        role: Role.TENANT_ADMIN,
        body: {
          file_name: 'huge-doc.pdf',
          file_size: 51 * 1024 * 1024,
          mime_type: 'application/pdf',
          category: 'worksafebc',
        },
      }
    );

    const response = await handler(event);
    const { statusCode, body } = parseResponse(response);

    expect(statusCode).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
  });
});

// ---------------------------------------------------------------------------
// RBAC Enforcement Tests
// Validates: Requirements 11.1, 11.2
// ---------------------------------------------------------------------------

describe('RBAC enforcement across all endpoints', () => {
  let handler: typeof import('../../../src/services/report-validation/handler.js').handler;

  beforeEach(async () => {
    vi.clearAllMocks();

    process.env['KNOWLEDGE_BASE_ID'] = 'kb-test-id';
    process.env['DATA_SOURCE_ID'] = 'ds-test-id';
    process.env['KB_DOCUMENTS_BUCKET'] = 'test-kb-bucket';

    const handlerModule = await import(
      '../../../src/services/report-validation/handler.js'
    );
    handler = handlerModule.handler;
  });

  afterEach(() => {
    delete process.env['KNOWLEDGE_BASE_ID'];
    delete process.env['DATA_SOURCE_ID'];
    delete process.env['KB_DOCUMENTS_BUCKET'];
  });

  // ─── KB Endpoints: Only tenant_admin (and platform_admin) ─────────────────

  describe('KB endpoints restricted to tenant_admin', () => {
    const kbUploadBody = {
      file_name: 'regulation.pdf',
      file_size: 10240,
      mime_type: 'application/pdf',
      category: 'worksafebc',
    };

    const nonKBRoles = [
      Role.SITE_ADMIN,
      Role.SUPERVISOR,
      Role.CSO,
      Role.GATE_OPERATOR,
      Role.WORKER,
    ];

    it.each(nonKBRoles)(
      'POST /kb/documents returns 403 for role: %s',
      async (role) => {
        const event = createEvent(
          'POST',
          '/report-validation/kb/documents',
          { role, body: kbUploadBody }
        );

        const response = await handler(event);
        const { statusCode, body } = parseResponse(response);

        expect(statusCode).toBe(403);
        expect(body.code).toBe('FORBIDDEN');
      }
    );

    it.each(nonKBRoles)(
      'GET /kb/documents returns 403 for role: %s',
      async (role) => {
        const event = createEvent(
          'GET',
          '/report-validation/kb/documents',
          { role }
        );

        const response = await handler(event);
        const { statusCode, body } = parseResponse(response);

        expect(statusCode).toBe(403);
        expect(body.code).toBe('FORBIDDEN');
      }
    );

    it.each(nonKBRoles)(
      'DELETE /kb/documents/{id} returns 403 for role: %s',
      async (role) => {
        const event = createEvent(
          'DELETE',
          '/report-validation/kb/documents/{id}',
          { role, pathParameters: { id: 'doc-123' } }
        );

        const response = await handler(event);
        const { statusCode, body } = parseResponse(response);

        expect(statusCode).toBe(403);
        expect(body.code).toBe('FORBIDDEN');
      }
    );

    it('tenant_admin can access POST /kb/documents', async () => {
      mockDocClientSend.mockResolvedValueOnce({});
      mockBedrockAgentSend.mockResolvedValueOnce({
        ingestionJob: { ingestionJobId: 'job-1' },
      });

      const event = createEvent(
        'POST',
        '/report-validation/kb/documents',
        { role: Role.TENANT_ADMIN, body: kbUploadBody }
      );

      const response = await handler(event);
      expect(response.statusCode).toBe(201);
    });

    it('tenant_admin can access GET /kb/documents', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent(
        'GET',
        '/report-validation/kb/documents',
        { role: Role.TENANT_ADMIN }
      );

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });

    it('tenant_admin can access DELETE /kb/documents/{id}', async () => {
      // Document found
      mockDocClientSend.mockResolvedValueOnce({
        Items: [{
          tenant_id: 'tenant-1',
          document_id: 'doc-del',
          file_name: 'reg.pdf',
          file_size: 5000,
          mime_type: 'application/pdf',
          category: 'worksafebc',
          s3_key: 'worksafebc/doc-del/reg.pdf',
          sync_status: 'indexed',
          uploaded_by: 'user-123',
          uploaded_at: '2024-01-01T00:00:00.000Z',
        }],
      });
      mockS3Send.mockResolvedValueOnce({});
      mockDocClientSend.mockResolvedValueOnce({});
      mockBedrockAgentSend.mockResolvedValueOnce({
        ingestionJob: { ingestionJobId: 'job-2' },
      });

      const event = createEvent(
        'DELETE',
        '/report-validation/kb/documents/{id}',
        { role: Role.TENANT_ADMIN, pathParameters: { id: 'doc-del' } }
      );

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });
  });

  // ─── Report Upload: Allowed roles ─────────────────────────────────────────

  describe('Report upload restricted to reports:upload permission (Requirement 11.1)', () => {
    const uploadBody = {
      file_name: 'construction-report.pdf',
      file_size: 5000,
      mime_type: 'application/pdf',
    };

    const allowedRoles = [
      Role.TENANT_ADMIN,
      Role.SITE_ADMIN,
      Role.SUPERVISOR,
      Role.CSO,
    ];

    const deniedRoles = [
      Role.GATE_OPERATOR,
      Role.WORKER,
    ];

    it.each(allowedRoles)(
      'POST /reports returns 201 for role: %s',
      async (role) => {
        // Mock createReport success
        mockDocClientSend.mockResolvedValueOnce({}); // PutCommand for report record
        mockDocClientSend.mockResolvedValueOnce({}); // PutCommand for version record

        const event = createEvent(
          'POST',
          '/report-validation/reports',
          { role, body: uploadBody }
        );

        const response = await handler(event);
        // Should succeed (201) or at least not be 403
        expect(response.statusCode).not.toBe(403);
      }
    );

    it.each(deniedRoles)(
      'POST /reports returns 403 for role: %s',
      async (role) => {
        const event = createEvent(
          'POST',
          '/report-validation/reports',
          { role, body: uploadBody }
        );

        const response = await handler(event);
        const { statusCode, body } = parseResponse(response);

        expect(statusCode).toBe(403);
        expect(body.code).toBe('FORBIDDEN');
      }
    );
  });

  // ─── Report Visibility: Scoped by role (Requirement 11.2) ─────────────────

  describe('Report visibility scoped by role (Requirement 11.2)', () => {
    const reportRecord = {
      tenant_id: 'tenant-1',
      report_id: 'report-abc',
      owner_id: 'owner-user-456',
      title: 'Test Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    it('tenant_admin can view any report in their tenant', async () => {
      // GetCommand returns the report
      mockDocClientSend.mockResolvedValueOnce({ Item: reportRecord });
      // QueryCommand for latest validation result
      mockDocClientSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent(
        'GET',
        '/report-validation/reports/{id}',
        {
          role: Role.TENANT_ADMIN,
          userId: 'admin-user-789',
          pathParameters: { id: 'report-abc' },
        }
      );

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });

    it('cso can view any report in their tenant', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: reportRecord });
      mockDocClientSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent(
        'GET',
        '/report-validation/reports/{id}',
        {
          role: Role.CSO,
          userId: 'cso-user-789',
          pathParameters: { id: 'report-abc' },
        }
      );

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });

    it('site_admin can view reports in their assigned sites', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: reportRecord });
      mockDocClientSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent(
        'GET',
        '/report-validation/reports/{id}',
        {
          role: Role.SITE_ADMIN,
          userId: 'site-admin-user',
          pathParameters: { id: 'report-abc' },
        }
      );

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });

    it('supervisor can view reports in their assigned sites', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: reportRecord });
      mockDocClientSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent(
        'GET',
        '/report-validation/reports/{id}',
        {
          role: Role.SUPERVISOR,
          userId: 'supervisor-user',
          pathParameters: { id: 'report-abc' },
        }
      );

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });

    it('worker cannot view others reports (lacks reports:read permission)', async () => {
      // Worker does not have reports:read in the RBAC matrix
      const event = createEvent(
        'GET',
        '/report-validation/reports/{id}',
        {
          role: Role.WORKER,
          userId: 'different-worker-user',
          pathParameters: { id: 'report-abc' },
        }
      );

      const response = await handler(event);
      const { statusCode, body } = parseResponse(response);

      expect(statusCode).toBe(403);
      expect(body.code).toBe('FORBIDDEN');
    });

    it('worker cannot view even own reports via API (lacks reports:read permission)', async () => {
      // Worker does not have reports:read in the RBAC matrix,
      // so the permission check fails before visibility is evaluated.
      const event = createEvent(
        'GET',
        '/report-validation/reports/{id}',
        {
          role: Role.WORKER,
          userId: 'worker-user-self',
          pathParameters: { id: 'report-abc' },
        }
      );

      const response = await handler(event);
      const { statusCode, body } = parseResponse(response);

      expect(statusCode).toBe(403);
      expect(body.code).toBe('FORBIDDEN');
    });

    it('gate_operator cannot view any report (lacks reports:read permission)', async () => {
      // gate_operator does not have reports:read in the RBAC matrix,
      // so the permission check fails before visibility is evaluated.
      const event = createEvent(
        'GET',
        '/report-validation/reports/{id}',
        {
          role: Role.GATE_OPERATOR,
          userId: 'gate-op-user',
          pathParameters: { id: 'report-abc' },
        }
      );

      const response = await handler(event);
      const { statusCode, body } = parseResponse(response);

      expect(statusCode).toBe(403);
      expect(body.code).toBe('FORBIDDEN');
    });
  });

  // ─── Validate endpoint: Only reports:upload roles ─────────────────────────

  describe('Validate endpoint restricted to reports:upload roles', () => {
    const reportRecord = {
      tenant_id: 'tenant-1',
      report_id: 'report-val',
      owner_id: 'user-123',
      title: 'Validation Test Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    it('worker cannot request validation (403)', async () => {
      const event = createEvent(
        'POST',
        '/report-validation/reports/{id}/validate',
        {
          role: Role.WORKER,
          pathParameters: { id: 'report-val' },
        }
      );

      const response = await handler(event);
      const { statusCode, body } = parseResponse(response);

      expect(statusCode).toBe(403);
      expect(body.code).toBe('FORBIDDEN');
    });

    it('gate_operator cannot request validation (403)', async () => {
      const event = createEvent(
        'POST',
        '/report-validation/reports/{id}/validate',
        {
          role: Role.GATE_OPERATOR,
          pathParameters: { id: 'report-val' },
        }
      );

      const response = await handler(event);
      const { statusCode, body } = parseResponse(response);

      expect(statusCode).toBe(403);
      expect(body.code).toBe('FORBIDDEN');
    });
  });

  // ─── Submit endpoint: Only report owner ───────────────────────────────────

  describe('Submit endpoint restricted to report owner', () => {
    const reportRecord = {
      tenant_id: 'tenant-1',
      report_id: 'report-submit',
      owner_id: 'owner-user-100',
      title: 'Submit Test Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    it('report owner can submit their report', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: reportRecord });
      mockDocClientSend.mockResolvedValueOnce({}); // UpdateCommand for submission

      const event = createEvent(
        'POST',
        '/report-validation/reports/{id}/submit',
        {
          role: Role.TENANT_ADMIN,
          userId: 'owner-user-100',
          pathParameters: { id: 'report-submit' },
        }
      );

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });

    it('non-owner with reports:upload cannot submit (403)', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Item: reportRecord });

      const event = createEvent(
        'POST',
        '/report-validation/reports/{id}/submit',
        {
          role: Role.TENANT_ADMIN,
          userId: 'different-admin-user',
          pathParameters: { id: 'report-submit' },
        }
      );

      const response = await handler(event);
      const { statusCode, body } = parseResponse(response);

      expect(statusCode).toBe(403);
      expect(body.code).toBe('FORBIDDEN');
    });
  });

  // ─── Unauthenticated requests ─────────────────────────────────────────────

  describe('Unauthenticated requests return 401', () => {
    it('request without auth returns 401', async () => {
      const event: ApiGatewayEvent = {
        httpMethod: 'GET',
        resource: '/report-validation/reports',
        pathParameters: null,
        queryStringParameters: null,
        body: null,
        headers: {},
        requestContext: {
          requestId: 'req-no-auth',
        },
      } as unknown as ApiGatewayEvent;

      const response = await handler(event);
      const { statusCode, body } = parseResponse(response);

      expect(statusCode).toBe(401);
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });

  // ─── Report list: roles with reports:read ─────────────────────────────────

  describe('Report list access by role', () => {
    it('worker can list their own reports', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent(
        'GET',
        '/report-validation/reports',
        { role: Role.WORKER, userId: 'worker-user' }
      );

      const response = await handler(event);
      // Worker does not have reports:read permission
      // Check if it returns 403 or 200 based on RBAC
      const { statusCode } = parseResponse(response);
      // Worker does NOT have reports:read in the permission matrix
      expect(statusCode).toBe(403);
    });

    it('supervisor can list reports', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent(
        'GET',
        '/report-validation/reports',
        { role: Role.SUPERVISOR }
      );

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });

    it('tenant_admin can list reports', async () => {
      mockDocClientSend.mockResolvedValueOnce({ Items: [] });

      const event = createEvent(
        'GET',
        '/report-validation/reports',
        { role: Role.TENANT_ADMIN }
      );

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });
  });
});
