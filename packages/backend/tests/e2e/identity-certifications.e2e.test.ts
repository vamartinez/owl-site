/**
 * E2E tests for worker certifications CRUD endpoints.
 * Tests the full handler path: routing → auth → validation → business logic → response.
 *
 * Endpoints tested:
 * - POST /workers/{id}/certifications → 201
 * - GET /workers/{id}/certifications → 200 array
 * - PATCH /workers/{id}/certifications/{certId} → 200
 * - GET /workers/{id}/certifications/{certId}/document-url → 200 with presigned URL
 *
 * Validates: Requirements 2.6, 2.7, 2.8, 2.9
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockEvent } from '../helpers/mock-event.js';
import { createMockClaims } from '../helpers/mock-user.js';
import { setupDynamoMock, getDynamoCalls, resetDynamoMock, getMockSend } from '../helpers/mock-dynamo.js';

// Mock DynamoDB client
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock event publisher (SNS)
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({
    event_id: 'evt-mock',
    event_type: 'CERTIFICATION_UPLOADED',
    source_service: 'identity-service',
    tenant_id: 'tenant-test',
    timestamp: '2024-01-01T00:00:00.000Z',
    payload: {},
    correlation_id: 'corr-mock',
    version: '1.0',
  }),
}));

// Mock S3 and presigner
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn().mockImplementation((input: unknown) => input),
  GetObjectCommand: vi.fn().mockImplementation((input: unknown) => input),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/test-bucket/presigned-url'),
}));

// Import handler after mocks are in place
import { handler } from '../../src/services/identity/handler.js';

// --- Test Data ---

const TENANT_ID = 'tenant-test';
const WORKER_ID = 'worker-abc-123';
const CERT_ID = 'cert-xyz-789';

const mockWorkerItem = {
  PK: `TENANT#${TENANT_ID}`,
  SK: `WORKER#${WORKER_ID}`,
  worker_id: WORKER_ID,
  tenant_id: TENANT_ID,
  legal_name: 'Jane Doe',
  phone: '+14155551234',
  language_preference: 'en',
  status: 'active',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

const mockCertificationItem = {
  PK: `TENANT#${TENANT_ID}#WORKER#${WORKER_ID}`,
  SK: `CERT#${CERT_ID}`,
  certification_id: CERT_ID,
  worker_id: WORKER_ID,
  tenant_id: TENANT_ID,
  certification_type: 'whmis_2015',
  issuer: 'BC Safety Authority',
  issue_date: '2024-01-15',
  expiry_date: '2026-01-15',
  document_key: `certifications/${TENANT_ID}/${WORKER_ID}/${CERT_ID}/cert.pdf`,
  validation_status: 'pending',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

// --- Helper to build DynamoDB key-based response maps ---

function workerGetKey(): string {
  return JSON.stringify({
    PK: `TENANT#${TENANT_ID}`,
    SK: `WORKER#${WORKER_ID}`,
  });
}

function certGetKey(): string {
  return JSON.stringify({
    PK: `TENANT#${TENANT_ID}#WORKER#${WORKER_ID}`,
    SK: `CERT#${CERT_ID}`,
  });
}

function certQueryKey(): string {
  return JSON.stringify({
    TableName: 'test-Certifications',
    IndexName: undefined,
    ExpressionAttributeValues: {
      ':pk': `TENANT#${TENANT_ID}#WORKER#${WORKER_ID}`,
      ':prefix': 'CERT#',
    },
  });
}

// ─── POST /workers/{id}/certifications ───────────────────────────────────────

describe('POST /workers/{id}/certifications - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
    const getResponses = new Map<string, Record<string, unknown>>();
    getResponses.set(workerGetKey(), mockWorkerItem);

    setupDynamoMock({
      getResponses,
      putCapture: [],
    });
  });

  it('returns 201 with created certification record (Requirement 2.6)', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers/{id}/certifications',
      path: `/workers/${WORKER_ID}/certifications`,
      pathParameters: { id: WORKER_ID },
      body: {
        certification_type: 'whmis_2015',
        issuer: 'BC Safety Authority',
        issue_date: '2024-01-15',
        expiry_date: '2026-01-15',
        document_content_type: 'application/pdf',
        document_size: 1024 * 1024,
        document_filename: 'cert.pdf',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('certification');
    expect(body).toHaveProperty('upload_url');

    // Verify certification fields
    const cert = body.certification;
    expect(cert).toHaveProperty('certification_id');
    expect(cert.certification_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(cert.worker_id).toBe(WORKER_ID);
    expect(cert.tenant_id).toBe(TENANT_ID);
    expect(cert.certification_type).toBe('whmis_2015');
    expect(cert.issuer).toBe('BC Safety Authority');
    expect(cert.issue_date).toBe('2024-01-15');
    expect(cert.expiry_date).toBe('2026-01-15');
    expect(cert.validation_status).toBe('pending');
    expect(cert).toHaveProperty('created_at');
    expect(cert).toHaveProperty('updated_at');

    // Verify upload_url is a presigned S3 URL
    expect(typeof body.upload_url).toBe('string');
    expect(body.upload_url).toContain('https://');

    // Verify DynamoDB PutCommand was called for the certification
    const calls = getDynamoCalls();
    const putCalls = calls.filter((c) => c.command === 'PutCommand');
    // Should have at least one PutCommand for the certification record
    const certPut = putCalls.find((c) => {
      const input = c.input as Record<string, unknown>;
      return input['TableName'] === 'test-Certifications';
    });
    expect(certPut).toBeDefined();
  });

  it('returns 201 without upload_url when no document info provided', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers/{id}/certifications',
      path: `/workers/${WORKER_ID}/certifications`,
      pathParameters: { id: WORKER_ID },
      body: {
        certification_type: 'fall_protection',
        issuer: 'Safety Training Inc.',
        issue_date: '2024-03-01',
        expiry_date: '2025-03-01',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('certification');
    expect(body.certification.certification_type).toBe('fall_protection');
    // upload_url is undefined when no document info provided
    expect(body.upload_url).toBeUndefined();
  });

  it('returns 400 for invalid certification_type', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers/{id}/certifications',
      path: `/workers/${WORKER_ID}/certifications`,
      pathParameters: { id: WORKER_ID },
      body: {
        certification_type: 'invalid_type',
        issuer: 'Safety Corp',
        issue_date: '2024-01-01',
        expiry_date: '2025-01-01',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when expiry_date is before issue_date', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers/{id}/certifications',
      path: `/workers/${WORKER_ID}/certifications`,
      pathParameters: { id: WORKER_ID },
      body: {
        certification_type: 'whmis_2015',
        issuer: 'Safety Corp',
        issue_date: '2025-06-01',
        expiry_date: '2024-01-01',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 404 when worker does not exist', async () => {
    resetDynamoMock();
    // No getResponses → getWorker returns null
    setupDynamoMock({ putCapture: [] });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'POST',
      resource: '/workers/{id}/certifications',
      path: '/workers/non-existent-worker/certifications',
      pathParameters: { id: 'non-existent-worker' },
      body: {
        certification_type: 'whmis_2015',
        issuer: 'Safety Corp',
        issue_date: '2024-01-01',
        expiry_date: '2025-01-01',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ─── GET /workers/{id}/certifications ────────────────────────────────────────

describe('GET /workers/{id}/certifications - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
    const getResponses = new Map<string, Record<string, unknown>>();
    getResponses.set(workerGetKey(), mockWorkerItem);

    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(certQueryKey(), [mockCertificationItem]);

    setupDynamoMock({
      getResponses,
      queryResponses,
    });
  });

  it('returns 200 with array of certification records (Requirement 2.7)', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/certifications',
      path: `/workers/${WORKER_ID}/certifications`,
      pathParameters: { id: WORKER_ID },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('certifications');
    expect(Array.isArray(body.certifications)).toBe(true);
    expect(body.certifications.length).toBeGreaterThan(0);

    // Verify certification shape
    const cert = body.certifications[0];
    expect(cert).toHaveProperty('certification_id');
    expect(cert).toHaveProperty('worker_id');
    expect(cert).toHaveProperty('tenant_id');
    expect(cert).toHaveProperty('certification_type');
    expect(cert).toHaveProperty('issuer');
    expect(cert).toHaveProperty('issue_date');
    expect(cert).toHaveProperty('expiry_date');
    expect(cert).toHaveProperty('validation_status');
    expect(cert).toHaveProperty('created_at');
  });

  it('returns 200 with empty array when worker has no certifications', async () => {
    resetDynamoMock();
    const getResponses = new Map<string, Record<string, unknown>>();
    getResponses.set(workerGetKey(), mockWorkerItem);

    // Empty query responses
    const queryResponses = new Map<string, Record<string, unknown>[]>();
    queryResponses.set(certQueryKey(), []);

    setupDynamoMock({ getResponses, queryResponses });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/certifications',
      path: `/workers/${WORKER_ID}/certifications`,
      pathParameters: { id: WORKER_ID },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.certifications).toEqual([]);
  });

  it('returns 404 when worker does not exist', async () => {
    resetDynamoMock();
    setupDynamoMock({});

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/certifications',
      path: '/workers/non-existent-worker/certifications',
      pathParameters: { id: 'non-existent-worker' },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ─── PATCH /workers/{id}/certifications/{certId} ─────────────────────────────

describe('PATCH /workers/{id}/certifications/{certId} - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
    const getResponses = new Map<string, Record<string, unknown>>();
    getResponses.set(workerGetKey(), mockWorkerItem);
    getResponses.set(certGetKey(), mockCertificationItem);

    setupDynamoMock({
      getResponses,
      updateCapture: [],
    });
  });

  it('returns 200 with updated certification (Requirement 2.8)', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    // Override the mock send for UpdateCommand to return ALL_NEW
    const mockSend = getMockSend();
    mockSend.mockImplementationOnce((command: unknown) => {
      const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
      const commandName = cmd.constructor?.name ?? 'UnknownCommand';
      if (commandName === 'GetCommand') {
        return Promise.resolve({ Item: mockCertificationItem });
      }
      return Promise.resolve({ Item: mockCertificationItem });
    });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}/certifications/{certId}',
      path: `/workers/${WORKER_ID}/certifications/${CERT_ID}`,
      pathParameters: { id: WORKER_ID, certId: CERT_ID },
      body: {
        validation_status: 'validated',
        validated_by: 'admin-user-1',
      },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('certification');
  });

  it('returns 404 when certification does not exist', async () => {
    resetDynamoMock();
    const getResponses = new Map<string, Record<string, unknown>>();
    // Worker exists but certification does not
    getResponses.set(workerGetKey(), mockWorkerItem);

    setupDynamoMock({ getResponses, updateCapture: [] });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}/certifications/{certId}',
      path: `/workers/${WORKER_ID}/certifications/non-existent-cert`,
      pathParameters: { id: WORKER_ID, certId: 'non-existent-cert' },
      body: { validation_status: 'validated' },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 when body is missing', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'PATCH',
      resource: '/workers/{id}/certifications/{certId}',
      path: `/workers/${WORKER_ID}/certifications/${CERT_ID}`,
      pathParameters: { id: WORKER_ID, certId: CERT_ID },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });
});

// ─── GET /workers/{id}/certifications/{certId}/document-url ──────────────────

describe('GET /workers/{id}/certifications/{certId}/document-url - E2E', () => {
  beforeEach(() => {
    resetDynamoMock();
    const getResponses = new Map<string, Record<string, unknown>>();
    getResponses.set(certGetKey(), mockCertificationItem);

    setupDynamoMock({ getResponses });
  });

  it('returns 200 with presigned URL (Requirement 2.9)', async () => {
    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/certifications/{certId}/document-url',
      path: `/workers/${WORKER_ID}/certifications/${CERT_ID}/document-url`,
      pathParameters: { id: WORKER_ID, certId: CERT_ID },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('url');
    expect(body).toHaveProperty('content_type');
    expect(typeof body.url).toBe('string');
    expect(body.url).toContain('https://');
    expect(body.content_type).toBe('application/pdf');
  });

  it('returns 404 when certification does not exist', async () => {
    resetDynamoMock();
    setupDynamoMock({});

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/certifications/{certId}/document-url',
      path: `/workers/${WORKER_ID}/certifications/non-existent-cert/document-url`,
      pathParameters: { id: WORKER_ID, certId: 'non-existent-cert' },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 when certification has no document', async () => {
    resetDynamoMock();
    const certWithoutDoc = { ...mockCertificationItem, document_key: undefined };
    const getResponses = new Map<string, Record<string, unknown>>();
    getResponses.set(certGetKey(), certWithoutDoc);

    setupDynamoMock({ getResponses });

    const claims = createMockClaims({ role: 'tenant_admin', tenant_id: TENANT_ID });

    const event = createMockEvent({
      httpMethod: 'GET',
      resource: '/workers/{id}/certifications/{certId}/document-url',
      path: `/workers/${WORKER_ID}/certifications/${CERT_ID}/document-url`,
      pathParameters: { id: WORKER_ID, certId: CERT_ID },
      claims,
    });

    const response = await handler(event as never);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toContain('No document');
  });
});
