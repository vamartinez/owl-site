import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TextExtractionInput } from '../../../src/services/report-validation/text-extractor.js';

// Mock AWS SDK modules
const mockS3Send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockS3Send })),
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
}));

const mockBdaSend = vi.fn();
vi.mock('@aws-sdk/client-bedrock-data-automation-runtime', () => ({
  BedrockDataAutomationRuntimeClient: vi.fn().mockImplementation(() => ({ send: mockBdaSend })),
  InvokeDataAutomationAsyncCommand: vi.fn(),
  GetDataAutomationStatusCommand: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: vi.fn(),
}));

const mockDocClientSend = vi.fn();
vi.mock('../../../src/shared/dynamo-client.js', () => ({
  docClient: { send: mockDocClientSend },
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

describe('validateDocumentSize', () => {
  let validateDocumentSize: typeof import('../../../src/services/report-validation/text-extractor.js').validateDocumentSize;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../../src/services/report-validation/text-extractor.js');
    validateDocumentSize = mod.validateDocumentSize;
  });

  it('returns null for valid file size and page count', () => {
    expect(validateDocumentSize(10 * 1024 * 1024, 50)).toBeNull();
  });

  it('returns error when file size exceeds 50 MB', () => {
    const result = validateDocumentSize(51 * 1024 * 1024);
    expect(result).not.toBeNull();
    expect(result!.error_type).toBe('document_too_large');
    expect(result!.message).toContain('50 MB');
  });

  it('returns null for file at exactly 50 MB', () => {
    expect(validateDocumentSize(50 * 1024 * 1024)).toBeNull();
  });

  it('returns error when page count exceeds 200', () => {
    const result = validateDocumentSize(1024, 201);
    expect(result).not.toBeNull();
    expect(result!.error_type).toBe('document_too_large');
    expect(result!.message).toContain('200');
    expect(result!.message).toContain('201');
  });

  it('returns null for exactly 200 pages', () => {
    expect(validateDocumentSize(1024, 200)).toBeNull();
  });

  it('returns null when page count is undefined', () => {
    expect(validateDocumentSize(10 * 1024 * 1024)).toBeNull();
  });

  it('checks file size before page count', () => {
    const result = validateDocumentSize(51 * 1024 * 1024, 201);
    expect(result).not.toBeNull();
    expect(result!.error_type).toBe('document_too_large');
    expect(result!.message).toContain('50 MB');
  });
});

describe('isSupportedMimeType', () => {
  let isSupportedMimeType: typeof import('../../../src/services/report-validation/text-extractor.js').isSupportedMimeType;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../../src/services/report-validation/text-extractor.js');
    isSupportedMimeType = mod.isSupportedMimeType;
  });

  it('returns true for application/pdf', () => {
    expect(isSupportedMimeType('application/pdf')).toBe(true);
  });

  it('returns true for .docx MIME type', () => {
    expect(
      isSupportedMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    ).toBe(true);
  });

  it('returns true for .doc MIME type', () => {
    expect(isSupportedMimeType('application/msword')).toBe(true);
  });

  it('returns false for text/plain', () => {
    expect(isSupportedMimeType('text/plain')).toBe(false);
  });

  it('returns false for image/png', () => {
    expect(isSupportedMimeType('image/png')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSupportedMimeType('')).toBe(false);
  });

  it('returns false for application/json', () => {
    expect(isSupportedMimeType('application/json')).toBe(false);
  });
});


describe('extractText - PDF extraction via BDA', () => {
  let extractText: typeof import('../../../src/services/report-validation/text-extractor.js').extractText;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDocClientSend.mockResolvedValue({});
    const mod = await import('../../../src/services/report-validation/text-extractor.js');
    extractText = mod.extractText;
  });

  it('successfully extracts text from PDF via BDA', async () => {
    const extractedContent = 'This is a sample PDF document with enough text content for validation purposes. It contains multiple paragraphs.';

    // Mock BDA invocation
    mockBdaSend
      .mockResolvedValueOnce({ invocationArn: 'arn:aws:bedrock:us-east-1:123:invocation/abc' })
      .mockResolvedValueOnce({
        status: 'Success',
        outputConfiguration: { s3Uri: 's3://report-documents/bda-output/tenant-1/report-1/v1/doc.pdf' },
      });

    // Mock S3 GetObject for BDA output
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: () => Promise.resolve(JSON.stringify({ content: extractedContent })),
      },
    });

    // Mock S3 PutObject for storing extracted text
    mockS3Send.mockResolvedValueOnce({});

    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/doc.pdf',
      mime_type: 'application/pdf',
      file_size: 5 * 1024 * 1024,
    };

    const result = await extractText(input);

    expect('text' in result).toBe(true);
    if ('text' in result) {
      expect(result.extraction_method).toBe('bda');
      expect(result.text).toBe(extractedContent);
      expect(result.character_count).toBe(extractedContent.length);
      expect(result.page_count).toBeGreaterThanOrEqual(1);
    }
  });

  it('handles BDA returning pages array format', async () => {
    const page1Text = 'Page 1 content with enough characters for the minimum threshold check.';
    const page2Text = 'Page 2 content continues here.';

    mockBdaSend
      .mockResolvedValueOnce({ invocationArn: 'arn:aws:bedrock:us-east-1:123:invocation/def' })
      .mockResolvedValueOnce({
        status: 'Success',
        outputConfiguration: { s3Uri: 's3://report-documents/bda-output/key' },
      });

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: () =>
          Promise.resolve(JSON.stringify({ pages: [{ text: page1Text }, { text: page2Text }] })),
      },
    });

    // Mock S3 PutObject for storing extracted text
    mockS3Send.mockResolvedValueOnce({});

    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/doc.pdf',
      mime_type: 'application/pdf',
      file_size: 2 * 1024 * 1024,
    };

    const result = await extractText(input);

    expect('text' in result).toBe(true);
    if ('text' in result) {
      expect(result.text).toContain(page1Text);
      expect(result.text).toContain(page2Text);
    }
  });
});

describe('extractText - .docx XML parsing', () => {
  let extractText: typeof import('../../../src/services/report-validation/text-extractor.js').extractText;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDocClientSend.mockResolvedValue({});
    const mod = await import('../../../src/services/report-validation/text-extractor.js');
    extractText = mod.extractText;
  });

  it('successfully extracts text from .docx file', async () => {
    // Create a minimal valid .docx ZIP structure with document.xml
    const docxBuffer = createMinimalDocxBuffer(
      'This is a test document with sufficient text content for the minimum threshold validation check.'
    );

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: () => Promise.resolve(new Uint8Array(docxBuffer)),
      },
    });

    // Mock S3 PutObject for storing extracted text
    mockS3Send.mockResolvedValueOnce({});

    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/doc.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 50000,
    };

    const result = await extractText(input);

    expect('text' in result).toBe(true);
    if ('text' in result) {
      expect(result.extraction_method).toBe('docx_parser');
      expect(result.character_count).toBeGreaterThan(0);
    }
  });

  it('returns error for empty .docx body', async () => {
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: () => Promise.resolve(new Uint8Array(0)),
      },
    });

    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/empty.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 1024,
    };

    const result = await extractText(input);

    expect('error_type' in result).toBe(true);
    if ('error_type' in result) {
      expect(result.error_type).toBe('corrupted');
    }
  });
});

describe('extractText - password-protected PDF', () => {
  let extractText: typeof import('../../../src/services/report-validation/text-extractor.js').extractText;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDocClientSend.mockResolvedValue({});
    const mod = await import('../../../src/services/report-validation/text-extractor.js');
    extractText = mod.extractText;
  });

  it('returns password_protected error when BDA reports password in error message', async () => {
    mockBdaSend
      .mockResolvedValueOnce({ invocationArn: 'arn:aws:bedrock:us-east-1:123:invocation/pwd' })
      .mockResolvedValueOnce({
        status: 'ClientError',
        errorMessage: 'Cannot process document: password protected PDF',
      });

    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/protected.pdf',
      mime_type: 'application/pdf',
      file_size: 5 * 1024 * 1024,
    };

    const result = await extractText(input);

    expect('error_type' in result).toBe(true);
    if ('error_type' in result) {
      expect(result.error_type).toBe('password_protected');
      expect(result.message).toContain('password-protected');
    }
  });

  it('returns password_protected error when BDA throws with encrypted message', async () => {
    mockBdaSend.mockRejectedValueOnce(new Error('Document is encrypted and requires a password'));

    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/encrypted.pdf',
      mime_type: 'application/pdf',
      file_size: 5 * 1024 * 1024,
    };

    const result = await extractText(input);

    expect('error_type' in result).toBe(true);
    if ('error_type' in result) {
      expect(result.error_type).toBe('password_protected');
      expect(result.message).toContain('password-protected');
    }
  });
});

describe('extractText - insufficient text', () => {
  let extractText: typeof import('../../../src/services/report-validation/text-extractor.js').extractText;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDocClientSend.mockResolvedValue({});
    const mod = await import('../../../src/services/report-validation/text-extractor.js');
    extractText = mod.extractText;
  });

  it('returns insufficient_text error when extracted text is less than 50 characters', async () => {
    const shortText = 'Too short';

    mockBdaSend
      .mockResolvedValueOnce({ invocationArn: 'arn:aws:bedrock:us-east-1:123:invocation/short' })
      .mockResolvedValueOnce({
        status: 'Success',
        outputConfiguration: { s3Uri: 's3://report-documents/bda-output/key' },
      });

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: () => Promise.resolve(JSON.stringify({ content: shortText })),
      },
    });

    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/short.pdf',
      mime_type: 'application/pdf',
      file_size: 2 * 1024 * 1024,
    };

    const result = await extractText(input);

    expect('error_type' in result).toBe(true);
    if ('error_type' in result) {
      expect(result.error_type).toBe('insufficient_text');
      expect(result.message).toContain('sufficient text');
    }
  });

  it('returns insufficient_text error for empty extracted text', async () => {
    mockBdaSend
      .mockResolvedValueOnce({ invocationArn: 'arn:aws:bedrock:us-east-1:123:invocation/empty' })
      .mockResolvedValueOnce({
        status: 'Success',
        outputConfiguration: { s3Uri: 's3://report-documents/bda-output/key' },
      });

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: () => Promise.resolve(JSON.stringify({ content: '' })),
      },
    });

    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/blank.pdf',
      mime_type: 'application/pdf',
      file_size: 1024 * 1024,
    };

    const result = await extractText(input);

    expect('error_type' in result).toBe(true);
    if ('error_type' in result) {
      expect(result.error_type).toBe('insufficient_text');
    }
  });
});

describe('extractText - document exceeding size limits', () => {
  let extractText: typeof import('../../../src/services/report-validation/text-extractor.js').extractText;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDocClientSend.mockResolvedValue({});
    const mod = await import('../../../src/services/report-validation/text-extractor.js');
    extractText = mod.extractText;
  });

  it('rejects document exceeding 200 pages', async () => {
    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/large.pdf',
      mime_type: 'application/pdf',
      file_size: 10 * 1024 * 1024,
      page_count: 250,
    };

    const result = await extractText(input);

    expect('error_type' in result).toBe(true);
    if ('error_type' in result) {
      expect(result.error_type).toBe('document_too_large');
      expect(result.message).toContain('200');
    }
  });

  it('rejects document exceeding 50 MB', async () => {
    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/huge.pdf',
      mime_type: 'application/pdf',
      file_size: 55 * 1024 * 1024,
    };

    const result = await extractText(input);

    expect('error_type' in result).toBe(true);
    if ('error_type' in result) {
      expect(result.error_type).toBe('document_too_large');
      expect(result.message).toContain('50 MB');
    }
  });

  it('rejects unsupported MIME type', async () => {
    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/image.png',
      mime_type: 'image/png',
      file_size: 5 * 1024 * 1024,
    };

    const result = await extractText(input);

    expect('error_type' in result).toBe(true);
    if ('error_type' in result) {
      expect(result.error_type).toBe('unsupported_format');
      expect(result.message).toContain('Unsupported');
    }
  });

  it('updates DynamoDB extraction status to failed on rejection', async () => {
    const input: TextExtractionInput = {
      tenant_id: 'tenant-1',
      report_id: 'report-1',
      version: 1,
      s3_key: 'tenant-1/report-1/v1/huge.pdf',
      mime_type: 'application/pdf',
      file_size: 55 * 1024 * 1024,
    };

    await extractText(input);

    expect(mockDocClientSend).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Helper: Create minimal .docx ZIP buffer
// ---------------------------------------------------------------------------

/**
 * Creates a minimal .docx ZIP buffer with the given text content.
 * A .docx file is a ZIP archive containing word/document.xml.
 */
function createMinimalDocxBuffer(text: string): Buffer {
  const { deflateRawSync } = require('zlib');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>${text}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

  const fileName = 'word/document.xml';
  const fileNameBuffer = Buffer.from(fileName, 'utf-8');
  const contentBuffer = Buffer.from(documentXml, 'utf-8');
  const compressedContent = deflateRawSync(contentBuffer);

  // Build a minimal ZIP file with one local file header + data + central directory
  const localFileHeader = Buffer.alloc(30 + fileNameBuffer.length);
  // Local file header signature
  localFileHeader.writeUInt32LE(0x04034b50, 0);
  // Version needed to extract
  localFileHeader.writeUInt16LE(20, 4);
  // General purpose bit flag
  localFileHeader.writeUInt16LE(0, 6);
  // Compression method (8 = deflate)
  localFileHeader.writeUInt16LE(8, 8);
  // Last mod file time
  localFileHeader.writeUInt16LE(0, 10);
  // Last mod file date
  localFileHeader.writeUInt16LE(0, 12);
  // CRC-32 (skip for simplicity)
  localFileHeader.writeUInt32LE(0, 14);
  // Compressed size
  localFileHeader.writeUInt32LE(compressedContent.length, 18);
  // Uncompressed size
  localFileHeader.writeUInt32LE(contentBuffer.length, 22);
  // File name length
  localFileHeader.writeUInt16LE(fileNameBuffer.length, 26);
  // Extra field length
  localFileHeader.writeUInt16LE(0, 28);
  // File name
  fileNameBuffer.copy(localFileHeader, 30);

  // Central directory file header
  const centralDirHeader = Buffer.alloc(46 + fileNameBuffer.length);
  centralDirHeader.writeUInt32LE(0x02014b50, 0);
  centralDirHeader.writeUInt16LE(20, 4); // version made by
  centralDirHeader.writeUInt16LE(20, 6); // version needed
  centralDirHeader.writeUInt16LE(0, 8); // flags
  centralDirHeader.writeUInt16LE(8, 10); // compression
  centralDirHeader.writeUInt16LE(0, 12); // mod time
  centralDirHeader.writeUInt16LE(0, 14); // mod date
  centralDirHeader.writeUInt32LE(0, 16); // crc
  centralDirHeader.writeUInt32LE(compressedContent.length, 20); // compressed size
  centralDirHeader.writeUInt32LE(contentBuffer.length, 24); // uncompressed size
  centralDirHeader.writeUInt16LE(fileNameBuffer.length, 28); // file name length
  centralDirHeader.writeUInt16LE(0, 30); // extra field length
  centralDirHeader.writeUInt16LE(0, 32); // file comment length
  centralDirHeader.writeUInt16LE(0, 34); // disk number start
  centralDirHeader.writeUInt16LE(0, 36); // internal file attributes
  centralDirHeader.writeUInt32LE(0, 38); // external file attributes
  centralDirHeader.writeUInt32LE(0, 42); // relative offset of local header
  fileNameBuffer.copy(centralDirHeader, 46);

  const localHeaderAndData = Buffer.concat([localFileHeader, compressedContent]);
  const centralDirOffset = localHeaderAndData.length;
  const centralDirSize = centralDirHeader.length;

  // End of central directory record
  const endOfCentralDir = Buffer.alloc(22);
  endOfCentralDir.writeUInt32LE(0x06054b50, 0);
  endOfCentralDir.writeUInt16LE(0, 4); // disk number
  endOfCentralDir.writeUInt16LE(0, 6); // disk with central dir
  endOfCentralDir.writeUInt16LE(1, 8); // entries on this disk
  endOfCentralDir.writeUInt16LE(1, 10); // total entries
  endOfCentralDir.writeUInt32LE(centralDirSize, 12); // central dir size
  endOfCentralDir.writeUInt32LE(centralDirOffset, 16); // central dir offset
  endOfCentralDir.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localHeaderAndData, centralDirHeader, endOfCentralDir]);
}
