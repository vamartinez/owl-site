/**
 * Unit tests for the certification update module.
 * Validates: Requirements 1.5
 *
 * Verifies that the certification update module's UpdateCommand only writes
 * mutable fields (validation_status, rejection_reason, validated_by, validated_at, updated_at).
 * No immutable fields (certification_id, worker_id, tenant_id, certification_type,
 * issuer, issue_date, expiry_date, document_key, created_at) should be present in the UpdateExpression.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo.js';
import { createMockClaims } from '../../../../tests/helpers/mock-user.js';
import { CertificationStatus } from '../../../shared/types/common.js';

// Mock the dynamo-client module
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock the event-publisher module (not used by update, but imported by the module)
vi.mock('../../../shared/event-publisher.js', () => ({
  publishEvent: vi.fn().mockResolvedValue({}),
}));

// Mock S3 and presigner (imported by the module)
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://mock-presigned-url.s3.amazonaws.com'),
}));

import { updateCertification } from '../certification.js';

// Immutable fields that should NEVER appear in an UpdateExpression
const IMMUTABLE_FIELDS = [
  'certification_id',
  'worker_id',
  'tenant_id',
  'certification_type',
  'issuer',
  'issue_date',
  'expiry_date',
  'document_key',
  'created_at',
  'PK',
  'SK',
  'GSI1PK',
  'GSI1SK',
];

// Allowed mutable fields that CAN appear in the UpdateExpression
const MUTABLE_FIELDS = [
  'validation_status',
  'rejection_reason',
  'validated_by',
  'validated_at',
  'updated_at',
];

describe('Certification Update Module', () => {
  const tenantId = 'tenant-test';
  const workerId = 'worker-1';
  const certificationId = 'cert-1';

  const existingCertification = {
    certification_id: certificationId,
    worker_id: workerId,
    tenant_id: tenantId,
    certification_type: 'safety_induction',
    issuer: 'Safety Board',
    issue_date: '2024-01-01T00:00:00.000Z',
    expiry_date: '2025-01-01T00:00:00.000Z',
    document_key: 'certifications/tenant-test/worker-1/cert-1/doc.pdf',
    validation_status: CertificationStatus.PENDING,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    resetDynamoMock();

    // Setup the mock to return the existing certification on GetCommand
    const getKey = JSON.stringify({
      PK: `TENANT#${tenantId}#WORKER#${workerId}`,
      SK: `CERT#${certificationId}`,
    });
    const getResponses = new Map([[getKey, existingCertification]]);

    setupDynamoMock({
      getResponses,
      updateCapture: [],
    });
  });

  it('writes only validation_status and updated_at when status is provided', async () => {
    await updateCertification(tenantId, workerId, certificationId, {
      validation_status: CertificationStatus.VALIDATED,
    });

    const calls = getDynamoCalls();
    const updateCall = calls.find((c) => c.command === 'UpdateCommand');
    expect(updateCall).toBeDefined();

    const input = updateCall!.input as Record<string, unknown>;
    const updateExpression = input.UpdateExpression as string;

    // Should contain validation_status and updated_at
    expect(updateExpression).toContain('validation_status');
    expect(updateExpression).toContain('updated_at');

    // Should NOT contain any immutable fields
    for (const field of IMMUTABLE_FIELDS) {
      expect(updateExpression).not.toContain(field);
    }
  });

  it('writes only rejection_reason and updated_at when rejection_reason is provided', async () => {
    await updateCertification(tenantId, workerId, certificationId, {
      rejection_reason: 'Document expired',
    });

    const calls = getDynamoCalls();
    const updateCall = calls.find((c) => c.command === 'UpdateCommand');
    expect(updateCall).toBeDefined();

    const input = updateCall!.input as Record<string, unknown>;
    const updateExpression = input.UpdateExpression as string;

    // Should contain rejection_reason and updated_at
    expect(updateExpression).toContain('rejection_reason');
    expect(updateExpression).toContain('updated_at');

    // Should NOT contain validation_status (it wasn't provided)
    expect(updateExpression).not.toContain('validation_status');

    // Should NOT contain any immutable fields
    for (const field of IMMUTABLE_FIELDS) {
      expect(updateExpression).not.toContain(field);
    }
  });

  it('writes validated_by and validated_at together with updated_at', async () => {
    await updateCertification(tenantId, workerId, certificationId, {
      validation_status: CertificationStatus.VALIDATED,
      validated_by: 'admin-user-1',
    });

    const calls = getDynamoCalls();
    const updateCall = calls.find((c) => c.command === 'UpdateCommand');
    expect(updateCall).toBeDefined();

    const input = updateCall!.input as Record<string, unknown>;
    const updateExpression = input.UpdateExpression as string;

    // Should contain all provided mutable fields
    expect(updateExpression).toContain('validation_status');
    expect(updateExpression).toContain('validated_by');
    expect(updateExpression).toContain('validated_at');
    expect(updateExpression).toContain('updated_at');

    // Should NOT contain any immutable fields
    for (const field of IMMUTABLE_FIELDS) {
      expect(updateExpression).not.toContain(field);
    }
  });

  it('only includes fields from the UpdateExpression that are in the mutable set', async () => {
    await updateCertification(tenantId, workerId, certificationId, {
      validation_status: CertificationStatus.VALIDATED,
      rejection_reason: 'n/a',
      validated_by: 'admin-user-1',
    });

    const calls = getDynamoCalls();
    const updateCall = calls.find((c) => c.command === 'UpdateCommand');
    expect(updateCall).toBeDefined();

    const input = updateCall!.input as Record<string, unknown>;
    const expressionAttributeNames = input.ExpressionAttributeNames as Record<string, string>;

    // Every field referenced in ExpressionAttributeNames must be a mutable field
    const referencedFields = Object.values(expressionAttributeNames);
    for (const field of referencedFields) {
      expect(MUTABLE_FIELDS).toContain(field);
    }
  });

  it('does not write immutable fields in ExpressionAttributeValues', async () => {
    await updateCertification(tenantId, workerId, certificationId, {
      validation_status: CertificationStatus.VALIDATED,
    });

    const calls = getDynamoCalls();
    const updateCall = calls.find((c) => c.command === 'UpdateCommand');
    expect(updateCall).toBeDefined();

    const input = updateCall!.input as Record<string, unknown>;
    const expressionAttributeValues = input.ExpressionAttributeValues as Record<string, unknown>;

    // Values should not contain immutable data from the original record
    const valueKeys = Object.keys(expressionAttributeValues);
    for (const key of valueKeys) {
      // Each key is like :validation_status, :updated_at, etc.
      const fieldName = key.replace(':', '');
      expect(IMMUTABLE_FIELDS).not.toContain(fieldName);
    }
  });

  it('returns null without issuing UpdateCommand when certification does not exist', async () => {
    // Reset and setup without the certification in getResponses
    resetDynamoMock();
    setupDynamoMock({ getResponses: new Map() });

    const result = await updateCertification(tenantId, workerId, certificationId, {
      validation_status: CertificationStatus.VALIDATED,
    });

    expect(result).toBeNull();

    const calls = getDynamoCalls();
    const updateCalls = calls.filter((c) => c.command === 'UpdateCommand');
    expect(updateCalls).toHaveLength(0);
  });

  it('uses correct Key in the UpdateCommand (PK and SK only)', async () => {
    await updateCertification(tenantId, workerId, certificationId, {
      validation_status: CertificationStatus.VALIDATED,
    });

    const calls = getDynamoCalls();
    const updateCall = calls.find((c) => c.command === 'UpdateCommand');
    expect(updateCall).toBeDefined();

    const input = updateCall!.input as Record<string, unknown>;
    expect(input.Key).toEqual({
      PK: `TENANT#${tenantId}#WORKER#${workerId}`,
      SK: `CERT#${certificationId}`,
    });
  });
});
