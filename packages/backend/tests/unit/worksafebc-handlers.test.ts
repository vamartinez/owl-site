/**
 * WorkSafeBC session handler tests (routes).
 * Covers RBAC on upload (Property 2), create/categorize happy paths, and
 * tenant isolation / non-disclosure on get (Property 7 / Requirement 5.6).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
const mockGetSignedUrl = vi.fn();
const mockSqsSend = vi.fn();

vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: (...a: unknown[]) => mockSend(...a) },
  getTableName: (n: string) => `dev-${n}`,
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...a: unknown[]) => mockGetSignedUrl(...a),
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {},
  PutObjectCommand: class { constructor(public input: unknown) {} },
}));
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class { send = (...a: unknown[]) => mockSqsSend(...a); },
  SendMessageCommand: class { constructor(public input: unknown) {} },
}));

import {
  handleCreateSession,
  handleCategorize,
  handleGetSession,
} from '../../src/services/report-validation/worksafebc-handlers.js';
import { Role } from '../../src/shared/types/common.js';
import type { AuthenticatedUser } from '../../src/shared/auth-middleware.js';

const admin: AuthenticatedUser = { user_id: 'u1', tenant_id: 't1', role: Role.SITE_ADMIN };
const worker: AuthenticatedUser = { user_id: 'u2', tenant_id: 't1', role: Role.WORKER };

beforeEach(() => {
  mockSend.mockReset();
  mockGetSignedUrl.mockReset();
  mockSqsSend.mockReset();
  process.env['MEDIA_BUCKET_NAME'] = 'bucket';
  process.env['PDF_COMPLIANCE_QUEUE_URL'] = 'https://sqs/q';
});

describe('handleCreateSession', () => {
  it('denies a worker (no worksafebc:upload)', async () => {
    const res = await handleCreateSession(worker, { site_id: 's1', document_size_bytes: 1000 });
    expect(res.statusCode).toBe(403);
  });

  it('rejects oversized document', async () => {
    const res = await handleCreateSession(admin, { site_id: 's1', document_size_bytes: 60 * 1024 * 1024 });
    expect(res.statusCode).toBe(400);
  });

  it('creates a session and returns a presigned url', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://s3/put');
    mockSend.mockResolvedValueOnce({}); // put
    const res = await handleCreateSession(admin, {
      site_id: 's1',
      document_name: 'plan.pdf',
      document_size_bytes: 2048,
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.upload_url).toBe('https://s3/put');
    expect(body.status).toBe('recibido');
  });
});

describe('handleCategorize', () => {
  it('rejects an invalid category', async () => {
    const res = await handleCategorize(admin, 'sess1', { category: 'nope' });
    expect(res.statusCode).toBe(400);
  });

  it('categorizes a recibido session and enqueues extraction', async () => {
    mockSend.mockResolvedValueOnce({ Item: { session_id: 'sess1', tenant_id: 't1', site_id: 's1', status: 'recibido', category: null } });
    mockSend.mockResolvedValueOnce({}); // update
    const res = await handleCategorize(admin, 'sess1', { category: 'plan_seguridad' });
    expect(res.statusCode).toBe(200);
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
  });
});

describe('handleGetSession (tenant isolation)', () => {
  it('returns 404 (non-disclosure) when session is missing', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    const res = await handleGetSession(admin, 'x');
    expect(res.statusCode).toBe(404);
  });

  it('returns the session for the owning tenant', async () => {
    mockSend.mockResolvedValueOnce({ Item: { session_id: 'x', tenant_id: 't1', status: 'analisis_completado' } });
    const res = await handleGetSession(admin, 'x');
    expect(res.statusCode).toBe(200);
  });
});
