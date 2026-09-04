/**
 * Unit tests for the Certification Expiry Checker scheduled Lambda.
 * Tests the pure logic functions and mocks DynamoDB/SNS for handler tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CertificationStatus } from '../../src/shared/types/common.js';
import { EventTypes } from '../../src/shared/types/events.js';

// Mock the DynamoDB document client
const mockSend = vi.fn();
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'Query' })),
  UpdateCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'Update' })),
  ScanCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'Scan' })),
}));

vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  getTableName: (name: string) => `dev-${name}`,
}));

// Mock the logger
vi.mock('../../src/shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the event publisher
const mockPublishEvent = vi.fn().mockResolvedValue({
  event_id: 'mock-event-id',
  event_type: 'CertificationExpired',
  source_service: 'cert-expiry-checker',
  tenant_id: 'tenant-1',
  timestamp: '2024-01-01T00:00:00.000Z',
  payload: {},
  correlation_id: 'mock-correlation-id',
  version: '1.0',
});

vi.mock('../../src/shared/event-publisher.js', () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

import {
  getTodayDateString,
  queryExpiredCertifications,
  markCertificationExpired,
  publishCertificationExpiredEvent,
  processExpiredCertification,
  getAllTenantIds,
  handler,
} from '../../src/scheduled/cert-expiry-checker.js';

describe('cert-expiry-checker: getTodayDateString', () => {
  it('returns date in YYYY-MM-DD format', () => {
    const result = getTodayDateString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the current UTC date', () => {
    const now = new Date();
    const expected = now.toISOString().split('T')[0];
    expect(getTodayDateString()).toBe(expected);
  });
});

describe('cert-expiry-checker: queryExpiredCertifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries GSI1 with tenant ID and expiry date threshold', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await queryExpiredCertifications('tenant-1', '2024-06-15');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.TableName).toBe('dev-Certifications');
    expect(callArg.IndexName).toBe('GSI1');
    expect(callArg.ExpressionAttributeValues[':tenantId']).toBe('tenant-1');
    expect(callArg.ExpressionAttributeValues[':expiryDate']).toBe('2024-06-15');
    expect(callArg.ExpressionAttributeValues[':expiredStatus']).toBe(CertificationStatus.EXPIRED);
  });

  it('returns certifications that are not already expired', async () => {
    const mockCerts = [
      {
        PK: 'WORKER#worker-1',
        SK: 'CERT#cert-1',
        GSI1PK: 'tenant-1',
        GSI1SK: '2024-06-10',
        certification_id: 'cert-1',
        worker_id: 'worker-1',
        tenant_id: 'tenant-1',
        certification_type: 'whmis_2015',
        expiry_date: '2024-06-10',
        validation_status: 'validated',
      },
    ];
    mockSend.mockResolvedValueOnce({ Items: mockCerts, LastEvaluatedKey: undefined });

    const result = await queryExpiredCertifications('tenant-1', '2024-06-15');
    expect(result).toHaveLength(1);
    expect(result[0].certification_id).toBe('cert-1');
  });

  it('paginates through multiple pages of results', async () => {
    const page1Certs = [
      {
        PK: 'WORKER#worker-1',
        SK: 'CERT#cert-1',
        GSI1PK: 'tenant-1',
        GSI1SK: '2024-06-01',
        certification_id: 'cert-1',
        worker_id: 'worker-1',
        tenant_id: 'tenant-1',
        certification_type: 'whmis_2015',
        expiry_date: '2024-06-01',
        validation_status: 'validated',
      },
    ];
    const page2Certs = [
      {
        PK: 'WORKER#worker-2',
        SK: 'CERT#cert-2',
        GSI1PK: 'tenant-1',
        GSI1SK: '2024-06-05',
        certification_id: 'cert-2',
        worker_id: 'worker-2',
        tenant_id: 'tenant-1',
        certification_type: 'fall_protection',
        expiry_date: '2024-06-05',
        validation_status: 'pending',
      },
    ];

    mockSend
      .mockResolvedValueOnce({ Items: page1Certs, LastEvaluatedKey: { PK: 'next' } })
      .mockResolvedValueOnce({ Items: page2Certs, LastEvaluatedKey: undefined });

    const result = await queryExpiredCertifications('tenant-1', '2024-06-15');
    expect(result).toHaveLength(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when no expired certifications found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await queryExpiredCertifications('tenant-1', '2024-06-15');
    expect(result).toHaveLength(0);
  });
});

describe('cert-expiry-checker: markCertificationExpired', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends UpdateCommand with correct key and condition', async () => {
    mockSend.mockResolvedValueOnce({});

    const cert = {
      PK: 'WORKER#worker-1',
      SK: 'CERT#cert-1',
      GSI1PK: 'tenant-1',
      GSI1SK: '2024-06-10',
      certification_id: 'cert-1',
      worker_id: 'worker-1',
      tenant_id: 'tenant-1',
      certification_type: 'whmis_2015',
      expiry_date: '2024-06-10',
      validation_status: 'validated',
    };

    await markCertificationExpired(cert);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.TableName).toBe('dev-Certifications');
    expect(callArg.Key).toEqual({ PK: 'WORKER#worker-1', SK: 'CERT#cert-1' });
    expect(callArg.ExpressionAttributeValues[':expired']).toBe(CertificationStatus.EXPIRED);
    // Condition expression prevents double-processing
    expect(callArg.ConditionExpression).toBe('#status <> :expired');
  });
});

describe('cert-expiry-checker: publishCertificationExpiredEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes CertificationExpired event with correct payload', async () => {
    const cert = {
      PK: 'WORKER#worker-1',
      SK: 'CERT#cert-1',
      GSI1PK: 'tenant-1',
      GSI1SK: '2024-06-10',
      certification_id: 'cert-1',
      worker_id: 'worker-1',
      tenant_id: 'tenant-1',
      certification_type: 'fall_protection',
      expiry_date: '2024-06-10',
      validation_status: 'validated',
    };

    await publishCertificationExpiredEvent(cert);

    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).toHaveBeenCalledWith({
      event_type: EventTypes.CERTIFICATION_EXPIRED,
      source_service: 'cert-expiry-checker',
      tenant_id: 'tenant-1',
      payload: {
        certification_id: 'cert-1',
        worker_id: 'worker-1',
        tenant_id: 'tenant-1',
        certification_type: 'fall_protection',
        expiry_date: '2024-06-10',
      },
    });
  });
});

describe('cert-expiry-checker: processExpiredCertification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when certification is successfully processed', async () => {
    mockSend.mockResolvedValueOnce({}); // UpdateCommand succeeds

    const cert = {
      PK: 'WORKER#worker-1',
      SK: 'CERT#cert-1',
      GSI1PK: 'tenant-1',
      GSI1SK: '2024-06-10',
      certification_id: 'cert-1',
      worker_id: 'worker-1',
      tenant_id: 'tenant-1',
      certification_type: 'whmis_2015',
      expiry_date: '2024-06-10',
      validation_status: 'validated',
    };

    const result = await processExpiredCertification(cert);
    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
  });

  it('returns false when ConditionalCheckFailedException occurs (already expired)', async () => {
    const error = new Error('The conditional request failed');
    error.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(error);

    const cert = {
      PK: 'WORKER#worker-1',
      SK: 'CERT#cert-1',
      GSI1PK: 'tenant-1',
      GSI1SK: '2024-06-10',
      certification_id: 'cert-1',
      worker_id: 'worker-1',
      tenant_id: 'tenant-1',
      certification_type: 'whmis_2015',
      expiry_date: '2024-06-10',
      validation_status: 'validated',
    };

    const result = await processExpiredCertification(cert);
    expect(result).toBe(false);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('throws on unexpected errors', async () => {
    const error = new Error('Internal server error');
    error.name = 'InternalServerError';
    mockSend.mockRejectedValueOnce(error);

    const cert = {
      PK: 'WORKER#worker-1',
      SK: 'CERT#cert-1',
      GSI1PK: 'tenant-1',
      GSI1SK: '2024-06-10',
      certification_id: 'cert-1',
      worker_id: 'worker-1',
      tenant_id: 'tenant-1',
      certification_type: 'whmis_2015',
      expiry_date: '2024-06-10',
      validation_status: 'validated',
    };

    await expect(processExpiredCertification(cert)).rejects.toThrow('Internal server error');
  });
});

describe('cert-expiry-checker: getAllTenantIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts tenant IDs from PK format', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { PK: 'TENANT#tenant-1' },
        { PK: 'TENANT#tenant-2' },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await getAllTenantIds();
    expect(result).toEqual(['tenant-1', 'tenant-2']);
  });

  it('paginates through multiple pages', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ PK: 'TENANT#tenant-1' }],
        LastEvaluatedKey: { PK: 'next' },
      })
      .mockResolvedValueOnce({
        Items: [{ PK: 'TENANT#tenant-2' }],
        LastEvaluatedKey: undefined,
      });

    const result = await getAllTenantIds();
    expect(result).toEqual(['tenant-1', 'tenant-2']);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when no tenants exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await getAllTenantIds();
    expect(result).toEqual([]);
  });
});

describe('cert-expiry-checker: handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['ENVIRONMENT'] = 'dev';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-west-2:123456789:test-topic';
  });

  afterEach(() => {
    delete process.env['ENVIRONMENT'];
    delete process.env['SNS_TOPIC_ARN'];
  });

  it('returns 200 with summary when no certifications need expiring', async () => {
    // getAllTenantIds scan
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'TENANT#tenant-1' }],
      LastEvaluatedKey: undefined,
    });
    // queryExpiredCertifications for tenant-1
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await handler();
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.total_processed).toBe(0);
    expect(body.total_skipped).toBe(0);
    expect(body.total_errors).toBe(0);
    expect(body.tenants_scanned).toBe(1);
  });

  it('processes expired certifications across multiple tenants', async () => {
    // getAllTenantIds scan
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'TENANT#tenant-1' }, { PK: 'TENANT#tenant-2' }],
      LastEvaluatedKey: undefined,
    });
    // queryExpiredCertifications for tenant-1
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'WORKER#worker-1',
          SK: 'CERT#cert-1',
          GSI1PK: 'tenant-1',
          GSI1SK: '2024-06-10',
          certification_id: 'cert-1',
          worker_id: 'worker-1',
          tenant_id: 'tenant-1',
          certification_type: 'whmis_2015',
          expiry_date: '2024-06-10',
          validation_status: 'validated',
        },
      ],
      LastEvaluatedKey: undefined,
    });
    // markCertificationExpired for cert-1
    mockSend.mockResolvedValueOnce({});
    // queryExpiredCertifications for tenant-2
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await handler();
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.total_processed).toBe(1);
    expect(body.tenants_scanned).toBe(2);
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
  });

  it('continues processing other certs when one fails', async () => {
    // getAllTenantIds scan
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'TENANT#tenant-1' }],
      LastEvaluatedKey: undefined,
    });
    // queryExpiredCertifications for tenant-1 returns 2 certs
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'WORKER#worker-1',
          SK: 'CERT#cert-1',
          GSI1PK: 'tenant-1',
          GSI1SK: '2024-06-10',
          certification_id: 'cert-1',
          worker_id: 'worker-1',
          tenant_id: 'tenant-1',
          certification_type: 'whmis_2015',
          expiry_date: '2024-06-10',
          validation_status: 'validated',
        },
        {
          PK: 'WORKER#worker-2',
          SK: 'CERT#cert-2',
          GSI1PK: 'tenant-1',
          GSI1SK: '2024-06-12',
          certification_id: 'cert-2',
          worker_id: 'worker-2',
          tenant_id: 'tenant-1',
          certification_type: 'fall_protection',
          expiry_date: '2024-06-12',
          validation_status: 'validated',
        },
      ],
      LastEvaluatedKey: undefined,
    });
    // First cert update fails with unexpected error
    const error = new Error('Throttled');
    error.name = 'ProvisionedThroughputExceededException';
    mockSend.mockRejectedValueOnce(error);
    // Second cert update succeeds
    mockSend.mockResolvedValueOnce({});

    const result = await handler();
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.total_processed).toBe(1);
    expect(body.total_errors).toBe(1);
  });

  it('returns 500 when getAllTenantIds fails fatally', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const result = await handler();
    expect(result.statusCode).toBe(500);

    const body = JSON.parse(result.body);
    expect(body.error).toBe('Certification expiry check failed');
  });
});
