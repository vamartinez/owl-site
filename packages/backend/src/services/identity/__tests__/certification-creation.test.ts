/**
 * Unit tests for the certification creation module.
 * Validates: Requirements 1.4
 *
 * Verifies:
 * - DynamoDB PutCommand includes a generated certification ID
 * - Record includes created_at/updated_at timestamps
 * - Partition key is correctly prefixed with tenant ID
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo';

// Mock the dynamo-client module to use our test mock
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock the event-publisher to prevent real SNS calls
vi.mock('../../../shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({
    event_id: 'mock-event-id',
    event_type: 'certification.uploaded',
    source_service: 'identity-service',
    tenant_id: 'tenant-test',
    timestamp: '2024-01-01T00:00:00.000Z',
    payload: {},
    correlation_id: 'mock-correlation-id',
    version: '1.0',
  }),
}));

// Mock S3 client and presigner to prevent real AWS calls
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-upload-url'),
}));

// Mock uuid to return a predictable certification ID
const MOCK_UUID_CERT = 'cccccccc-1111-2222-3333-444444444444';

vi.mock('uuid', () => ({
  v4: () => MOCK_UUID_CERT,
}));

import { createCertification } from '../certification.js';
import { CertificationType, CertificationStatus } from '../../../shared/types/common.js';
import type { CreateCertificationInput } from '../types.js';

describe('Certification Creation Module', () => {
  const putCapture: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    resetDynamoMock();
    putCapture.length = 0;
    setupDynamoMock({ putCapture });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const validInput: CreateCertificationInput = {
    certification_type: CertificationType.FALL_PROTECTION,
    issuer: 'Safety Training Corp',
    issue_date: '2024-01-15T00:00:00.000Z',
    expiry_date: '2025-01-15T00:00:00.000Z',
  };

  describe('Generated certification ID', () => {
    it('generates a UUID for certification_id', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.certification_id).toBe(MOCK_UUID_CERT);
      expect(item.certification_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('includes the generated ID in the SK as CERT#<id>', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.SK).toBe(`CERT#${MOCK_UUID_CERT}`);
    });
  });

  describe('Timestamps', () => {
    it('sets created_at to the current timestamp', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.created_at).toBe('2024-06-15T10:30:00.000Z');
    });

    it('sets updated_at to the current timestamp', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.updated_at).toBe('2024-06-15T10:30:00.000Z');
    });

    it('has created_at and updated_at equal on creation', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.created_at).toBe(item.updated_at);
    });
  });

  describe('Partition key with tenant prefix', () => {
    it('uses PK formatted as TENANT#<tenant_id>#WORKER#<worker_id>', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.PK).toBe('TENANT#tenant-test#WORKER#worker-1');
    });

    it('uses GSI1PK formatted as TENANT#<tenant_id>', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.GSI1PK).toBe('TENANT#tenant-test');
    });

    it('uses a different tenant prefix for a different tenant', async () => {
      await createCertification('acme-corp', 'worker-42', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.PK).toBe('TENANT#acme-corp#WORKER#worker-42');
      expect(item.GSI1PK).toBe('TENANT#acme-corp');
      expect(item.tenant_id).toBe('acme-corp');
    });
  });

  describe('DynamoDB PutCommand parameters', () => {
    it('sends a PutCommand to the correct table', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const calls = getDynamoCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('PutCommand');

      const input = calls[0].input as Record<string, unknown>;
      expect(input.TableName).toBe('test-Certifications');
    });

    it('includes all input fields in the stored item', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.certification_type).toBe(CertificationType.FALL_PROTECTION);
      expect(item.issuer).toBe('Safety Training Corp');
      expect(item.issue_date).toBe('2024-01-15T00:00:00.000Z');
      expect(item.expiry_date).toBe('2025-01-15T00:00:00.000Z');
    });

    it('sets initial validation_status to PENDING', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.validation_status).toBe(CertificationStatus.PENDING);
    });

    it('stores worker_id and tenant_id in the item', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.worker_id).toBe('worker-1');
      expect(item.tenant_id).toBe('tenant-test');
    });

    it('constructs GSI1SK with expiry date and certification ID', async () => {
      await createCertification('tenant-test', 'worker-1', validInput);

      const input = putCapture[0] as Record<string, unknown>;
      const item = input.Item as Record<string, unknown>;

      expect(item.GSI1SK).toBe(`CERT#${validInput.expiry_date}#${MOCK_UUID_CERT}`);
    });
  });

  describe('Return value', () => {
    it('returns the created certification with all fields', async () => {
      const result = await createCertification('tenant-test', 'worker-1', validInput);

      expect(result.certification).toMatchObject({
        certification_id: MOCK_UUID_CERT,
        worker_id: 'worker-1',
        tenant_id: 'tenant-test',
        certification_type: CertificationType.FALL_PROTECTION,
        issuer: 'Safety Training Corp',
        issue_date: '2024-01-15T00:00:00.000Z',
        expiry_date: '2025-01-15T00:00:00.000Z',
        validation_status: CertificationStatus.PENDING,
        created_at: '2024-06-15T10:30:00.000Z',
        updated_at: '2024-06-15T10:30:00.000Z',
      });
    });

    it('returns upload_url when document info is provided', async () => {
      const inputWithDoc: CreateCertificationInput = {
        ...validInput,
        document_content_type: 'application/pdf',
        document_filename: 'cert.pdf',
      };

      const result = await createCertification('tenant-test', 'worker-1', inputWithDoc);

      expect(result.upload_url).toBe('https://s3.example.com/presigned-upload-url');
    });

    it('does not return upload_url when no document info is provided', async () => {
      const result = await createCertification('tenant-test', 'worker-1', validInput);

      expect(result.upload_url).toBeUndefined();
    });
  });
});
