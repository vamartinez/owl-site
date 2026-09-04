/**
 * Unit tests for incident attachment endpoints:
 * - POST /incidents/{id}/attachments (initiate upload with presigned URL)
 * - PATCH /incidents/{id}/attachments/{attachId}/confirm (confirm upload)
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
const mockPublishToSns = vi.fn();
const mockGetSignedUrl = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn(),
    GetCommand: vi.fn(),
    QueryCommand: vi.fn(),
    DeleteCommand: vi.fn(),
    UpdateCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
  vi.doMock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn(() => ({})),
    PutObjectCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: mockGetSignedUrl,
  }));
  vi.doMock('@aws-sdk/client-sns', () => ({
    SNSClient: vi.fn(() => ({})),
    PublishCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(() => ({})),
    SendMessageCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/client-scheduler', () => ({
    SchedulerClient: vi.fn(() => ({})),
    CreateScheduleCommand: vi.fn(),
  }));
  vi.doMock('../../src/shared/event-publisher.js', () => ({
    publishToSns: mockPublishToSns,
    buildPlatformEvent: vi.fn((params: Record<string, unknown>) => ({
      event_id: 'evt-1',
      ...params,
    })),
    publishEvent: mockPublishToSns,
  }));
};

// Set env vars before imports
process.env['INCIDENT_EVIDENCE_BUCKET'] = 'test-evidence-bucket';
process.env['TABLE_PREFIX'] = 'test_';

const tenantAdminClaims = {
  sub: 'user-1',
  email: 'admin@test.com',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'tenant_admin',
};

const workerClaims = {
  sub: 'user-4',
  email: 'worker@test.com',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'worker',
};

function makeIncidentRecord(overrides: Record<string, unknown> = {}) {
  return {
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    title: 'Test Incident',
    description: 'A test incident',
    incident_type: 'injury',
    incident_datetime: '2024-01-01T10:00:00Z',
    report_datetime: '2024-01-01T10:05:00Z',
    location: 'Building A',
    persons_involved_count: 1,
    reporting_user_id: 'user-1',
    reporting_user_name: 'admin@test.com',
    severity: 'medium',
    regulatory_flag: 'internal_only',
    status: 'open',
    external_report_status: 'not_reportable',
    regulatory_indicators: {
      medical_treatment_beyond_first_aid: false,
      lost_time: false,
      hospitalization: false,
      fatality: false,
      amputation: false,
      loss_of_eye: false,
      structural_collapse: false,
      hazardous_substance_release: false,
      fire_or_explosion: false,
    },
    jurisdiction: 'british_columbia',
    created_at: '2024-01-01T10:05:00Z',
    updated_at: '2024-01-01T10:05:00Z',
    ...overrides,
  };
}

describe('incidents: POST /incidents/{id}/attachments', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockPublishToSns.mockReset();
    mockGetSignedUrl.mockReset();
    mockPublishToSns.mockResolvedValue({ event_id: 'evt-1' });
    mockGetSignedUrl.mockResolvedValue('https://s3.amazonaws.com/test-evidence-bucket/presigned-url');
    mockAwsSdk();
  });

  it('returns 201 with attachment_id, upload_url, and s3_key for valid request (Req 12.1, 12.4)', async () => {
    const incident = makeIncidentRecord();
    // GetCommand: return existing incident
    mockSend.mockResolvedValueOnce({ Item: incident });
    // PutCommand: store attachment metadata
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/incidents/{id}/attachments',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({
        file_name: 'photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 1024 * 1024, // 1 MB
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.attachment_id).toBeDefined();
    expect(body.upload_url).toBe('https://s3.amazonaws.com/test-evidence-bucket/presigned-url');
    expect(body.s3_key).toContain('tenant-1/inc-1/');
    expect(body.s3_key).toContain('photo.jpg');
  });

  it('rejects invalid MIME type with 400 (Req 12.1, 12.5)', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/incidents/{id}/attachments',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({
        file_name: 'malware.exe',
        mime_type: 'application/x-msdownload',
        size_bytes: 1024,
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.details.errors.mime_type).toBeDefined();
  });

  it('rejects file exceeding 50 MB with 400 (Req 12.2, 12.5)', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/incidents/{id}/attachments',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({
        file_name: 'large-file.pdf',
        mime_type: 'application/pdf',
        size_bytes: 51 * 1024 * 1024, // 51 MB
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.details.errors.size_bytes).toBeDefined();
  });

  it('rejects video exceeding 60 seconds with 400 (Req 12.3, 12.5)', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/incidents/{id}/attachments',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({
        file_name: 'long-video.mp4',
        mime_type: 'video/mp4',
        size_bytes: 10 * 1024 * 1024,
        duration_seconds: 90,
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.details.errors.duration_seconds).toBeDefined();
  });

  it('returns 404 when incident does not exist', async () => {
    // GetCommand: incident not found
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/incidents/{id}/attachments',
      pathParameters: { id: 'nonexistent' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({
        file_name: 'photo.png',
        mime_type: 'image/png',
        size_bytes: 2048,
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(404);
  });

  it('returns 403 for worker role', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/incidents/{id}/attachments',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: JSON.stringify({
        file_name: 'photo.png',
        mime_type: 'image/png',
        size_bytes: 2048,
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  it('returns 500 when S3 presigned URL generation fails', async () => {
    const incident = makeIncidentRecord();
    // GetCommand: return existing incident
    mockSend.mockResolvedValueOnce({ Item: incident });
    // getSignedUrl fails
    mockGetSignedUrl.mockRejectedValueOnce(new Error('S3 service unavailable'));

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/incidents/{id}/attachments',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({
        file_name: 'photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 1024,
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.message).toBe('Failed to generate upload URL');
  });

  it('accepts valid video within duration limit (Req 12.3)', async () => {
    const incident = makeIncidentRecord();
    // GetCommand: return existing incident
    mockSend.mockResolvedValueOnce({ Item: incident });
    // PutCommand: store attachment metadata
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/incidents/{id}/attachments',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({
        file_name: 'short-video.mp4',
        mime_type: 'video/mp4',
        size_bytes: 5 * 1024 * 1024,
        duration_seconds: 30,
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.attachment_id).toBeDefined();
    expect(body.upload_url).toBeDefined();
  });
});

describe('incidents: PATCH /incidents/{id}/attachments/{attachId}/confirm', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockPublishToSns.mockReset();
    mockGetSignedUrl.mockReset();
    mockPublishToSns.mockResolvedValue({ event_id: 'evt-1' });
    mockGetSignedUrl.mockResolvedValue('https://s3.amazonaws.com/test-evidence-bucket/presigned-url');
    mockAwsSdk();
  });

  it('confirms attachment and records audit trail (Req 12.4)', async () => {
    const attachmentRecord = {
      attachment_id: 'attach-1',
      incident_id: 'inc-1',
      tenant_id: 'tenant-1',
      file_name: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1024,
      s3_key: 'tenant-1/inc-1/attach-1/photo.jpg',
      uploaded_by: 'user-1',
      confirmed: false,
      created_at: '2024-01-01T10:10:00Z',
    };

    // GetCommand: return existing attachment
    mockSend.mockResolvedValueOnce({ Item: attachmentRecord });
    // UpdateCommand: mark as confirmed
    mockSend.mockResolvedValueOnce({});
    // PutCommand: timeline event
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/attachments/{attachId}/confirm',
      pathParameters: { id: 'inc-1', attachId: 'attach-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.confirmed).toBe(true);
  });

  it('returns 404 when attachment does not exist', async () => {
    // GetCommand: attachment not found
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/attachments/{attachId}/confirm',
      pathParameters: { id: 'inc-1', attachId: 'nonexistent' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(404);
  });

  it('returns 403 for worker role', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/attachments/{attachId}/confirm',
      pathParameters: { id: 'inc-1', attachId: 'attach-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });
});
