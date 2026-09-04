/**
 * Unit tests for Document Aggregator.
 *
 * Tests parallel query behavior, field normalization from each source table,
 * graceful degradation when sources fail, and retry logic for throttling/timeout.
 *
 * **Validates: Requirements 11.1, 11.3, 11.4, 12.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '../../../shared/types/common.js';
import type { AuthenticatedUser } from '../../../shared/auth-middleware.js';
import type { SourceTableConfig, DocumentCategory } from '../types.js';

// ─── Mock DynamoDB client ────────────────────────────────────────────────────

const mockSend = vi.fn();

vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  getTableName: (name: string) => `test-${name}`,
}));

// ─── Import after mocking ────────────────────────────────────────────────────

import {
  aggregateDocuments,
  normalizeDocument,
  SOURCE_TABLES,
  withRetry,
} from '../aggregator.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    user_id: 'user-001',
    tenant_id: 'tenant-abc',
    role: Role.TENANT_ADMIN,
    ...overrides,
  };
}

/** Creates a raw DynamoDB record for a given source table config. */
function makeRawRecord(
  config: SourceTableConfig,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    [config.fieldMap.id]: 'doc-123',
    [config.fieldMap.name]: 'Test Document',
    [config.fieldMap.mimeType]: 'application/pdf',
    [config.fieldMap.fileSize]: 5000,
    [config.fieldMap.createdAt]: '2024-06-15T10:30:00Z',
    [config.fieldMap.siteName]: 'Main Site',
    [config.fieldMap.siteId]: 'site-001',
    [config.fieldMap.tenantId]: 'tenant-abc',
    [config.fieldMap.s3Key]: 'documents/test-file.pdf',
    [config.fieldMap.sha256Hash]: 'a'.repeat(64),
    ...overrides,
  };
}

// ─── Tests: Parallel query ───────────────────────────────────────────────────

describe('aggregateDocuments - parallel query', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('queries all 5 source tables in parallel', async () => {
    mockSend.mockResolvedValue({ Items: [] });

    const user = makeUser();
    await aggregateDocuments(user);

    // Should have been called once per source table
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it('queries only filtered category when category option is provided', async () => {
    mockSend.mockResolvedValue({ Items: [] });

    const user = makeUser();
    await aggregateDocuments(user, { category: 'reports' });

    // Only the Reports table should be queried
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('combines documents from all source tables into a single array', async () => {
    // Each source returns 1 document
    let callIndex = 0;
    mockSend.mockImplementation(() => {
      const config = SOURCE_TABLES[callIndex]!;
      callIndex++;
      return Promise.resolve({
        Items: [makeRawRecord(config, { [config.fieldMap.id]: `doc-${callIndex}` })],
      });
    });

    const user = makeUser();
    const result = await aggregateDocuments(user);

    expect(result.documents).toHaveLength(5);
    expect(result.unavailableSources).toHaveLength(0);
  });

  it('returns empty documents array when all sources return no items', async () => {
    mockSend.mockResolvedValue({ Items: [] });

    const user = makeUser();
    const result = await aggregateDocuments(user);

    expect(result.documents).toHaveLength(0);
    expect(result.unavailableSources).toHaveLength(0);
  });
});

// ─── Tests: Field normalization ──────────────────────────────────────────────

describe('normalizeDocument - field normalization from each source table', () => {
  it('normalizes a Reports table record correctly', () => {
    const config = SOURCE_TABLES.find((t) => t.tableName === 'Reports')!;
    const raw = {
      report_id: 'rpt-001',
      title: 'Safety Audit Report',
      mime_type: 'application/pdf',
      file_size: 12000,
      created_at: '2024-03-15T14:00:00Z',
      site_name: 'Downtown Site',
      site_id: 'site-dt',
      tenant_id: 'tenant-1',
      s3_key: 'reports/rpt-001.pdf',
      sha256_hash: 'b'.repeat(64),
    };

    const result = normalizeDocument(raw, config);

    expect(result).toEqual({
      id: 'rpt-001',
      name: 'Safety Audit Report',
      category: 'reports',
      mimeType: 'application/pdf',
      fileSize: 12000,
      createdAt: '2024-03-15T14:00:00Z',
      siteName: 'Downtown Site',
      siteId: 'site-dt',
      tenantId: 'tenant-1',
      s3Key: 'reports/rpt-001.pdf',
      sha256Hash: 'b'.repeat(64),
      folderPath: [],
    });
  });

  it('normalizes a Forms table record correctly', () => {
    const config = SOURCE_TABLES.find((t) => t.tableName === 'Forms')!;
    const raw = {
      form_id: 'frm-002',
      name: 'Inspection Form',
      mime_type: 'image/jpeg',
      file_size: 3000,
      created_at: '2024-04-10T09:00:00Z',
      site_name: 'North Site',
      site_id: 'site-north',
      tenant_id: 'tenant-2',
      s3_key: 'forms/frm-002.jpg',
      sha256_hash: 'c'.repeat(64),
    };

    const result = normalizeDocument(raw, config);

    expect(result).toEqual({
      id: 'frm-002',
      name: 'Inspection Form',
      category: 'forms',
      mimeType: 'image/jpeg',
      fileSize: 3000,
      createdAt: '2024-04-10T09:00:00Z',
      siteName: 'North Site',
      siteId: 'site-north',
      tenantId: 'tenant-2',
      s3Key: 'forms/frm-002.jpg',
      sha256Hash: 'c'.repeat(64),
      folderPath: [],
    });
  });

  it('normalizes a Certifications table record correctly', () => {
    const config = SOURCE_TABLES.find((t) => t.tableName === 'Certifications')!;
    const raw = {
      certification_id: 'cert-003',
      document_name: 'WHMIS Certificate',
      mime_type: 'application/pdf',
      file_size: 8000,
      created_at: '2024-05-20T11:30:00Z',
      site_name: 'East Site',
      site_id: 'site-east',
      tenant_id: 'tenant-3',
      s3_key: 'certs/cert-003.pdf',
      sha256_hash: 'd'.repeat(64),
    };

    const result = normalizeDocument(raw, config);

    expect(result).toEqual({
      id: 'cert-003',
      name: 'WHMIS Certificate',
      category: 'certifications',
      mimeType: 'application/pdf',
      fileSize: 8000,
      createdAt: '2024-05-20T11:30:00Z',
      siteName: 'East Site',
      siteId: 'site-east',
      tenantId: 'tenant-3',
      s3Key: 'certs/cert-003.pdf',
      sha256Hash: 'd'.repeat(64),
      folderPath: [],
    });
  });

  it('normalizes an Incidents table record correctly', () => {
    const config = SOURCE_TABLES.find((t) => t.tableName === 'Incidents')!;
    const raw = {
      incident_id: 'inc-004',
      title: 'Near Miss Report',
      mime_type: 'image/png',
      file_size: 15000,
      created_at: '2024-07-01T16:45:00Z',
      site_name: 'South Site',
      site_id: 'site-south',
      tenant_id: 'tenant-4',
      s3_key: 'incidents/inc-004.png',
      sha256_hash: 'e'.repeat(64),
    };

    const result = normalizeDocument(raw, config);

    expect(result).toEqual({
      id: 'inc-004',
      name: 'Near Miss Report',
      category: 'incidents',
      mimeType: 'image/png',
      fileSize: 15000,
      createdAt: '2024-07-01T16:45:00Z',
      siteName: 'South Site',
      siteId: 'site-south',
      tenantId: 'tenant-4',
      s3Key: 'incidents/inc-004.png',
      sha256Hash: 'e'.repeat(64),
      folderPath: [],
    });
  });

  it('normalizes a SafetyEvidence table record correctly', () => {
    const config = SOURCE_TABLES.find((t) => t.tableName === 'SafetyEvidence')!;
    const raw = {
      evidence_id: 'ev-005',
      title: 'Harness Inspection Photo',
      mime_type: 'image/jpeg',
      file_size: 25000,
      created_at: '2024-08-12T08:15:00Z',
      site_name: 'West Site',
      site_id: 'site-west',
      tenant_id: 'tenant-5',
      s3_key: 'evidence/ev-005.jpg',
      sha256_hash: 'f'.repeat(64),
    };

    const result = normalizeDocument(raw, config);

    expect(result).toEqual({
      id: 'ev-005',
      name: 'Harness Inspection Photo',
      category: 'safety_evidence',
      mimeType: 'image/jpeg',
      fileSize: 25000,
      createdAt: '2024-08-12T08:15:00Z',
      siteName: 'West Site',
      siteId: 'site-west',
      tenantId: 'tenant-5',
      s3Key: 'evidence/ev-005.jpg',
      sha256Hash: 'f'.repeat(64),
      folderPath: [],
    });
  });

  it('sets sha256Hash to null when the field is missing from raw record', () => {
    const config = SOURCE_TABLES[0]!;
    const raw = makeRawRecord(config);
    delete raw[config.fieldMap.sha256Hash];

    const result = normalizeDocument(raw, config);

    expect(result.sha256Hash).toBeNull();
  });

  it('defaults mimeType to application/octet-stream when missing', () => {
    const config = SOURCE_TABLES[0]!;
    const raw = makeRawRecord(config);
    delete raw[config.fieldMap.mimeType];

    const result = normalizeDocument(raw, config);

    expect(result.mimeType).toBe('application/octet-stream');
  });

  it('defaults fileSize to 0 when missing', () => {
    const config = SOURCE_TABLES[0]!;
    const raw = makeRawRecord(config);
    delete raw[config.fieldMap.fileSize];

    const result = normalizeDocument(raw, config);

    expect(result.fileSize).toBe(0);
  });

  it('always sets folderPath to an empty array', () => {
    for (const config of SOURCE_TABLES) {
      const raw = makeRawRecord(config);
      const result = normalizeDocument(raw, config);
      expect(result.folderPath).toEqual([]);
    }
  });
});

// ─── Tests: Graceful degradation ─────────────────────────────────────────────

describe('aggregateDocuments - graceful degradation', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('returns documents from successful sources when 1 source fails', async () => {
    let callIndex = 0;
    mockSend.mockImplementation(() => {
      const idx = callIndex++;
      if (idx === 0) {
        // First source (Reports) fails
        return Promise.reject(new Error('DynamoDB unavailable'));
      }
      const config = SOURCE_TABLES[idx]!;
      return Promise.resolve({
        Items: [makeRawRecord(config, { [config.fieldMap.id]: `doc-${idx}` })],
      });
    });

    const user = makeUser();
    const result = await aggregateDocuments(user);

    expect(result.documents).toHaveLength(4);
    expect(result.unavailableSources).toEqual(['Reports']);
  });

  it('returns documents from successful sources when 2 sources fail', async () => {
    let callIndex = 0;
    mockSend.mockImplementation(() => {
      const idx = callIndex++;
      if (idx === 0 || idx === 2) {
        // Reports and Certifications fail
        return Promise.reject(new Error('DynamoDB unavailable'));
      }
      const config = SOURCE_TABLES[idx]!;
      return Promise.resolve({
        Items: [makeRawRecord(config, { [config.fieldMap.id]: `doc-${idx}` })],
      });
    });

    const user = makeUser();
    const result = await aggregateDocuments(user);

    expect(result.documents).toHaveLength(3);
    expect(result.unavailableSources).toContain('Reports');
    expect(result.unavailableSources).toContain('Certifications');
    expect(result.unavailableSources).toHaveLength(2);
  });

  it('returns empty documents with all sources listed as unavailable when all fail', async () => {
    mockSend.mockRejectedValue(new Error('All sources down'));

    const user = makeUser();
    const result = await aggregateDocuments(user);

    expect(result.documents).toHaveLength(0);
    expect(result.unavailableSources).toHaveLength(5);
    expect(result.unavailableSources).toEqual(
      expect.arrayContaining(['Reports', 'Forms', 'Certifications', 'Incidents', 'SafetyEvidence']),
    );
  });

  it('populates unavailableSources with exact table names that failed', async () => {
    let callIndex = 0;
    mockSend.mockImplementation(() => {
      const idx = callIndex++;
      // Only Incidents (index 3) fails
      if (idx === 3) {
        return Promise.reject(new Error('Throttled'));
      }
      return Promise.resolve({ Items: [] });
    });

    const user = makeUser();
    const result = await aggregateDocuments(user);

    expect(result.unavailableSources).toEqual(['Incidents']);
  });
});

// ─── Tests: Retry on throttling/timeout ──────────────────────────────────────

describe('withRetry - retry logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries once on ProvisionedThroughputExceededException', async () => {
    const throttleError = new Error('Rate exceeded');
    throttleError.name = 'ProvisionedThroughputExceededException';

    const operation = vi.fn()
      .mockRejectedValueOnce(throttleError)
      .mockResolvedValueOnce({ Items: [{ id: '1' }] });

    const resultPromise = withRetry(operation);
    // Advance past the 200ms delay
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ Items: [{ id: '1' }] });
  });

  it('retries once on RequestTimeout', async () => {
    const timeoutError = new Error('Request timed out');
    timeoutError.name = 'RequestTimeout';

    const operation = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({ Items: [] });

    const resultPromise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ Items: [] });
  });

  it('retries once on TimeoutError', async () => {
    const timeoutError = new Error('Timeout');
    timeoutError.name = 'TimeoutError';

    const operation = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({ Items: [{ id: 'retry-ok' }] });

    const resultPromise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ Items: [{ id: 'retry-ok' }] });
  });

  it('throws immediately for non-retryable errors', async () => {
    const accessDenied = new Error('Access Denied');
    accessDenied.name = 'AccessDeniedException';

    const operation = vi.fn().mockRejectedValueOnce(accessDenied);

    await expect(withRetry(operation)).rejects.toThrow('Access Denied');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('throws after retry exhaustion if second attempt also fails', async () => {
    vi.useRealTimers();

    const throttleError = new Error('Rate exceeded');
    throttleError.name = 'ProvisionedThroughputExceededException';

    const operation = vi.fn()
      .mockRejectedValueOnce(throttleError)
      .mockRejectedValueOnce(throttleError);

    await expect(withRetry(operation, 1, 0)).rejects.toThrow('Rate exceeded');
    expect(operation).toHaveBeenCalledTimes(2);

    vi.useFakeTimers();
  });

  it('does not retry non-Error thrown values', async () => {
    const operation = vi.fn().mockRejectedValueOnce('string error');

    await expect(withRetry(operation)).rejects.toBe('string error');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries with ProvisionedThroughputExceededException via code property', async () => {
    const throttleError = new Error('Throughput exceeded') as Error & { code: string };
    throttleError.code = 'ProvisionedThroughputExceededException';

    const operation = vi.fn()
      .mockRejectedValueOnce(throttleError)
      .mockResolvedValueOnce({ success: true });

    const resultPromise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ success: true });
  });

  it('retries with RequestTimeout via code property', async () => {
    const timeoutError = new Error('Timed out') as Error & { code: string };
    timeoutError.code = 'RequestTimeout';

    const operation = vi.fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({ ok: true });

    const resultPromise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it('succeeds without retry when operation succeeds on first attempt', async () => {
    const operation = vi.fn().mockResolvedValueOnce({ Items: ['data'] });

    const result = await withRetry(operation);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ Items: ['data'] });
  });
});
