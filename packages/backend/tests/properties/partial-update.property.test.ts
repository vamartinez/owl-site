/**
 * Property-based test: Partial update only writes specified fields
 *
 * Property 1: For any valid subset of updatable fields provided to a worker or
 * certification update operation, the resulting DynamoDB UpdateExpression SHALL
 * contain only the specified fields and no others.
 *
 * **Validates: Requirements 1.3, 1.5**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../helpers/mock-dynamo.js';

// Mock the dynamo-client module
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock the event-publisher
vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({}),
}));

// Mock S3 (imported by certification module)
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://mock-presigned-url.s3.amazonaws.com'),
}));

import { updateWorker } from '../../src/services/identity/worker.js';
import { updateCertification } from '../../src/services/identity/certification.js';
import { LanguagePreference, CertificationStatus } from '../../src/shared/types/common.js';

// ─── Worker updatable fields ───────────────────────────────────────────────────

const WORKER_UPDATABLE_FIELDS = [
  'legal_name',
  'preferred_name',
  'phone',
  'language_preference',
  'email',
] as const;

type WorkerFieldKey = (typeof WORKER_UPDATABLE_FIELDS)[number];

/** Generates a valid value for a given worker updatable field */
function workerFieldValue(field: WorkerFieldKey): fc.Arbitrary<string> {
  switch (field) {
    case 'legal_name':
      return fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.split('')), {
        minLength: 1,
        maxLength: 50,
      });
    case 'preferred_name':
      return fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.split('')), {
        minLength: 1,
        maxLength: 30,
      });
    case 'phone':
      return fc.integer({ min: 1000000000, max: 9999999999 }).map((n) => `+1${n}`);
    case 'language_preference':
      return fc.constantFrom(
        LanguagePreference.ENGLISH,
        LanguagePreference.SPANISH,
        LanguagePreference.PUNJABI,
      );
    case 'email':
      return fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
        minLength: 3,
        maxLength: 10,
      }).map((local) => `${local}@test.com`);
  }
}

/**
 * Arbitrary that generates a non-empty subset of worker updatable fields with valid values.
 */
const arbWorkerUpdateSubset = fc
  .subarray([...WORKER_UPDATABLE_FIELDS], { minLength: 1 })
  .chain((fields) => {
    const entries = fields.map((field) =>
      workerFieldValue(field).map((value) => [field, value] as [string, unknown]),
    );
    return fc.tuple(...entries).map((pairs) => Object.fromEntries(pairs));
  });

// ─── Certification updatable fields ────────────────────────────────────────────

const CERTIFICATION_UPDATABLE_FIELDS = [
  'validation_status',
  'rejection_reason',
  'validated_by',
] as const;

type CertFieldKey = (typeof CERTIFICATION_UPDATABLE_FIELDS)[number];

/** Generates a valid value for a given certification updatable field */
function certFieldValue(field: CertFieldKey): fc.Arbitrary<string> {
  switch (field) {
    case 'validation_status':
      // Only VALIDATED is a valid transition from PENDING
      return fc.constant(CertificationStatus.VALIDATED);
    case 'rejection_reason':
      return fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.split('')), {
        minLength: 1,
        maxLength: 100,
      });
    case 'validated_by':
      return fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
        minLength: 3,
        maxLength: 20,
      }).map((id) => `admin-${id}`);
  }
}

/**
 * Arbitrary that generates a non-empty subset of certification updatable fields with valid values.
 */
const arbCertUpdateSubset = fc
  .subarray([...CERTIFICATION_UPDATABLE_FIELDS], { minLength: 1 })
  .chain((fields) => {
    const entries = fields.map((field) =>
      certFieldValue(field).map((value) => [field, value] as [string, unknown]),
    );
    return fc.tuple(...entries).map((pairs) => Object.fromEntries(pairs));
  });

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Property 1: Partial update only writes specified fields', () => {
  const tenantId = 'tenant-test';
  const workerId = 'worker-123';
  const certificationId = 'cert-456';

  const existingWorker = {
    worker_id: workerId,
    tenant_id: tenantId,
    legal_name: 'Jane Doe',
    phone: '+14155551234',
    language_preference: 'en',
    status: 'active',
    created_at: '2024-06-01T00:00:00.000Z',
    updated_at: '2024-06-01T00:00:00.000Z',
  };

  const existingCertification = {
    certification_id: certificationId,
    worker_id: workerId,
    tenant_id: tenantId,
    certification_type: 'whmis_2015',
    issuer: 'Safety Board',
    issue_date: '2024-01-01T00:00:00.000Z',
    expiry_date: '2025-01-01T00:00:00.000Z',
    document_key: 'certifications/tenant-test/worker-123/cert-456/doc.pdf',
    validation_status: CertificationStatus.PENDING,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-07-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDynamoMock();
  });

  // **Validates: Requirements 1.3**
  it('worker update: UpdateExpression contains ONLY the specified fields (plus updated_at)', async () => {
    await fc.assert(
      fc.asyncProperty(arbWorkerUpdateSubset, async (updateInput) => {
        // Setup mock for each iteration
        resetDynamoMock();
        const getKey = JSON.stringify({
          PK: `TENANT#${tenantId}`,
          SK: `WORKER#${workerId}`,
        });
        setupDynamoMock({
          getResponses: new Map([[getKey, existingWorker]]),
          updateCapture: [],
        });

        await updateWorker(tenantId, workerId, updateInput as any);

        const calls = getDynamoCalls();
        const updateCall = calls.find((c) => c.command === 'UpdateCommand');
        expect(updateCall).toBeDefined();

        const input = updateCall!.input as Record<string, unknown>;
        const expressionAttributeNames = input.ExpressionAttributeNames as Record<string, string>;

        // Get all field names referenced in the UpdateExpression
        const referencedFields = Object.values(expressionAttributeNames);

        // The specified fields + updated_at should be present
        const specifiedFields = Object.keys(updateInput);
        const expectedFields = [...specifiedFields, 'updated_at'];

        // Every referenced field must be in expectedFields
        for (const field of referencedFields) {
          expect(expectedFields).toContain(field);
        }

        // Every expected field must be referenced
        for (const field of expectedFields) {
          expect(referencedFields).toContain(field);
        }

        // No other worker fields should be in the expression
        const unspecifiedFields = WORKER_UPDATABLE_FIELDS.filter(
          (f) => !specifiedFields.includes(f),
        );
        for (const field of unspecifiedFields) {
          expect(referencedFields).not.toContain(field);
        }
      }),
      { numRuns: 100 },
    );
  });

  // **Validates: Requirements 1.5**
  it('certification update: UpdateExpression contains ONLY the specified fields (plus updated_at and derived fields)', async () => {
    await fc.assert(
      fc.asyncProperty(arbCertUpdateSubset, async (updateInput) => {
        // Setup mock for each iteration
        resetDynamoMock();
        const getKey = JSON.stringify({
          PK: `TENANT#${tenantId}#WORKER#${workerId}`,
          SK: `CERT#${certificationId}`,
        });
        setupDynamoMock({
          getResponses: new Map([[getKey, existingCertification]]),
          updateCapture: [],
        });

        await updateCertification(tenantId, workerId, certificationId, updateInput as any);

        const calls = getDynamoCalls();
        const updateCall = calls.find((c) => c.command === 'UpdateCommand');
        expect(updateCall).toBeDefined();

        const input = updateCall!.input as Record<string, unknown>;
        const expressionAttributeNames = input.ExpressionAttributeNames as Record<string, string>;

        // Get all field names referenced in the UpdateExpression
        const referencedFields = Object.values(expressionAttributeNames);

        // Build expected fields: specified fields + updated_at + derived fields
        const specifiedFields = Object.keys(updateInput);
        const expectedFields = [...specifiedFields, 'updated_at'];

        // If validated_by is specified, validated_at is also added automatically
        if (specifiedFields.includes('validated_by')) {
          expectedFields.push('validated_at');
        }

        // Every referenced field must be in expectedFields
        for (const field of referencedFields) {
          expect(expectedFields).toContain(field);
        }

        // Every expected field must be referenced
        for (const field of expectedFields) {
          expect(referencedFields).toContain(field);
        }

        // No immutable certification fields should be in the expression
        const immutableFields = [
          'certification_id',
          'worker_id',
          'tenant_id',
          'certification_type',
          'issuer',
          'issue_date',
          'expiry_date',
          'document_key',
          'created_at',
        ];
        for (const field of immutableFields) {
          expect(referencedFields).not.toContain(field);
        }
      }),
      { numRuns: 100 },
    );
  });
});
