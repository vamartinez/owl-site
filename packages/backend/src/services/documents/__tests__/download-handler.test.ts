/**
 * Unit tests for the Document Explorer download handler.
 * Tests POST /documents/download and GET /documents/download/{downloadId}/status.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedUser } from '../../../shared/auth-middleware';
import { Role } from '../../../shared/types/common';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock @aws-sdk/client-s3
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  GetObjectCommand: vi.fn().mockImplementation((params) => params),
}));

// Mock @aws-sdk/s3-request-presigner
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-download-id-1234'),
}));

// Mock the aggregator module
vi.mock('../aggregator', () => ({
  aggregateDocuments: vi.fn(),
}));

import { handleDownload, handleDownloadStatus, validateBatchSize } from '../download-handler';
import { aggregateDocuments } from '../aggregator';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

// Valid UUIDs for test documents
const UUID_1 = '10000000-0000-4000-8000-000000000001';
const UUID_2 = '20000000-0000-4000-8000-000000000002';
const UUID_3 = '30000000-0000-4000-8000-000000000003';
const UUID_4 = '40000000-0000-4000-8000-000000000004';
const UUID_INACCESSIBLE = '50000000-0000-4000-8000-000000000005';

const mockUser: AuthenticatedUser = {
  user_id: 'user-001',
  tenant_id: 'tenant-abc',
  role: Role.TENANT_ADMIN,
  email: 'admin@example.com',
};

const mockSiteUser: AuthenticatedUser = {
  user_id: 'user-002',
  tenant_id: 'tenant-abc',
  role: Role.SITE_ADMIN,
  assigned_sites: ['site-1', 'site-2'],
};

function createMockDocument(overrides: Partial<{
  id: string;
  name: string;
  fileSize: number;
  s3Key: string;
  tenantId: string;
  siteId: string;
}> = {}) {
  return {
    id: overrides.id ?? UUID_1,
    name: overrides.name ?? 'test-document.pdf',
    category: 'reports' as const,
    mimeType: 'application/pdf',
    fileSize: overrides.fileSize ?? 1024 * 1024, // 1MB default
    createdAt: '2024-01-15T10:00:00.000Z',
    siteName: 'Site Alpha',
    siteId: overrides.siteId ?? 'site-1',
    tenantId: overrides.tenantId ?? 'tenant-abc',
    s3Key: overrides.s3Key ?? 'documents/tenant-abc/doc-001.pdf',
    sha256Hash: 'abc123def456',
    folderPath: ['reports', 'Site Alpha', '2024', '01'],
  };
}

function createEvent(body: unknown) {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    httpMethod: 'POST',
    resource: '/documents/download',
  } as unknown as Parameters<typeof handleDownload>[0];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('handleDownload - POST /documents/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Requirement 7.1: Single document presigned URL generation', () => {
    it('returns presigned URL with downloadId, downloadUrl, expiresAt, totalSize, fileCount=1', async () => {
      const doc = createMockDocument({ id: UUID_1, fileSize: 2048 });
      vi.mocked(aggregateDocuments).mockResolvedValue({
        documents: [doc],
        unavailableSources: [],
      });

      const event = createEvent({ documentIds: [UUID_1] });
      const response = await handleDownload(event, mockUser);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.downloadId).toBe('mock-download-id-1234');
      expect(body.downloadUrl).toBe('https://s3.example.com/presigned-url');
      expect(body.expiresAt).toBeDefined();
      expect(body.totalSize).toBe(2048);
      expect(body.fileCount).toBe(1);
    });

    it('generates a presigned URL using the correct S3 key', async () => {
      const doc = createMockDocument({ id: UUID_1, s3Key: 'my/custom/key.pdf' });
      vi.mocked(aggregateDocuments).mockResolvedValue({
        documents: [doc],
        unavailableSources: [],
      });

      const event = createEvent({ documentIds: [UUID_1] });
      await handleDownload(event, mockUser);

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Bucket: expect.any(String), Key: 'my/custom/key.pdf' }),
        expect.objectContaining({ expiresIn: 3600 }),
      );
    });
  });

  describe('Requirement 7.2: Batch download (2-50 documents)', () => {
    it('returns response with correct fileCount for multiple documents', async () => {
      const docs = [
        createMockDocument({ id: UUID_1, fileSize: 1024 }),
        createMockDocument({ id: UUID_2, fileSize: 2048 }),
        createMockDocument({ id: UUID_3, fileSize: 4096 }),
      ];
      vi.mocked(aggregateDocuments).mockResolvedValue({
        documents: docs,
        unavailableSources: [],
      });

      const event = createEvent({ documentIds: [UUID_1, UUID_2, UUID_3] });
      const response = await handleDownload(event, mockUser);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.fileCount).toBe(3);
      expect(body.totalSize).toBe(1024 + 2048 + 4096);
      expect(body.downloadId).toBeDefined();
      expect(body.downloadUrl).toBeDefined();
      expect(body.expiresAt).toBeDefined();
    });
  });

  describe('Requirement 7.3: Validation errors', () => {
    it('returns 400 when documentIds array is empty', async () => {
      const event = createEvent({ documentIds: [] });
      const response = await handleDownload(event, mockUser);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('BAD_REQUEST');
    });

    it('returns 400 when documentIds contains more than 50 items', async () => {
      const ids = Array.from({ length: 51 }, (_, i) => {
        const hex = i.toString(16).padStart(8, '0');
        return `${hex}-0000-4000-8000-000000000000`;
      });
      const event = createEvent({ documentIds: ids });
      const response = await handleDownload(event, mockUser);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('BAD_REQUEST');
    });

    it('returns 400 when request body is missing', async () => {
      const event = {
        headers: { 'Content-Type': 'application/json' },
        body: null,
        httpMethod: 'POST',
        resource: '/documents/download',
      } as unknown as Parameters<typeof handleDownload>[0];

      const response = await handleDownload(event, mockUser);

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when documentIds contains invalid UUIDs', async () => {
      const event = createEvent({ documentIds: ['not-a-uuid'] });
      const response = await handleDownload(event, mockUser);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('BAD_REQUEST');
    });
  });

  describe('Requirement 7.4: Total size exceeds 500MB returns 413', () => {
    it('returns 413 when total file size exceeds 500MB', async () => {
      // Create documents whose combined size exceeds 500MB
      const largeDoc1 = createMockDocument({ id: UUID_1, fileSize: 300 * 1024 * 1024 });
      const largeDoc2 = createMockDocument({ id: UUID_2, fileSize: 300 * 1024 * 1024 });

      vi.mocked(aggregateDocuments).mockResolvedValue({
        documents: [largeDoc1, largeDoc2],
        unavailableSources: [],
      });

      const event = createEvent({ documentIds: [UUID_1, UUID_2] });
      const response = await handleDownload(event, mockUser);

      expect(response.statusCode).toBe(413);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('PAYLOAD_TOO_LARGE');
      expect(body.message).toContain('500MB');
    });

    it('allows download at exactly 500MB', async () => {
      const doc = createMockDocument({ id: UUID_1, fileSize: 500 * 1024 * 1024 });
      vi.mocked(aggregateDocuments).mockResolvedValue({
        documents: [doc],
        unavailableSources: [],
      });

      const event = createEvent({ documentIds: [UUID_1] });
      const response = await handleDownload(event, mockUser);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Requirement 7.5: Partial failure with skipped documents', () => {
    it('returns ZIP URL with skippedDocuments listing inaccessible docs', async () => {
      // 3 requested docs, only 2 are accessible (1 is not in aggregated results)
      const doc1 = createMockDocument({ id: UUID_1, fileSize: 1024 });
      const doc2 = createMockDocument({ id: UUID_2, fileSize: 2048 });
      // UUID_INACCESSIBLE is NOT in the aggregated documents

      vi.mocked(aggregateDocuments).mockResolvedValue({
        documents: [doc1, doc2],
        unavailableSources: [],
      });

      const event = createEvent({
        documentIds: [UUID_1, UUID_2, UUID_INACCESSIBLE],
      });
      const response = await handleDownload(event, mockUser);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.fileCount).toBe(2);
      expect(body.skippedDocuments).toBeDefined();
      expect(body.skippedDocuments).toHaveLength(1);
      expect(body.skippedDocuments[0].id).toBe(UUID_INACCESSIBLE);
      expect(body.skippedDocuments[0].reason).toBeDefined();
    });

    it('returns 404 when no requested documents are accessible', async () => {
      vi.mocked(aggregateDocuments).mockResolvedValue({
        documents: [],
        unavailableSources: [],
      });

      const event = createEvent({ documentIds: [UUID_1, UUID_2] });
      const response = await handleDownload(event, mockUser);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('NOT_FOUND');
    });
  });
});

describe('handleDownloadStatus - GET /documents/download/{downloadId}/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Requirement 7.6: Download status responses', () => {
    it('returns status response with downloadId and status field', async () => {
      const response = await handleDownloadStatus('dl-id-abc', mockUser);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.downloadId).toBe('dl-id-abc');
      expect(body.status).toBeDefined();
      expect(['preparing', 'ready', 'failed', 'expired']).toContain(body.status);
      expect(typeof body.progress).toBe('number');
    });

    it('returns 400 when downloadId is undefined', async () => {
      const response = await handleDownloadStatus(undefined, mockUser);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('BAD_REQUEST');
    });

    it('returns progress percentage in the response', async () => {
      const response = await handleDownloadStatus('dl-progress-check', mockUser);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.progress).toBeGreaterThanOrEqual(0);
      expect(body.progress).toBeLessThanOrEqual(100);
    });
  });
});

describe('validateBatchSize - pure function', () => {
  const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

  it('returns valid:true and correct totalSize for sizes under limit', () => {
    const result = validateBatchSize([1024, 2048, 4096]);
    expect(result.valid).toBe(true);
    expect(result.totalSize).toBe(1024 + 2048 + 4096);
  });

  it('returns valid:false when sizes exceed 500MB', () => {
    const sizes = [300 * 1024 * 1024, 250 * 1024 * 1024];
    const result = validateBatchSize(sizes);
    expect(result.valid).toBe(false);
    expect(result.totalSize).toBe(300 * 1024 * 1024 + 250 * 1024 * 1024);
  });

  it('returns valid:true for empty array (totalSize = 0)', () => {
    const result = validateBatchSize([]);
    expect(result.valid).toBe(true);
    expect(result.totalSize).toBe(0);
  });

  it('returns valid:true at exactly 500MB boundary', () => {
    const result = validateBatchSize([MAX_TOTAL_BYTES]);
    expect(result.valid).toBe(true);
    expect(result.totalSize).toBe(MAX_TOTAL_BYTES);
  });

  it('returns valid:false at one byte over 500MB', () => {
    const result = validateBatchSize([MAX_TOTAL_BYTES + 1]);
    expect(result.valid).toBe(false);
    expect(result.totalSize).toBe(MAX_TOTAL_BYTES + 1);
  });

  it('handles single large file correctly', () => {
    const result = validateBatchSize([100 * 1024 * 1024]);
    expect(result.valid).toBe(true);
    expect(result.totalSize).toBe(100 * 1024 * 1024);
  });

  it('handles many small files summing under 500MB', () => {
    const sizes = Array.from({ length: 50 }, () => 1024 * 1024); // 50 x 1MB = 50MB
    const result = validateBatchSize(sizes);
    expect(result.valid).toBe(true);
    expect(result.totalSize).toBe(50 * 1024 * 1024);
  });

  it('handles many files summing over 500MB', () => {
    const sizes = Array.from({ length: 50 }, () => 11 * 1024 * 1024); // 50 x 11MB = 550MB
    const result = validateBatchSize(sizes);
    expect(result.valid).toBe(false);
    expect(result.totalSize).toBe(50 * 11 * 1024 * 1024);
  });
});
