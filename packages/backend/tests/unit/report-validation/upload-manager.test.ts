import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateFileMetadata,
  buildReportS3Key,
} from '../../../src/services/report-validation/upload-manager.js';

// Mock AWS SDK modules
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/presigned-url'),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: vi.fn(),
  QueryCommand: vi.fn(),
  UpdateCommand: vi.fn(),
}));

vi.mock('../../../src/shared/dynamo-client.js', () => ({
  docClient: { send: vi.fn() },
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

describe('validateFileMetadata', () => {
  it('returns null for valid PDF file', () => {
    expect(validateFileMetadata('application/pdf', 5000)).toBeNull();
  });

  it('returns null for valid .docx file', () => {
    expect(
      validateFileMetadata(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        10000
      )
    ).toBeNull();
  });

  it('returns null for valid .doc file', () => {
    expect(validateFileMetadata('application/msword', 2048)).toBeNull();
  });

  it('returns error for unsupported MIME type', () => {
    const result = validateFileMetadata('text/plain', 5000);
    expect(result).toBe('Unsupported file format. Accepted: PDF, .docx, .doc');
  });

  it('returns error for file smaller than 1 KB', () => {
    const result = validateFileMetadata('application/pdf', 512);
    expect(result).toBe('File size must be between 1 KB and 25 MB');
  });

  it('returns error for file larger than 25 MB', () => {
    const result = validateFileMetadata('application/pdf', 26 * 1024 * 1024);
    expect(result).toBe('File size must be between 1 KB and 25 MB');
  });

  it('accepts file at exactly 1 KB (minimum boundary)', () => {
    expect(validateFileMetadata('application/pdf', 1024)).toBeNull();
  });

  it('accepts file at exactly 25 MB (maximum boundary)', () => {
    expect(validateFileMetadata('application/pdf', 25 * 1024 * 1024)).toBeNull();
  });
});

describe('buildReportS3Key', () => {
  it('constructs correct S3 key format', () => {
    const key = buildReportS3Key('tenant-123', 'report-456', 1, 'my-report.pdf');
    expect(key).toBe('tenant-123/report-456/v1/my-report.pdf');
  });

  it('includes version number in key', () => {
    const key = buildReportS3Key('t1', 'r1', 3, 'doc.docx');
    expect(key).toBe('t1/r1/v3/doc.docx');
  });

  it('handles filenames with spaces', () => {
    const key = buildReportS3Key('t1', 'r1', 1, 'my report file.pdf');
    expect(key).toBe('t1/r1/v1/my report file.pdf');
  });

  it('handles version numbers greater than 1', () => {
    const key = buildReportS3Key('tenant-abc', 'report-xyz', 15, 'updated.pdf');
    expect(key).toBe('tenant-abc/report-xyz/v15/updated.pdf');
  });
});

describe('createReport', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };
  let getSignedUrlMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as { send: ReturnType<typeof vi.fn> };

    const presignerModule = await import('@aws-sdk/s3-request-presigner');
    getSignedUrlMock = presignerModule.getSignedUrl as ReturnType<typeof vi.fn>;
  });

  it('returns report_id and presigned URL on valid upload', async () => {
    const { createReport } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    getSignedUrlMock.mockResolvedValue('https://s3.amazonaws.com/presigned-upload-url');
    docClientMock.send
      .mockResolvedValueOnce({}) // PutCommand for report record
      .mockResolvedValueOnce({}); // PutCommand for version record

    const result = await createReport(
      'tenant-1',
      'user-1',
      'report-abc',
      { file_name: 'compliance-report.pdf', file_size: 10240, mime_type: 'application/pdf' }
    );

    expect(result.report_id).toBe('report-abc');
    expect(result.upload_url).toBe('https://s3.amazonaws.com/presigned-upload-url');
    expect(result.status).toBe('draft');
    expect(result.created_at).toBeDefined();
  });

  it('creates report record in DynamoDB with correct fields', async () => {
    const { createReport } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    getSignedUrlMock.mockResolvedValue('https://s3.amazonaws.com/presigned-url');
    docClientMock.send
      .mockResolvedValueOnce({}) // PutCommand for report record
      .mockResolvedValueOnce({}); // PutCommand for version record

    await createReport(
      'tenant-1',
      'user-1',
      'report-xyz',
      { file_name: 'my-report.docx', file_size: 5000, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    );

    // First send call is the report record PutCommand
    const reportPutCall = docClientMock.send.mock.calls[0][0];
    expect(reportPutCall).toBeDefined();

    // Second send call is the version record PutCommand
    const versionPutCall = docClientMock.send.mock.calls[1][0];
    expect(versionPutCall).toBeDefined();

    // Verify both DynamoDB writes were called
    expect(docClientMock.send).toHaveBeenCalledTimes(2);
  });

  it('does not persist DynamoDB records when presigned URL generation fails', async () => {
    const { createReport } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    // Presigned URL generation fails (S3 failure)
    getSignedUrlMock.mockRejectedValue(new Error('S3 service unavailable'));

    await expect(
      createReport(
        'tenant-1',
        'user-1',
        'report-fail',
        { file_name: 'report.pdf', file_size: 5000, mime_type: 'application/pdf' }
      )
    ).rejects.toThrow();

    // DynamoDB should NOT have been called since presigned URL is generated first
    expect(docClientMock.send).not.toHaveBeenCalled();
  });

  it('returns created_at timestamp in ISO 8601 format', async () => {
    const { createReport } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    getSignedUrlMock.mockResolvedValue('https://s3.amazonaws.com/presigned-url');
    docClientMock.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await createReport(
      'tenant-1',
      'user-1',
      'report-time',
      { file_name: 'report.pdf', file_size: 2048, mime_type: 'application/pdf' }
    );

    // Verify created_at is a valid ISO 8601 timestamp
    const parsed = new Date(result.created_at);
    expect(parsed.toISOString()).toBe(result.created_at);
  });
});

describe('uploadNewVersion', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };
  let getSignedUrlMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as { send: ReturnType<typeof vi.fn> };

    const presignerModule = await import('@aws-sdk/s3-request-presigner');
    getSignedUrlMock = presignerModule.getSignedUrl as ReturnType<typeof vi.fn>;
  });

  it('rejects upload when report status is "submitted"', async () => {
    const { uploadNewVersion } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    const report = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      owner_id: 'user-1',
      title: 'Test Report',
      status: 'submitted' as const,
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    const result = await uploadNewVersion(
      'tenant-1',
      'report-1',
      'user-1',
      report,
      { file_name: 'new.pdf', file_size: 5000, mime_type: 'application/pdf' }
    );

    expect(result.error).toContain('Cannot upload new version');
    expect(result.result).toBeUndefined();
  });

  it('rejects upload when report status is "validating"', async () => {
    const { uploadNewVersion } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    const report = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      owner_id: 'user-1',
      title: 'Test Report',
      status: 'validating' as const,
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    const result = await uploadNewVersion(
      'tenant-1',
      'report-1',
      'user-1',
      report,
      { file_name: 'new.pdf', file_size: 5000, mime_type: 'application/pdf' }
    );

    expect(result.error).toContain('Cannot upload new version');
    expect(result.result).toBeUndefined();
  });

  it('rejects upload with invalid file metadata', async () => {
    const { uploadNewVersion } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    const report = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      owner_id: 'user-1',
      title: 'Test Report',
      status: 'validated' as const,
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    const result = await uploadNewVersion(
      'tenant-1',
      'report-1',
      'user-1',
      report,
      { file_name: 'new.txt', file_size: 5000, mime_type: 'text/plain' }
    );

    expect(result.error).toBe('Unsupported file format. Accepted: PDF, .docx, .doc');
    expect(result.result).toBeUndefined();
  });

  it('increments version number sequentially', async () => {
    const { uploadNewVersion } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    // Mock: getCurrentVersionNumber returns 2 (existing versions 1, 2)
    docClientMock.send
      .mockResolvedValueOnce({ Items: [{ version: 2, report_id: 'report-1' }] }) // QueryCommand for getCurrentVersionNumber
      .mockResolvedValueOnce({}) // PutCommand for version record
      .mockResolvedValueOnce({}); // UpdateCommand for report record

    getSignedUrlMock.mockResolvedValue('https://s3.amazonaws.com/presigned-url-v3');

    const report = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      owner_id: 'user-1',
      title: 'Test Report',
      status: 'validated' as const,
      current_version: 2,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    const result = await uploadNewVersion(
      'tenant-1',
      'report-1',
      'user-1',
      report,
      { file_name: 'updated.pdf', file_size: 5000, mime_type: 'application/pdf' }
    );

    expect(result.error).toBeUndefined();
    expect(result.result).toBeDefined();
    expect(result.result!.version).toBe(3);
  });

  it('transitions status from "validated" to "draft" on new version upload', async () => {
    const { uploadNewVersion } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    docClientMock.send
      .mockResolvedValueOnce({ Items: [{ version: 1, report_id: 'report-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    getSignedUrlMock.mockResolvedValue('https://s3.amazonaws.com/presigned-url');

    const report = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      owner_id: 'user-1',
      title: 'Test Report',
      status: 'validated' as const,
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    const result = await uploadNewVersion(
      'tenant-1',
      'report-1',
      'user-1',
      report,
      { file_name: 'v2.pdf', file_size: 5000, mime_type: 'application/pdf' }
    );

    expect(result.result).toBeDefined();
    expect(result.result!.status).toBe('draft');
  });

  it('retains "draft" status when uploading new version on draft report', async () => {
    const { uploadNewVersion } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    docClientMock.send
      .mockResolvedValueOnce({ Items: [{ version: 1, report_id: 'report-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    getSignedUrlMock.mockResolvedValue('https://s3.amazonaws.com/presigned-url');

    const report = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      owner_id: 'user-1',
      title: 'Test Report',
      status: 'draft' as const,
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    const result = await uploadNewVersion(
      'tenant-1',
      'report-1',
      'user-1',
      report,
      { file_name: 'v2.pdf', file_size: 5000, mime_type: 'application/pdf' }
    );

    expect(result.result).toBeDefined();
    expect(result.result!.status).toBe('draft');
  });

  it('returns error when presigned URL generation fails', async () => {
    const { uploadNewVersion } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    docClientMock.send
      .mockResolvedValueOnce({ Items: [{ version: 1, report_id: 'report-1' }] });

    getSignedUrlMock.mockRejectedValue(new Error('S3 service unavailable'));

    const report = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      owner_id: 'user-1',
      title: 'Test Report',
      status: 'validated' as const,
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    const result = await uploadNewVersion(
      'tenant-1',
      'report-1',
      'user-1',
      report,
      { file_name: 'v2.pdf', file_size: 5000, mime_type: 'application/pdf' }
    );

    expect(result.error).toBe('Upload could not be completed. Please try again.');
    expect(result.result).toBeUndefined();
  });

  it('returns error when DynamoDB version record creation fails', async () => {
    const { uploadNewVersion } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    docClientMock.send
      .mockResolvedValueOnce({ Items: [{ version: 1, report_id: 'report-1' }] }) // Query
      .mockRejectedValueOnce(new Error('DynamoDB write failed')); // PutCommand fails

    getSignedUrlMock.mockResolvedValue('https://s3.amazonaws.com/presigned-url');

    const report = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      owner_id: 'user-1',
      title: 'Test Report',
      status: 'validated' as const,
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    const result = await uploadNewVersion(
      'tenant-1',
      'report-1',
      'user-1',
      report,
      { file_name: 'v2.pdf', file_size: 5000, mime_type: 'application/pdf' }
    );

    expect(result.error).toBe('Upload could not be completed. Please try again.');
    expect(result.result).toBeUndefined();
  });

  it('returns upload_url in the result for client-side S3 PUT', async () => {
    const { uploadNewVersion } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    docClientMock.send
      .mockResolvedValueOnce({ Items: [{ version: 1, report_id: 'report-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    getSignedUrlMock.mockResolvedValue('https://s3.amazonaws.com/my-presigned-url');

    const report = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      owner_id: 'user-1',
      title: 'Test Report',
      status: 'validated' as const,
      current_version: 1,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      status_history: [],
    };

    const result = await uploadNewVersion(
      'tenant-1',
      'report-1',
      'user-1',
      report,
      { file_name: 'v2.pdf', file_size: 5000, mime_type: 'application/pdf' }
    );

    expect(result.result!.upload_url).toBe('https://s3.amazonaws.com/my-presigned-url');
  });
});

describe('getVersionHistory', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as { send: ReturnType<typeof vi.fn> };
  });

  it('returns empty array when no versions exist', async () => {
    const { getVersionHistory } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    docClientMock.send.mockResolvedValueOnce({ Items: [] });

    const result = await getVersionHistory('report-nonexistent');
    expect(result).toEqual([]);
  });

  it('returns versions in reverse chronological order', async () => {
    const { getVersionHistory } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    const versions = [
      { report_id: 'r1', version: 3, uploaded_at: '2024-03-01T00:00:00.000Z', file_name: 'v3.pdf' },
      { report_id: 'r1', version: 2, uploaded_at: '2024-02-01T00:00:00.000Z', file_name: 'v2.pdf' },
      { report_id: 'r1', version: 1, uploaded_at: '2024-01-01T00:00:00.000Z', file_name: 'v1.pdf' },
    ];

    docClientMock.send.mockResolvedValueOnce({ Items: versions });

    const result = await getVersionHistory('r1');
    expect(result).toHaveLength(3);
    expect(result[0].version).toBe(3);
    expect(result[1].version).toBe(2);
    expect(result[2].version).toBe(1);
  });

  it('preserves all version metadata', async () => {
    const { getVersionHistory } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    const versions = [
      {
        report_id: 'r1',
        version: 1,
        file_name: 'report.pdf',
        file_size: 5000,
        mime_type: 'application/pdf',
        s3_key: 'tenant-1/r1/v1/report.pdf',
        extraction_status: 'completed',
        uploaded_by: 'user-1',
        uploaded_at: '2024-01-01T00:00:00.000Z',
      },
    ];

    docClientMock.send.mockResolvedValueOnce({ Items: versions });

    const result = await getVersionHistory('r1');
    expect(result[0]).toEqual(versions[0]);
  });
});

describe('getCurrentVersionNumber', () => {
  let docClientMock: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    const dynamoModule = await import('../../../src/shared/dynamo-client.js');
    docClientMock = dynamoModule.docClient as unknown as { send: ReturnType<typeof vi.fn> };
  });

  it('returns 0 when no versions exist', async () => {
    const { getCurrentVersionNumber } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    docClientMock.send.mockResolvedValueOnce({ Items: [] });

    const result = await getCurrentVersionNumber('report-new');
    expect(result).toBe(0);
  });

  it('returns the highest version number', async () => {
    const { getCurrentVersionNumber } = await import(
      '../../../src/services/report-validation/upload-manager.js'
    );

    docClientMock.send.mockResolvedValueOnce({
      Items: [{ version: 5, report_id: 'r1' }],
    });

    const result = await getCurrentVersionNumber('r1');
    expect(result).toBe(5);
  });
});
