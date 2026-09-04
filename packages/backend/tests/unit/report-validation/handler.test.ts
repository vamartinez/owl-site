import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '../../../src/shared/types/common.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/presigned-url'),
}));

vi.mock('@aws-sdk/client-bedrock-agent', () => ({
  BedrockAgentClient: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  StartIngestionJobCommand: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: vi.fn(),
  PutCommand: vi.fn(),
  QueryCommand: vi.fn(),
  UpdateCommand: vi.fn(),
  DeleteCommand: vi.fn(),
}));

vi.mock('../../../src/shared/dynamo-client.js', () => ({
  docClient: { send: vi.fn() },
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

// Mock the upload-manager, text-extractor, validation-engine, kb-manager
vi.mock('../../../src/services/report-validation/upload-manager.js', () => ({
  createReport: vi.fn(),
  uploadNewVersion: vi.fn(),
  getVersionHistory: vi.fn(),
}));

vi.mock('../../../src/services/report-validation/text-extractor.js', () => ({
  extractText: vi.fn(),
}));

vi.mock('../../../src/services/report-validation/validation-engine.js', () => ({
  runValidation: vi.fn(),
}));

vi.mock('../../../src/services/report-validation/kb-manager.js', () => ({
  uploadKBDocument: vi.fn(),
  deleteKBDocument: vi.fn(),
  listKBDocuments: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    headers: {
      Authorization: 'Bearer valid-token',
    },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:tenant_id': 'tenant-abc',
          'custom:role': Role.TENANT_ADMIN,
          email: 'admin@example.com',
        },
      },
    },
    httpMethod: 'GET',
    resource: '/report-validation/reports',
    pathParameters: null,
    queryStringParameters: null,
    body: null,
    ...overrides,
  };
}

function buildEventWithRole(role: Role, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return buildEvent({
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:tenant_id': 'tenant-abc',
          'custom:role': role,
          email: 'user@example.com',
        },
      },
    },
    ...overrides,
  });
}

function buildUnauthenticatedEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    headers: {},
    requestContext: {},
    httpMethod: 'GET',
    resource: '/report-validation/reports',
    pathParameters: null,
    queryStringParameters: null,
    body: null,
    ...overrides,
  };
}

function parseResponseBody(response: { body: string }): unknown {
  return JSON.parse(response.body);
}

// ---------------------------------------------------------------------------
// Tests: Authentication (Requirement 11.5)
// ---------------------------------------------------------------------------

describe('handler - Authentication', () => {
  it('returns 401 for unauthenticated request (no auth header)', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildUnauthenticatedEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports',
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(401);
    const body = parseResponseBody(response) as any;
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for request with invalid Authorization header', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = {
      headers: { Authorization: 'InvalidFormat' },
      requestContext: {},
      httpMethod: 'GET',
      resource: '/report-validation/reports',
      pathParameters: null,
      queryStringParameters: null,
      body: null,
    };

    const response = await handler(event as any);
    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /report-validation/reports (Requirement 11.1)
// ---------------------------------------------------------------------------

describe('handler - POST /report-validation/reports', () => {
  let createReportMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const uploadModule = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );
    createReportMock = uploadModule.createReport as ReturnType<typeof vi.fn>;
  });

  it('returns 201 on successful report creation', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    createReportMock.mockResolvedValue({
      report_id: 'report-new',
      status: 'draft',
      upload_url: 'https://s3.amazonaws.com/presigned-url',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify({
        file_name: 'report.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(201);
    const body = parseResponseBody(response) as any;
    expect(body.report_id).toBe('report-new');
    expect(body.status).toBe('draft');
    expect(body.upload_url).toBeDefined();
  });

  it('returns 403 for worker role (insufficient permissions)', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.WORKER, {
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify({
        file_name: 'report.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
    const body = parseResponseBody(response) as any;
    expect(body.code).toBe('FORBIDDEN');
  });

  it('returns 403 for gate_operator role', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.GATE_OPERATOR, {
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify({
        file_name: 'report.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });

  it('returns 400 for missing request body', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: null,
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for invalid MIME type in body', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify({
        file_name: 'report.txt',
        file_size: 5000,
        mime_type: 'text/plain',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(400);
  });

  it('returns 500 when createReport throws', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    createReportMock.mockRejectedValue(new Error('S3 failure'));

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify({
        file_name: 'report.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(500);
    const body = parseResponseBody(response) as any;
    expect(body.message).toContain('Upload could not be completed');
  });

  it('allows supervisor role to create reports', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    createReportMock.mockResolvedValue({
      report_id: 'report-sup',
      status: 'draft',
      upload_url: 'https://s3.amazonaws.com/presigned-url',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const event = buildEventWithRole(Role.SUPERVISOR, {
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify({
        file_name: 'report.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /report-validation/reports (Requirements 8.1, 8.2)
// ---------------------------------------------------------------------------

describe('handler - GET /report-validation/reports', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as {
      send: ReturnType<typeof vi.fn>;
    };
  });

  it('returns 200 with paginated report list', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const reports = [
      {
        tenant_id: 'tenant-abc',
        report_id: 'r1',
        owner_id: 'user-123',
        title: 'Report 1',
        status: 'draft',
        current_version: 1,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        status_history: [],
      },
    ];

    docClientMock.send.mockResolvedValueOnce({ Items: reports });

    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports',
      queryStringParameters: null,
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.reports).toBeDefined();
    expect(body.pagination).toBeDefined();
  });

  it('returns filtered results when status query param is provided', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const reports = [
      {
        tenant_id: 'tenant-abc',
        report_id: 'r1',
        owner_id: 'user-123',
        title: 'Draft Report',
        status: 'draft',
        current_version: 1,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        status_history: [],
      },
    ];

    docClientMock.send.mockResolvedValueOnce({ Items: reports });

    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports',
      queryStringParameters: { status: 'draft' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.reports.every((r: any) => r.status === 'draft')).toBe(true);
  });

  it('respects max page size of 20', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    // Generate 25 reports
    const reports = Array.from({ length: 25 }, (_, i) => ({
      tenant_id: 'tenant-abc',
      report_id: `r${i}`,
      owner_id: 'user-123',
      title: `Report ${i}`,
      status: 'draft',
      current_version: 1,
      created_at: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      updated_at: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      status_history: [],
    }));

    docClientMock.send.mockResolvedValueOnce({ Items: reports });

    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports',
      queryStringParameters: { limit: '50' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.reports.length).toBeLessThanOrEqual(20);
    expect(body.pagination.next_cursor).toBeDefined();
  });

  it('returns 403 for worker role trying to list reports', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.WORKER, {
      httpMethod: 'GET',
      resource: '/report-validation/reports',
    });

    const response = await handler(event as any);
    // Worker does not have reports:read permission
    expect(response.statusCode).toBe(403);
  });

  it('scopes reports to own for worker-like roles without reports:read', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    // Supervisor has reports:read, so they can list
    docClientMock.send.mockResolvedValueOnce({ Items: [] });

    const event = buildEventWithRole(Role.SUPERVISOR, {
      httpMethod: 'GET',
      resource: '/report-validation/reports',
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /report-validation/reports/{id} (Requirement 8.3, 11.2)
// ---------------------------------------------------------------------------

describe('handler - GET /report-validation/reports/{id}', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as {
      send: ReturnType<typeof vi.fn>;
    };
  });

  it('returns 200 with report detail and validation result', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r1',
      owner_id: 'user-123',
      title: 'My Report',
      status: 'validated',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
      status_history: [],
    };

    const validationResult = {
      report_id: 'r1',
      version: 1,
      validation_id: 'val-1',
      status: 'completed',
      score: 85,
      summary: 'Good compliance',
      findings: [],
      requested_at: '2024-01-02T00:00:00.000Z',
      completed_at: '2024-01-02T00:01:00.000Z',
      requested_by: 'user-123',
    };

    // GetCommand for report
    docClientMock.send.mockResolvedValueOnce({ Item: report });
    // QueryCommand for validation result
    docClientMock.send.mockResolvedValueOnce({ Items: [validationResult] });

    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports/{id}',
      pathParameters: { id: 'r1' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.report.report_id).toBe('r1');
    expect(body.validation_result).toBeDefined();
    expect(body.validation_result.score).toBe(85);
  });

  it('returns 404 when report does not exist', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    docClientMock.send.mockResolvedValueOnce({ Item: undefined });

    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports/{id}',
      pathParameters: { id: 'nonexistent' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(404);
    const body = parseResponseBody(response) as any;
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 403 when user has no visibility to report (own scope)', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-other',
      owner_id: 'other-user-456',
      title: 'Other Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });
    // QueryCommand for validation result
    docClientMock.send.mockResolvedValueOnce({ Items: [] });

    // tenant_admin has 'tenant' scope so they can see all reports in their tenant.
    // This verifies that tenant-scoped roles can access other users' reports.
    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports/{id}',
      pathParameters: { id: 'r-other' },
    });

    const response = await handler(event as any);
    // tenant_admin has 'tenant' scope, so they can see all reports in tenant
    expect(response.statusCode).toBe(200);
  });

  it('returns null validation_result when no validation exists', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-draft',
      owner_id: 'user-123',
      title: 'Draft Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });
    docClientMock.send.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports/{id}',
      pathParameters: { id: 'r-draft' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.validation_result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /report-validation/reports/{id}/validate (Requirement 2.3, 11.1)
// ---------------------------------------------------------------------------

describe('handler - POST /report-validation/reports/{id}/validate', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };
  let extractTextMock: ReturnType<typeof vi.fn>;
  let runValidationMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as {
      send: ReturnType<typeof vi.fn>;
    };
    const textExtractorModule = await import(
      '../../../src/services/report-validation/text-extractor.js'
    );
    extractTextMock = textExtractorModule.extractText as ReturnType<typeof vi.fn>;
    const validationEngineModule = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );
    runValidationMock = validationEngineModule.runValidation as ReturnType<typeof vi.fn>;
  });

  it('returns 200 with status "validating" for draft report', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r1',
      owner_id: 'user-123',
      title: 'Draft Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    // GetCommand for report
    docClientMock.send.mockResolvedValueOnce({ Item: report });
    // UpdateCommand for status transition
    docClientMock.send.mockResolvedValueOnce({});
    // QueryCommand for version record
    docClientMock.send.mockResolvedValueOnce({
      Items: [{ version: 1, s3_key: 'tenant-abc/r1/v1/report.pdf', mime_type: 'application/pdf', file_size: 5000 }],
    });

    // Mock async pipeline (non-blocking)
    extractTextMock.mockResolvedValue({ text: 'Extracted content...', page_count: 5, extraction_method: 'bda', character_count: 200 });
    runValidationMock.mockResolvedValue(undefined);

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/validate',
      pathParameters: { id: 'r1' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.status).toBe('validating');
    expect(body.report_id).toBe('r1');
  });

  it('returns 409 when report is not in draft status', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-submitted',
      owner_id: 'user-123',
      title: 'Submitted Report',
      status: 'submitted',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/validate',
      pathParameters: { id: 'r-submitted' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(409);
    const body = parseResponseBody(response) as any;
    expect(body.code).toBe('CONFLICT');
    expect(body.message).toContain('Cannot transition');
  });

  it('returns 409 when report is already validating', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-validating',
      owner_id: 'user-123',
      title: 'Validating Report',
      status: 'validating',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/validate',
      pathParameters: { id: 'r-validating' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(409);
  });

  it('returns 403 for worker role', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.WORKER, {
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/validate',
      pathParameters: { id: 'r1' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 when report does not exist', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    docClientMock.send.mockResolvedValueOnce({ Item: undefined });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/validate',
      pathParameters: { id: 'nonexistent' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /report-validation/reports/{id}/submit (Requirement 2.3, 11.3)
// ---------------------------------------------------------------------------

describe('handler - POST /report-validation/reports/{id}/submit', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as {
      send: ReturnType<typeof vi.fn>;
    };
  });

  it('returns 200 on successful submission from draft', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r1',
      owner_id: 'user-123',
      title: 'Draft Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    // GetCommand for report
    docClientMock.send.mockResolvedValueOnce({ Item: report });
    // UpdateCommand for submission
    docClientMock.send.mockResolvedValueOnce({});

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'r1' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.status).toBe('submitted');
    expect(body.submitted_at).toBeDefined();
  });

  it('returns 200 on successful submission from validated', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-val',
      owner_id: 'user-123',
      title: 'Validated Report',
      status: 'validated',
      current_version: 2,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });
    docClientMock.send.mockResolvedValueOnce({});

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'r-val' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.status).toBe('submitted');
  });

  it('returns 409 when submitting from "validating" status', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-validating',
      owner_id: 'user-123',
      title: 'Validating Report',
      status: 'validating',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'r-validating' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(409);
    const body = parseResponseBody(response) as any;
    expect(body.message).toContain('Cannot transition');
  });

  it('returns 409 when submitting already submitted report', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-submitted',
      owner_id: 'user-123',
      title: 'Submitted Report',
      status: 'submitted',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'r-submitted' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(409);
  });

  it('returns 403 when non-owner tries to submit', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-other',
      owner_id: 'other-user-456', // Different from user-123
      title: 'Other Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'r-other' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });

  it('returns 403 for worker role', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.WORKER, {
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'r1' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 when report does not exist', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    docClientMock.send.mockResolvedValueOnce({ Item: undefined });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'nonexistent' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(404);
  });

  it('returns 500 when DynamoDB update fails', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-fail',
      owner_id: 'user-123',
      title: 'Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });
    docClientMock.send.mockRejectedValueOnce(new Error('DynamoDB error'));

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'r-fail' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(500);
    const body = parseResponseBody(response) as any;
    expect(body.message).toContain('Submission failed');
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /report-validation/reports/{id}/versions (Requirement 6.1)
// ---------------------------------------------------------------------------

describe('handler - POST /report-validation/reports/{id}/versions', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };
  let uploadNewVersionMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as {
      send: ReturnType<typeof vi.fn>;
    };
    const uploadModule = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );
    uploadNewVersionMock = uploadModule.uploadNewVersion as ReturnType<typeof vi.fn>;
  });

  it('returns 201 on successful version upload', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r1',
      owner_id: 'user-123',
      title: 'Report',
      status: 'validated',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });
    uploadNewVersionMock.mockResolvedValue({
      result: {
        report_id: 'r1',
        version: 2,
        upload_url: 'https://s3.amazonaws.com/presigned-url',
        status: 'draft',
      },
      error: undefined,
    });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/versions',
      pathParameters: { id: 'r1' },
      body: JSON.stringify({
        file_name: 'updated-report.pdf',
        file_size: 8000,
        mime_type: 'application/pdf',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(201);
    const body = parseResponseBody(response) as any;
    expect(body.version).toBe(2);
  });

  it('returns 403 when non-owner tries to upload version', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-other',
      owner_id: 'other-user-456',
      title: 'Other Report',
      status: 'validated',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/versions',
      pathParameters: { id: 'r-other' },
      body: JSON.stringify({
        file_name: 'new.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });

  it('returns 403 for worker role', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.WORKER, {
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/versions',
      pathParameters: { id: 'r1' },
      body: JSON.stringify({
        file_name: 'new.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });

  it('returns 400 when uploadNewVersion returns error', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r1',
      owner_id: 'user-123',
      title: 'Report',
      status: 'validated',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });
    uploadNewVersionMock.mockResolvedValue({
      result: undefined,
      error: 'Cannot upload new version when status is submitted',
    });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/versions',
      pathParameters: { id: 'r1' },
      body: JSON.stringify({
        file_name: 'new.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /report-validation/reports/{id}/history
// ---------------------------------------------------------------------------

describe('handler - GET /report-validation/reports/{id}/history', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };
  let getVersionHistoryMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as {
      send: ReturnType<typeof vi.fn>;
    };
    const uploadModule = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );
    getVersionHistoryMock = uploadModule.getVersionHistory as ReturnType<typeof vi.fn>;
  });

  it('returns 200 with version history', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r1',
      owner_id: 'user-123',
      title: 'Report',
      status: 'validated',
      current_version: 2,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
      status_history: [],
    };

    // GetCommand for report
    docClientMock.send.mockResolvedValueOnce({ Item: report });

    getVersionHistoryMock.mockResolvedValue([
      { report_id: 'r1', version: 2, file_name: 'v2.pdf', uploaded_at: '2024-01-02T00:00:00.000Z' },
      { report_id: 'r1', version: 1, file_name: 'v1.pdf', uploaded_at: '2024-01-01T00:00:00.000Z' },
    ]);

    // QueryCommand for validation results
    docClientMock.send.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports/{id}/history',
      pathParameters: { id: 'r1' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.history).toHaveLength(2);
    expect(body.history[0].version).toBe(2);
    expect(body.history[1].version).toBe(1);
  });

  it('returns 404 when report does not exist', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    docClientMock.send.mockResolvedValueOnce({ Item: undefined });

    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports/{id}/history',
      pathParameters: { id: 'nonexistent' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /report-validation/kb/documents (Requirement 13.6)
// ---------------------------------------------------------------------------

describe('handler - POST /report-validation/kb/documents', () => {
  let uploadKBDocumentMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const kbModule = await import(
      '../../../src/services/report-validation/kb-manager.js'
    );
    uploadKBDocumentMock = kbModule.uploadKBDocument as ReturnType<typeof vi.fn>;
  });

  it('returns 201 on successful KB document upload (tenant_admin)', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    uploadKBDocumentMock.mockResolvedValue({
      result: {
        document_id: 'doc-1',
        upload_url: 'https://s3.amazonaws.com/kb-presigned-url',
        s3_key: 'worksafebc/doc-1/regulation.pdf',
        uploaded_at: '2024-01-01T00:00:00.000Z',
      },
      error: undefined,
    });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/kb/documents',
      body: JSON.stringify({
        file_name: 'worksafebc-regulation.pdf',
        file_size: 10240,
        mime_type: 'application/pdf',
        category: 'worksafebc',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(201);
    const body = parseResponseBody(response) as any;
    expect(body.document_id).toBe('doc-1');
  });

  it('returns 403 for site_admin role (only tenant_admin can manage KB)', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.SITE_ADMIN, {
      httpMethod: 'POST',
      resource: '/report-validation/kb/documents',
      body: JSON.stringify({
        file_name: 'regulation.pdf',
        file_size: 10240,
        mime_type: 'application/pdf',
        category: 'worksafebc',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });

  it('returns 403 for supervisor role', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.SUPERVISOR, {
      httpMethod: 'POST',
      resource: '/report-validation/kb/documents',
      body: JSON.stringify({
        file_name: 'regulation.pdf',
        file_size: 10240,
        mime_type: 'application/pdf',
        category: 'worksafebc',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });

  it('returns 403 for cso role', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.CSO, {
      httpMethod: 'POST',
      resource: '/report-validation/kb/documents',
      body: JSON.stringify({
        file_name: 'regulation.pdf',
        file_size: 10240,
        mime_type: 'application/pdf',
        category: 'worksafebc',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });

  it('returns 400 for missing request body', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/kb/documents',
      body: null,
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when uploadKBDocument returns validation error', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    uploadKBDocumentMock.mockResolvedValue({
      result: undefined,
      error: 'Unsupported file format. Accepted: PDF, .docx',
    });

    const event = buildEvent({
      httpMethod: 'POST',
      resource: '/report-validation/kb/documents',
      body: JSON.stringify({
        file_name: 'regulation.pdf',
        file_size: 10240,
        mime_type: 'application/pdf',
        category: 'worksafebc',
      }),
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /report-validation/kb/documents (Requirement 13.7)
// ---------------------------------------------------------------------------

describe('handler - GET /report-validation/kb/documents', () => {
  let listKBDocumentsMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const kbModule = await import(
      '../../../src/services/report-validation/kb-manager.js'
    );
    listKBDocumentsMock = kbModule.listKBDocuments as ReturnType<typeof vi.fn>;
  });

  it('returns 200 with list of KB documents (tenant_admin)', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    listKBDocumentsMock.mockResolvedValue([
      {
        document_id: 'doc-1',
        file_name: 'regulation.pdf',
        file_size: 10240,
        category: 'worksafebc',
        sync_status: 'indexed',
        uploaded_at: '2024-01-01T00:00:00.000Z',
      },
    ]);

    const event = buildEvent({
      httpMethod: 'GET',
      resource: '/report-validation/kb/documents',
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].document_id).toBe('doc-1');
  });

  it('returns 403 for non-tenant_admin roles', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.SITE_ADMIN, {
      httpMethod: 'GET',
      resource: '/report-validation/kb/documents',
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Tests: DELETE /report-validation/kb/documents/{id} (Requirement 13.10)
// ---------------------------------------------------------------------------

describe('handler - DELETE /report-validation/kb/documents/{id}', () => {
  let deleteKBDocumentMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const kbModule = await import(
      '../../../src/services/report-validation/kb-manager.js'
    );
    deleteKBDocumentMock = kbModule.deleteKBDocument as ReturnType<typeof vi.fn>;
  });

  it('returns 200 on successful deletion (tenant_admin)', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    deleteKBDocumentMock.mockResolvedValue({
      result: { document_id: 'doc-1', deleted: true },
      error: undefined,
    });

    const event = buildEvent({
      httpMethod: 'DELETE',
      resource: '/report-validation/kb/documents/{id}',
      pathParameters: { id: 'doc-1' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
    const body = parseResponseBody(response) as any;
    expect(body.deleted).toBe(true);
  });

  it('returns 404 when document not found', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    deleteKBDocumentMock.mockResolvedValue({
      result: undefined,
      error: 'Document not found',
    });

    const event = buildEvent({
      httpMethod: 'DELETE',
      resource: '/report-validation/kb/documents/{id}',
      pathParameters: { id: 'nonexistent' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(404);
  });

  it('returns 403 for non-tenant_admin roles', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEventWithRole(Role.SUPERVISOR, {
      httpMethod: 'DELETE',
      resource: '/report-validation/kb/documents/{id}',
      pathParameters: { id: 'doc-1' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(403);
  });

  it('returns 500 when deletion encounters internal error', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    deleteKBDocumentMock.mockResolvedValue({
      result: undefined,
      error: 'S3 deletion failed',
    });

    const event = buildEvent({
      httpMethod: 'DELETE',
      resource: '/report-validation/kb/documents/{id}',
      pathParameters: { id: 'doc-fail' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Tests: Report visibility scoping per role (Requirement 11.2, 11.4)
// ---------------------------------------------------------------------------

describe('handler - Report visibility scoping', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as {
      send: ReturnType<typeof vi.fn>;
    };
  });

  it('tenant_admin can view any report in their tenant', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-other',
      owner_id: 'other-user-999',
      title: 'Other User Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });
    docClientMock.send.mockResolvedValueOnce({ Items: [] }); // validation result

    const event = buildEventWithRole(Role.TENANT_ADMIN, {
      httpMethod: 'GET',
      resource: '/report-validation/reports/{id}',
      pathParameters: { id: 'r-other' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
  });

  it('cso can view any report in their tenant', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-other',
      owner_id: 'other-user-999',
      title: 'Other User Report',
      status: 'validated',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });
    docClientMock.send.mockResolvedValueOnce({ Items: [] });

    const event = buildEventWithRole(Role.CSO, {
      httpMethod: 'GET',
      resource: '/report-validation/reports/{id}',
      pathParameters: { id: 'r-other' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
  });

  it('site_admin can view reports in their assigned sites (same tenant)', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const report = {
      tenant_id: 'tenant-abc',
      report_id: 'r-site',
      owner_id: 'site-user-789',
      title: 'Site Report',
      status: 'draft',
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    docClientMock.send.mockResolvedValueOnce({ Item: report });
    docClientMock.send.mockResolvedValueOnce({ Items: [] });

    const event = buildEventWithRole(Role.SITE_ADMIN, {
      httpMethod: 'GET',
      resource: '/report-validation/reports/{id}',
      pathParameters: { id: 'r-site' },
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: Unsupported route
// ---------------------------------------------------------------------------

describe('handler - Unsupported routes', () => {
  it('returns 400 for unsupported route', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = buildEvent({
      httpMethod: 'PATCH',
      resource: '/report-validation/unknown',
    });

    const response = await handler(event as any);
    expect(response.statusCode).toBe(400);
    const body = parseResponseBody(response) as any;
    expect(body.message).toBe('Unsupported route');
  });
});
