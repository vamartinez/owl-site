/**
 * Unit tests for POST /public/forms/{token}/upload-url (task 5.7)
 *
 * Tests the form-upload module which:
 * - Validates file type (PDF, JPEG, PNG) and size (max 10 MB)
 * - Generates S3 presigned URL with 15-minute expiration
 * - Returns upload_url, fields, and file_key
 * - S3 key structure: forms/{tenant_id}/{form_id}/responses/{response_id}/{field_id}/{filename}
 *
 * Requirements: 11.5, 15.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock S3 client and presigner
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({})),
  PutObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/bucket/presigned-url'),
}));

vi.mock('../../src/shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  validateFileUpload,
  validateUploadInput,
  generateS3Key,
  generateFormUploadUrl,
} from '../../src/services/forms/form-upload.js';

const mockGetSignedUrl = getSignedUrl as ReturnType<typeof vi.fn>;

describe('form-upload: validateFileUpload', () => {
  it('accepts application/pdf content type', () => {
    expect(validateFileUpload('application/pdf', 1024)).toBeNull();
  });

  it('accepts image/jpeg content type', () => {
    expect(validateFileUpload('image/jpeg', 5 * 1024 * 1024)).toBeNull();
  });

  it('accepts image/png content type', () => {
    expect(validateFileUpload('image/png', 2 * 1024 * 1024)).toBeNull();
  });

  it('rejects unsupported content types', () => {
    const error = validateFileUpload('application/zip', 1024);
    expect(error).not.toBeNull();
    expect(error).toContain('Tipo de archivo no permitido');
  });

  it('rejects image/gif content type', () => {
    const error = validateFileUpload('image/gif', 1024);
    expect(error).not.toBeNull();
    expect(error).toContain('Tipo de archivo no permitido');
  });

  it('rejects files exceeding 10 MB', () => {
    const overLimit = 10 * 1024 * 1024 + 1;
    const error = validateFileUpload('application/pdf', overLimit);
    expect(error).not.toBeNull();
    expect(error).toContain('10 MB');
  });

  it('accepts files exactly at 10 MB', () => {
    const exactLimit = 10 * 1024 * 1024;
    expect(validateFileUpload('application/pdf', exactLimit)).toBeNull();
  });

  it('rejects files with size 0 or negative', () => {
    const error = validateFileUpload('application/pdf', 0);
    expect(error).not.toBeNull();
    expect(error).toContain('mayor a 0');
  });

  it('rejects files with negative size', () => {
    const error = validateFileUpload('image/jpeg', -100);
    expect(error).not.toBeNull();
    expect(error).toContain('mayor a 0');
  });
});

describe('form-upload: validateUploadInput', () => {
  it('returns null for valid input', () => {
    expect(validateUploadInput({
      filename: 'document.pdf',
      content_type: 'application/pdf',
      size: 1024,
    })).toBeNull();
  });

  it('rejects missing filename', () => {
    const error = validateUploadInput({
      content_type: 'application/pdf',
      size: 1024,
    });
    expect(error).toContain('nombre del archivo');
  });

  it('rejects empty filename', () => {
    const error = validateUploadInput({
      filename: '   ',
      content_type: 'application/pdf',
      size: 1024,
    });
    expect(error).toContain('nombre del archivo');
  });

  it('rejects missing content_type', () => {
    const error = validateUploadInput({
      filename: 'doc.pdf',
      size: 1024,
    });
    expect(error).toContain('tipo de contenido');
  });

  it('rejects missing size', () => {
    const error = validateUploadInput({
      filename: 'doc.pdf',
      content_type: 'application/pdf',
    });
    expect(error).toContain('tamaño del archivo');
  });
});

describe('form-upload: generateS3Key', () => {
  it('generates correct S3 key structure', () => {
    const key = generateS3Key('tenant-1', 'form-abc', 'resp-123', 'field-xyz', 'document.pdf');
    expect(key).toBe('forms/tenant-1/form-abc/responses/resp-123/field-xyz/document.pdf');
  });

  it('sanitizes path separators in filename', () => {
    const key = generateS3Key('t1', 'f1', 'r1', 'fld1', '../../../etc/passwd');
    // Path separators are replaced with underscores, dots remain (safe in S3 flat keys)
    expect(key).not.toContain('/../../');
    expect(key).toBe('forms/t1/f1/responses/r1/fld1/.._.._.._etc_passwd');
  });

  it('sanitizes backslashes in filename', () => {
    const key = generateS3Key('t1', 'f1', 'r1', 'fld1', 'path\\file.pdf');
    expect(key).toBe('forms/t1/f1/responses/r1/fld1/path_file.pdf');
  });

  it('removes control characters from filename', () => {
    const key = generateS3Key('t1', 'f1', 'r1', 'fld1', 'file\x00name.pdf');
    expect(key).toBe('forms/t1/f1/responses/r1/fld1/filename.pdf');
  });

  it('preserves valid filenames with spaces and special chars', () => {
    const key = generateS3Key('t1', 'f1', 'r1', 'fld1', 'my document (1).pdf');
    expect(key).toBe('forms/t1/f1/responses/r1/fld1/my document (1).pdf');
  });
});

describe('form-upload: generateFormUploadUrl', () => {
  beforeEach(() => {
    mockGetSignedUrl.mockReset();
    mockGetSignedUrl.mockResolvedValue('https://s3.amazonaws.com/bucket/presigned-url');
    process.env['MEDIA_BUCKET_NAME'] = 'test-media-bucket';
  });

  it('returns presigned URL for valid PDF upload', async () => {
    const result = await generateFormUploadUrl(
      'tenant-1',
      'form-abc',
      'resp-123',
      'field-xyz',
      { filename: 'contract.pdf', content_type: 'application/pdf', size: 5 * 1024 * 1024 }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.upload_url).toBe('https://s3.amazonaws.com/bucket/presigned-url');
      expect(result.fields['Content-Type']).toBe('application/pdf');
      expect(result.file_key).toBe('forms/tenant-1/form-abc/responses/resp-123/field-xyz/contract.pdf');
    }
  });

  it('returns presigned URL for valid JPEG upload', async () => {
    const result = await generateFormUploadUrl(
      'tenant-1',
      'form-abc',
      'resp-123',
      'field-xyz',
      { filename: 'photo.jpeg', content_type: 'image/jpeg', size: 2 * 1024 * 1024 }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.fields['Content-Type']).toBe('image/jpeg');
      expect(result.file_key).toContain('photo.jpeg');
    }
  });

  it('returns presigned URL for valid PNG upload', async () => {
    const result = await generateFormUploadUrl(
      'tenant-1',
      'form-abc',
      'resp-123',
      'field-xyz',
      { filename: 'screenshot.png', content_type: 'image/png', size: 1024 }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.fields['Content-Type']).toBe('image/png');
    }
  });

  it('returns INVALID_FILE_TYPE error for unsupported content type', async () => {
    const result = await generateFormUploadUrl(
      'tenant-1',
      'form-abc',
      'resp-123',
      'field-xyz',
      { filename: 'archive.zip', content_type: 'application/zip', size: 1024 }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.code).toBe('INVALID_FILE_TYPE');
      expect(result.message).toContain('Tipo de archivo no permitido');
    }
  });

  it('returns FILE_TOO_LARGE error when size exceeds 10 MB', async () => {
    const result = await generateFormUploadUrl(
      'tenant-1',
      'form-abc',
      'resp-123',
      'field-xyz',
      { filename: 'large.pdf', content_type: 'application/pdf', size: 11 * 1024 * 1024 }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.code).toBe('FILE_TOO_LARGE');
      expect(result.message).toContain('10 MB');
    }
  });

  it('returns VALIDATION_ERROR for missing filename', async () => {
    const result = await generateFormUploadUrl(
      'tenant-1',
      'form-abc',
      'resp-123',
      'field-xyz',
      { filename: '', content_type: 'application/pdf', size: 1024 }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });

  it('calls getSignedUrl with correct parameters', async () => {
    await generateFormUploadUrl(
      'tenant-1',
      'form-abc',
      'resp-123',
      'field-xyz',
      { filename: 'doc.pdf', content_type: 'application/pdf', size: 2048 }
    );

    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    // Verify expiration is 900 seconds (15 minutes)
    const callArgs = mockGetSignedUrl.mock.calls[0];
    expect(callArgs![2]).toEqual({ expiresIn: 900 });
  });

  it('returns INTERNAL_ERROR when S3 presigning fails', async () => {
    mockGetSignedUrl.mockRejectedValueOnce(new Error('S3 service unavailable'));

    const result = await generateFormUploadUrl(
      'tenant-1',
      'form-abc',
      'resp-123',
      'field-xyz',
      { filename: 'doc.pdf', content_type: 'application/pdf', size: 1024 }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(500);
      expect(result.code).toBe('INTERNAL_ERROR');
    }
  });
});
