/**
 * Integration tests for Report Validation upload and validation flows.
 * Tests the full flow through the handler with mocked AWS services (S3, DynamoDB, Bedrock).
 *
 * Requirements: 1.3, 1.6, 3.2, 3.8, 6.2, 6.3, 7.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock AWS SDK modules
// ---------------------------------------------------------------------------

const mockBedrockSend = vi.fn();
const mockChat = vi.fn();
const mockS3Send = vi.fn();
const mockDocClientSend = vi.fn();

vi.mock('../../../src/shared/ollama-client.js', () => ({
  getOllamaClient: vi.fn(async () => ({ chat: mockChat })),
}));
vi.mock('../../../src/services/report-validation/retrieval.js', () => ({
  retrieveTopK: vi.fn(async () => []),
  buildRetrievalSystemPrompt: vi.fn(() => 'system-context'),
}));

vi.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: vi.fn().mockImplementation(() => ({
    send: mockBedrockSend,
  })),
  RetrieveAndGenerateCommand: vi.fn().mockImplementation((input) => input),
}));

vi.mock('@aws-sdk/client-bedrock-data-automation-runtime', () => ({
  BedrockDataAutomationRuntimeClient: vi.fn().mockImplementation(() => ({
    send: mockBedrockSend,
  })),
  InvokeDataAutomationAsyncCommand: vi.fn().mockImplementation((input) => input),
  GetDataAutomationStatusCommand: vi.fn().mockImplementation((input) => input),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: vi.fn().mockImplementation((input) => input),
  GetObjectCommand: vi.fn().mockImplementation((input) => input),
  HeadObjectCommand: vi.fn().mockImplementation((input) => input),
  DeleteObjectCommand: vi.fn().mockImplementation((input) => input),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/mock-presigned-url'),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Put' })),
  GetCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Get' })),
  QueryCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Query' })),
  UpdateCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Update' })),
  DeleteCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Delete' })),
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

// Mock jsonwebtoken for auth
vi.mock('jsonwebtoken', () => ({
  decode: vi.fn().mockReturnValue({
    sub: 'user-owner-1',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'site_admin',
    email: 'owner@example.com',
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApiEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    headers: {
      Authorization: 'Bearer mock-jwt-token',
      'Content-Type': 'application/json',
    },
    requestContext: { requestId: 'req-123' },
    httpMethod: 'POST',
    resource: '/report-validation/reports',
    pathParameters: null,
    queryStringParameters: null,
    body: null,
    ...overrides,
  };
}

function parseResponse(response: { statusCode: number; body: string }) {
  return { statusCode: response.statusCode, data: JSON.parse(response.body) };
}

const VALID_REPORT_BODY = {
  file_name: 'compliance-report.pdf',
  file_size: 10240,
  mime_type: 'application/pdf',
};

const MOCK_REPORT_RECORD = {
  tenant_id: 'tenant-1',
  report_id: 'report-001',
  owner_id: 'user-owner-1',
  title: 'compliance-report.pdf',
  status: 'draft' as const,
  current_version: 1,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  status_history: [],
};

const MOCK_VERSION_RECORD = {
  report_id: 'report-001',
  version: 1,
  file_name: 'compliance-report.pdf',
  file_size: 10240,
  mime_type: 'application/pdf',
  s3_key: 'tenant-1/report-001/v1/compliance-report.pdf',
  extraction_status: 'pending',
  uploaded_by: 'user-owner-1',
  uploaded_at: '2024-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Test: Full Upload Flow
// POST metadata → presigned URL → PUT to S3 → verify DynamoDB record
// Requirement 1.3, 1.6
// ---------------------------------------------------------------------------

describe('Full Upload Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates report record and returns presigned URL on valid upload', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    // Mock DynamoDB: PutCommand for report record, PutCommand for version record
    mockDocClientSend
      .mockResolvedValueOnce({}) // report record
      .mockResolvedValueOnce({}); // version record

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify(VALID_REPORT_BODY),
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(201);
    expect(data.report_id).toBeDefined();
    expect(data.upload_url).toBe('https://s3.amazonaws.com/mock-presigned-url');
    expect(data.status).toBe('draft');
    expect(data.created_at).toBeDefined();
    // Verify ISO 8601 format
    expect(new Date(data.created_at).toISOString()).toBe(data.created_at);
  });

  it('does not persist partial data when S3 presigned URL generation fails', async () => {
    const presignerModule = await import('@aws-sdk/s3-request-presigner');
    const getSignedUrlMock = presignerModule.getSignedUrl as ReturnType<typeof vi.fn>;
    getSignedUrlMock.mockRejectedValueOnce(new Error('S3 unavailable'));

    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify(VALID_REPORT_BODY),
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(500);
    expect(data.message).toContain('Upload could not be completed');
    // DynamoDB should not have been called (presigned URL is generated first)
    expect(mockDocClientSend).not.toHaveBeenCalled();

    // Restore mock
    getSignedUrlMock.mockResolvedValue('https://s3.amazonaws.com/mock-presigned-url');
  });

  it('rejects upload with invalid MIME type and does not create record', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify({
        file_name: 'report.txt',
        file_size: 5000,
        mime_type: 'text/plain',
      }),
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(400);
    expect(data.message).toContain('Validation failed');
    expect(mockDocClientSend).not.toHaveBeenCalled();
  });

  it('rejects upload with file too small', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify({
        file_name: 'tiny.pdf',
        file_size: 512, // less than 1 KB
        mime_type: 'application/pdf',
      }),
    });

    const response = await handler(event as any);
    const { statusCode } = parseResponse(response);

    expect(statusCode).toBe(400);
    expect(mockDocClientSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test: Full Validation Flow
// request → BDA extraction → RAG query → result stored → status updated
// Requirement 3.2
// ---------------------------------------------------------------------------

describe('Full Validation Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initiates validation, transitions to validating, and returns 200', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    // Mock: GetCommand returns draft report
    mockDocClientSend
      .mockResolvedValueOnce({ Item: { ...MOCK_REPORT_RECORD } }) // GetCommand - report
      .mockResolvedValueOnce({}) // UpdateCommand - status to validating
      .mockResolvedValueOnce({ Items: [MOCK_VERSION_RECORD] }) // QueryCommand - version record
      // Async pipeline calls (may or may not complete before response):
      .mockResolvedValue({}); // Remaining DynamoDB calls

    // Mock BDA extraction (for async pipeline)
    mockBedrockSend.mockResolvedValue({
      output: {
        text: JSON.stringify({
          findings: [],
          summary: 'No issues found.',
        }),
      },
    });

    // Mock Ollama generation (RAG) for the async pipeline
    mockChat.mockResolvedValue({
      message: { content: JSON.stringify({ findings: [], summary: 'No issues found.' }) },
    });

    // Mock S3 GetObject for text extraction
    mockS3Send.mockResolvedValue({
      Body: { transformToString: () => Promise.resolve('Extracted text content for validation') },
    });

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/validate',
      pathParameters: { id: 'report-001' },
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(200);
    expect(data.report_id).toBe('report-001');
    expect(data.status).toBe('validating');
    expect(data.message).toBe('Validation initiated');
  });

  it('rejects validation request on non-draft report with 409', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    // Report is in "validated" status
    mockDocClientSend.mockResolvedValueOnce({
      Item: { ...MOCK_REPORT_RECORD, status: 'validated' },
    });

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/validate',
      pathParameters: { id: 'report-001' },
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(409);
    expect(data.message).toContain('Cannot transition from "validated" to "validating"');
  });

  it('rejects validation request on submitted report with 409', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    mockDocClientSend.mockResolvedValueOnce({
      Item: { ...MOCK_REPORT_RECORD, status: 'submitted' },
    });

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/validate',
      pathParameters: { id: 'report-001' },
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(409);
    expect(data.message).toContain('Cannot transition from "submitted" to "validating"');
  });

  it('returns 404 when report does not exist', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/validate',
      pathParameters: { id: 'nonexistent-report' },
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(404);
    expect(data.message).toBe('Report not found');
  });
});

// ---------------------------------------------------------------------------
// Test: Version Cycle
// upload v1 → validate → upload v2 → validate → verify both preserved
// Requirements: 6.2, 6.3
// ---------------------------------------------------------------------------

describe('Version Cycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads v1, then uploads v2 which increments version and preserves v1', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    // Step 1: Upload v1 (create report)
    mockDocClientSend
      .mockResolvedValueOnce({}) // PutCommand - report record
      .mockResolvedValueOnce({}); // PutCommand - version record

    const createEvent = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports',
      body: JSON.stringify(VALID_REPORT_BODY),
    });

    const createResponse = await handler(createEvent as any);
    const { statusCode: createStatus, data: createData } = parseResponse(createResponse);
    expect(createStatus).toBe(201);
    expect(createData.status).toBe('draft');

    vi.clearAllMocks();

    // Step 2: Upload v2 (new version on validated report)
    const validatedReport = {
      ...MOCK_REPORT_RECORD,
      report_id: createData.report_id || 'report-001',
      status: 'validated' as const,
      current_version: 1,
    };

    // Mock: GetCommand returns validated report, then version query, then writes
    mockDocClientSend
      .mockResolvedValueOnce({ Item: validatedReport }) // GetCommand - report
      .mockResolvedValueOnce({ Items: [{ version: 1, report_id: validatedReport.report_id }] }) // QueryCommand - getCurrentVersionNumber
      .mockResolvedValueOnce({}) // PutCommand - new version record
      .mockResolvedValueOnce({}); // UpdateCommand - report record (status → draft, version → 2)

    const versionEvent = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/versions',
      pathParameters: { id: validatedReport.report_id },
      body: JSON.stringify({
        file_name: 'compliance-report-v2.pdf',
        file_size: 15360,
        mime_type: 'application/pdf',
      }),
    });

    const versionResponse = await handler(versionEvent as any);
    const { statusCode: versionStatus, data: versionData } = parseResponse(versionResponse);

    expect(versionStatus).toBe(201);
    expect(versionData.version).toBe(2);
    expect(versionData.status).toBe('draft');
    expect(versionData.upload_url).toBeDefined();
  });

  it('version history returns all versions in reverse chronological order', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const reportWithVersions = {
      ...MOCK_REPORT_RECORD,
      current_version: 2,
      status: 'draft' as const,
    };

    const versions = [
      { ...MOCK_VERSION_RECORD, version: 2, file_name: 'v2.pdf', uploaded_at: '2024-02-01T00:00:00.000Z' },
      { ...MOCK_VERSION_RECORD, version: 1, file_name: 'v1.pdf', uploaded_at: '2024-01-01T00:00:00.000Z' },
    ];

    const validationResults = [
      {
        report_id: 'report-001',
        version: 1,
        validation_id: 'val-1',
        status: 'completed',
        score: 85,
        summary: 'Some issues found.',
        findings: [],
        requested_at: '2024-01-02T00:00:00.000Z',
        completed_at: '2024-01-02T00:01:00.000Z',
        requested_by: 'user-owner-1',
      },
    ];

    mockDocClientSend
      .mockResolvedValueOnce({ Item: reportWithVersions }) // GetCommand - report
      .mockResolvedValueOnce({ Items: versions }) // QueryCommand - version history
      .mockResolvedValueOnce({ Items: validationResults }); // QueryCommand - validation results

    const event = createApiEvent({
      httpMethod: 'GET',
      resource: '/report-validation/reports/{id}/history',
      pathParameters: { id: 'report-001' },
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(200);
    expect(data.history).toHaveLength(2);
    // Most recent version first
    expect(data.history[0].version).toBe(2);
    expect(data.history[0].validation_result).toBeNull();
    expect(data.history[1].version).toBe(1);
    expect(data.history[1].validation_result).not.toBeNull();
    expect(data.history[1].validation_result.score).toBe(85);
  });

  it('rejects new version upload on submitted report', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    mockDocClientSend.mockResolvedValueOnce({
      Item: { ...MOCK_REPORT_RECORD, status: 'submitted' },
    });

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/versions',
      pathParameters: { id: 'report-001' },
      body: JSON.stringify(VALID_REPORT_BODY),
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(400);
    expect(data.message).toContain('Cannot upload new version');
  });
});

// ---------------------------------------------------------------------------
// Test: Submission Flow
// validate → submit → verify terminal state
// Requirement 7.2
// ---------------------------------------------------------------------------

describe('Submission Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits a validated report and transitions to submitted', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    mockDocClientSend
      .mockResolvedValueOnce({
        Item: { ...MOCK_REPORT_RECORD, status: 'validated' },
      }) // GetCommand - report
      .mockResolvedValueOnce({}); // UpdateCommand - status to submitted

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'report-001' },
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(200);
    expect(data.report_id).toBe('report-001');
    expect(data.status).toBe('submitted');
    expect(data.submitted_at).toBeDefined();
    expect(data.submitted_by).toBe('user-owner-1');
    // Verify ISO 8601 format
    expect(new Date(data.submitted_at).toISOString()).toBe(data.submitted_at);
  });

  it('submits a draft report directly (without validation)', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    mockDocClientSend
      .mockResolvedValueOnce({
        Item: { ...MOCK_REPORT_RECORD, status: 'draft' },
      }) // GetCommand - report
      .mockResolvedValueOnce({}); // UpdateCommand - status to submitted

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'report-001' },
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(200);
    expect(data.status).toBe('submitted');
  });

  it('prevents further actions after submission (terminal state)', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    const submittedReport = { ...MOCK_REPORT_RECORD, status: 'submitted' as const };

    // Try to validate a submitted report
    mockDocClientSend.mockResolvedValueOnce({ Item: submittedReport });

    const validateEvent = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/validate',
      pathParameters: { id: 'report-001' },
    });

    const validateResponse = await handler(validateEvent as any);
    expect(parseResponse(validateResponse).statusCode).toBe(409);

    vi.clearAllMocks();

    // Try to submit again
    mockDocClientSend.mockResolvedValueOnce({ Item: submittedReport });

    const submitEvent = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'report-001' },
    });

    const submitResponse = await handler(submitEvent as any);
    expect(parseResponse(submitResponse).statusCode).toBe(409);

    vi.clearAllMocks();

    // Try to upload new version
    mockDocClientSend.mockResolvedValueOnce({ Item: submittedReport });

    const versionEvent = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/versions',
      pathParameters: { id: 'report-001' },
      body: JSON.stringify(VALID_REPORT_BODY),
    });

    const versionResponse = await handler(versionEvent as any);
    expect(parseResponse(versionResponse).statusCode).toBe(400);
  });

  it('rejects submission by non-owner', async () => {
    const { handler } = await import(
      '../../../src/services/report-validation/handler.js'
    );

    // Report owned by a different user
    mockDocClientSend.mockResolvedValueOnce({
      Item: { ...MOCK_REPORT_RECORD, owner_id: 'different-user' },
    });

    const event = createApiEvent({
      httpMethod: 'POST',
      resource: '/report-validation/reports/{id}/submit',
      pathParameters: { id: 'report-001' },
    });

    const response = await handler(event as any);
    const { statusCode, data } = parseResponse(response);

    expect(statusCode).toBe(403);
    expect(data.message).toContain('Insufficient permissions');
  });
});

// ---------------------------------------------------------------------------
// Test: Timeout Handling
// simulate slow validation → verify 5-min timeout → status reverts
// Requirement 3.8
// ---------------------------------------------------------------------------

describe('Timeout Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reverts status to draft when validation times out after 5 minutes', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    // Ollama never resolves (simulates timeout)
    mockChat.mockImplementation(() => new Promise(() => {})); // never resolves

    // Mock DynamoDB: processing record, then timed_out record, then status revert
    mockDocClientSend
      .mockResolvedValueOnce({}) // PutCommand - processing record
      .mockResolvedValueOnce({}) // PutCommand - timed_out record
      .mockResolvedValueOnce({}); // UpdateCommand - status revert to draft

    const input = {
      report_id: 'report-timeout-test',
      version: 1,
      extracted_text: 'Report text that will time out during validation processing.',
      tenant_id: 'tenant-1',
    };

    const validationPromise = runValidation(input, 'user-owner-1').catch((err) => {
      return { __error: err };
    });

    // Advance time past the 5-minute timeout
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

    const result = await validationPromise;
    expect((result as { __error: Error }).__error.message).toBe(
      'Validation timed out after 5 minutes'
    );

    // Verify DynamoDB was called 3 times:
    // 1. Store processing record
    // 2. Store timed_out record
    // 3. Revert status to draft
    expect(mockDocClientSend).toHaveBeenCalledTimes(3);
  });

  it('reverts status to draft when RAG pipeline fails', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    // Ollama throws an error
    mockChat.mockRejectedValueOnce(new Error('Ollama service unavailable'));

    mockDocClientSend
      .mockResolvedValueOnce({}) // processing record
      .mockResolvedValueOnce({}) // failed record
      .mockResolvedValueOnce({}); // status revert to draft

    const input = {
      report_id: 'report-rag-failure',
      version: 1,
      extracted_text: 'Report text that will fail during RAG.',
      tenant_id: 'tenant-1',
    };

    await expect(runValidation(input, 'user-owner-1')).rejects.toThrow(
      'Ollama service unavailable'
    );

    // Verify status was reverted (3 DynamoDB calls)
    expect(mockDocClientSend).toHaveBeenCalledTimes(3);
  });

  it('completes validation successfully within timeout', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    const ragResponse = JSON.stringify({
      findings: [
        {
          severity: 'critical',
          description: 'Missing fall protection plan for elevated work areas',
          report_section: 'Section 3.2',
          suggested_correction: 'Add fall protection plan per WorkSafeBC Part 11',
          regulation_references: [
            { title: 'WorkSafeBC OHS Regulation', section: '11.2(1)(a)' },
          ],
        },
      ],
      summary: 'Critical safety gap identified in fall protection documentation.',
    });

    mockChat.mockResolvedValue({ message: { content: ragResponse } });

    mockDocClientSend
      .mockResolvedValueOnce({}) // processing record
      .mockResolvedValueOnce({}) // completed record
      .mockResolvedValueOnce({}); // status update to validated

    const input = {
      report_id: 'report-success-test',
      version: 1,
      extracted_text: 'Construction report with safety information about elevated work.',
      tenant_id: 'tenant-1',
    };

    const result = await runValidation(input, 'user-owner-1');

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('critical');
    expect(result.score).toBe(85); // 100 - 15 (critical)
    expect(result.completed_at).toBeDefined();
  });
});
