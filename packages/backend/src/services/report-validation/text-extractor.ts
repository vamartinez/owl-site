/**
 * Text Extractor Module.
 * Handles text extraction from uploaded report documents:
 * - PDF documents: uses AWS Bedrock Data Automation (BDA) for structured extraction
 * - Word documents (.docx): uses lightweight XML parsing via JSZip
 *
 * Stores extracted text in S3 and updates the version record in DynamoDB.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 3.3, 3.5, 3.7
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  BedrockDataAutomationRuntimeClient,
  InvokeDataAutomationAsyncCommand,
  GetDataAutomationStatusCommand,
} from '@aws-sdk/client-bedrock-data-automation-runtime';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { inflateRawSync } from 'zlib';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { MIN_TEXT_EXTRACTION_CHARS } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORT_DOCUMENTS_BUCKET = process.env['REPORT_DOCUMENTS_BUCKET'] ?? 'report-documents';
const REPORT_VERSIONS_TABLE = 'report-versions';
const BDA_OUTPUT_BUCKET = process.env['BDA_OUTPUT_BUCKET'] ?? REPORT_DOCUMENTS_BUCKET;
const BDA_DATA_AUTOMATION_PROJECT_ARN = process.env['BDA_DATA_AUTOMATION_PROJECT_ARN'] ?? '';
const BDA_DATA_AUTOMATION_PROFILE_ARN = process.env['BDA_DATA_AUTOMATION_PROFILE_ARN'] ?? '';

/** Maximum document page count for extraction. Requirement 9.6 */
const MAX_DOCUMENT_PAGES = 200;

/** Maximum document file size for extraction in bytes (50 MB). Requirement 9.6 */
const MAX_EXTRACTION_FILE_SIZE = 50 * 1024 * 1024;

/** BDA polling interval in milliseconds */
const BDA_POLL_INTERVAL_MS = 3000;

/** BDA maximum wait time in milliseconds (60 seconds for up to 50 pages). Requirement 9.1 */
const BDA_MAX_WAIT_MS = 60_000;

const s3Client = new S3Client({});
const bdaClient = new BedrockDataAutomationRuntimeClient({});
const logger = createLogger('report-validation-text-extractor');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of text extraction from a document.
 */
export interface TextExtractionResult {
  text: string;
  page_count: number;
  extraction_method: 'bda' | 'docx_parser';
  character_count: number;
}

/**
 * Error types for extraction failures.
 */
export type ExtractionErrorType =
  | 'password_protected'
  | 'corrupted'
  | 'unparseable'
  | 'insufficient_text'
  | 'document_too_large'
  | 'unsupported_format'
  | 'extraction_timeout'
  | 'service_error';

/**
 * Extraction failure result.
 */
export interface TextExtractionError {
  error_type: ExtractionErrorType;
  message: string;
}

/**
 * Input parameters for text extraction.
 */
export interface TextExtractionInput {
  tenant_id: string;
  report_id: string;
  version: number;
  s3_key: string;
  mime_type: string;
  file_size: number;
  page_count?: number;
}

// ---------------------------------------------------------------------------
// Document Size Validation
// ---------------------------------------------------------------------------

/**
 * Validates document size limits before extraction.
 * Rejects documents exceeding 200 pages or 50 MB.
 *
 * Requirement 9.6: reject documents exceeding maximum supported size.
 */
export function validateDocumentSize(
  fileSize: number,
  pageCount?: number
): TextExtractionError | null {
  if (fileSize > MAX_EXTRACTION_FILE_SIZE) {
    return {
      error_type: 'document_too_large',
      message: `Document exceeds the maximum supported size of 50 MB (${Math.round(fileSize / (1024 * 1024))} MB provided)`,
    };
  }

  if (pageCount !== undefined && pageCount > MAX_DOCUMENT_PAGES) {
    return {
      error_type: 'document_too_large',
      message: `Document exceeds the maximum supported page count of ${MAX_DOCUMENT_PAGES} pages (${pageCount} pages provided)`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// MIME Type Validation
// ---------------------------------------------------------------------------

const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
] as const;

/**
 * Checks if the MIME type is supported for text extraction.
 *
 * Requirement 9.7: reject unsupported formats.
 */
export function isSupportedMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.includes(mimeType as typeof SUPPORTED_MIME_TYPES[number]);
}

// ---------------------------------------------------------------------------
// PDF Extraction via BDA
// ---------------------------------------------------------------------------

/**
 * Extracts text from a PDF document using AWS Bedrock Data Automation (BDA).
 * BDA handles OCR, tables, headers, footers, and embedded text in images.
 *
 * Requirement 9.1: extract all text content including tables, headers, footers,
 * and embedded text in images using OCR capabilities.
 */
async function extractTextFromPdf(
  s3Key: string,
  _fileSize: number
): Promise<TextExtractionResult | TextExtractionError> {
  const inputS3Uri = `s3://${REPORT_DOCUMENTS_BUCKET}/${s3Key}`;
  const outputS3Uri = `s3://${BDA_OUTPUT_BUCKET}/bda-output/${s3Key}`;

  try {
    // Invoke BDA async processing
    const invokeResponse = await bdaClient.send(
      new InvokeDataAutomationAsyncCommand({
        inputConfiguration: {
          s3Uri: inputS3Uri,
        },
        outputConfiguration: {
          s3Uri: outputS3Uri,
        },
        dataAutomationConfiguration: {
          dataAutomationProjectArn: BDA_DATA_AUTOMATION_PROJECT_ARN,
          stage: 'LIVE',
        },
        dataAutomationProfileArn: BDA_DATA_AUTOMATION_PROFILE_ARN,
      })
    );

    const invocationArn = invokeResponse.invocationArn;
    if (!invocationArn) {
      return {
        error_type: 'service_error',
        message: 'BDA invocation did not return an invocation ARN',
      };
    }

    // Poll for completion
    const extractedText = await pollBdaCompletion(invocationArn, outputS3Uri);

    if (typeof extractedText === 'object' && 'error_type' in extractedText) {
      return extractedText;
    }

    // Estimate page count from text length (approximate: ~3000 chars per page for PDFs)
    const estimatedPageCount = Math.max(1, Math.ceil(extractedText.length / 3000));

    return {
      text: extractedText,
      page_count: estimatedPageCount,
      extraction_method: 'bda',
      character_count: extractedText.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Detect password-protected documents
    if (
      errorMessage.toLowerCase().includes('password') ||
      errorMessage.toLowerCase().includes('encrypted')
    ) {
      return {
        error_type: 'password_protected',
        message: 'Document is password-protected and cannot be processed',
      };
    }

    // Detect corrupted documents
    if (
      errorMessage.toLowerCase().includes('corrupt') ||
      errorMessage.toLowerCase().includes('malformed') ||
      errorMessage.toLowerCase().includes('invalid pdf')
    ) {
      return {
        error_type: 'corrupted',
        message: 'Document appears to be corrupted and cannot be processed',
      };
    }

    logger.error('BDA extraction failed', {
      s3_key: s3Key,
      error: errorMessage,
    });

    return {
      error_type: 'service_error',
      message: 'Document could not be processed. Please verify the file is not corrupted.',
    };
  }
}

/**
 * Polls BDA for job completion and retrieves extracted text from the output location.
 */
async function pollBdaCompletion(
  invocationArn: string,
  outputS3Uri: string
): Promise<string | TextExtractionError> {
  const startTime = Date.now();

  while (Date.now() - startTime < BDA_MAX_WAIT_MS) {
    const statusResponse = await bdaClient.send(
      new GetDataAutomationStatusCommand({
        invocationArn,
      })
    );

    const status = statusResponse.status;

    if (status === 'Success') {
      // Retrieve extracted text from S3 output location
      const outputConfig = statusResponse.outputConfiguration;
      const resolvedOutputUri = outputConfig?.s3Uri ?? outputS3Uri;
      return await retrieveBdaOutput(resolvedOutputUri);
    }

    if (status === 'ClientError' || status === 'ServiceError') {
      const errorMessage = statusResponse.errorMessage ?? 'BDA processing failed';

      if (
        errorMessage.toLowerCase().includes('password') ||
        errorMessage.toLowerCase().includes('encrypted')
      ) {
        return {
          error_type: 'password_protected',
          message: 'Document is password-protected and cannot be processed',
        };
      }

      return {
        error_type: status === 'ClientError' ? 'unparseable' : 'service_error',
        message: errorMessage,
      };
    }

    // Wait before polling again (status is 'Created' or 'InProgress')
    await sleep(BDA_POLL_INTERVAL_MS);
  }

  return {
    error_type: 'extraction_timeout',
    message: 'Text extraction timed out. The document may be too complex to process.',
  };
}

/**
 * Retrieves the extracted text output from BDA's S3 output location.
 */
async function retrieveBdaOutput(outputS3Uri: string): Promise<string> {
  // BDA outputs results in a structured format; we read the text content
  const uriParts = outputS3Uri.replace('s3://', '').split('/');
  const bucket = uriParts[0];
  const key = uriParts.slice(1).join('/');

  // BDA typically outputs a JSON result file with extracted content
  const resultKey = `${key}/0/result.json`;

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: resultKey,
    })
  );

  const body = await response.Body?.transformToString();
  if (!body) {
    return '';
  }

  // Parse BDA output format to extract text content
  try {
    const bdaResult = JSON.parse(body);
    // BDA returns structured content; extract all text blocks
    if (bdaResult.content && typeof bdaResult.content === 'string') {
      return bdaResult.content;
    }
    if (bdaResult.pages && Array.isArray(bdaResult.pages)) {
      return bdaResult.pages
        .map((page: { text?: string; content?: string }) => page.text ?? page.content ?? '')
        .join('\n\n');
    }
    // Fallback: stringify the entire result
    return typeof bdaResult === 'string' ? bdaResult : JSON.stringify(bdaResult);
  } catch {
    // If not JSON, treat as plain text
    return body;
  }
}

// ---------------------------------------------------------------------------
// Word Document (.docx) Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts text from a Word document (.docx) using lightweight XML parsing.
 * Parses the document.xml within the ZIP structure to extract paragraphs,
 * tables, headers, footers, and list items.
 *
 * Requirement 9.2: extract all text content including paragraphs, tables,
 * headers, footers, and list items within 30 seconds.
 */
async function extractTextFromDocx(s3Key: string): Promise<TextExtractionResult | TextExtractionError> {
  try {
    // Fetch the .docx file from S3
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: REPORT_DOCUMENTS_BUCKET,
        Key: s3Key,
      })
    );

    const bodyBytes = await response.Body?.transformToByteArray();
    if (!bodyBytes || bodyBytes.length === 0) {
      return {
        error_type: 'corrupted',
        message: 'Document file is empty or could not be read',
      };
    }

    // Parse the .docx ZIP structure and extract text from document.xml
    const text = await parseDocxContent(Buffer.from(bodyBytes));

    if (typeof text === 'object' && 'error_type' in text) {
      return text;
    }

    // Estimate page count (approximate: ~2500 chars per page for Word docs)
    const estimatedPageCount = Math.max(1, Math.ceil(text.length / 2500));

    return {
      text,
      page_count: estimatedPageCount,
      extraction_method: 'docx_parser',
      character_count: text.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.toLowerCase().includes('password') ||
      errorMessage.toLowerCase().includes('encrypted')
    ) {
      return {
        error_type: 'password_protected',
        message: 'Document is password-protected and cannot be processed',
      };
    }

    logger.error('DOCX extraction failed', {
      s3_key: s3Key,
      error: errorMessage,
    });

    return {
      error_type: 'unparseable',
      message: 'Document could not be parsed. Please verify the file is not corrupted.',
    };
  }
}

/**
 * Parses .docx ZIP content and extracts text from the XML structure.
 * A .docx file is a ZIP archive containing XML files. The main content
 * is in word/document.xml.
 */
async function parseDocxContent(buffer: Buffer): Promise<string | TextExtractionError> {
  try {
    const entries = parseZipEntries(buffer);
    const textParts: string[] = [];

    // Extract text from document.xml (main content)
    const documentXml = entries.find(
      (e) => e.name === 'word/document.xml'
    );
    if (documentXml) {
      const xmlContent = inflateEntry(buffer, documentXml);
      textParts.push(extractTextFromXml(xmlContent));
    }

    // Extract text from headers
    const headerEntries = entries.filter((e) =>
      e.name.match(/^word\/header\d*\.xml$/)
    );
    for (const header of headerEntries) {
      const xmlContent = inflateEntry(buffer, header);
      textParts.push(extractTextFromXml(xmlContent));
    }

    // Extract text from footers
    const footerEntries = entries.filter((e) =>
      e.name.match(/^word\/footer\d*\.xml$/)
    );
    for (const footer of footerEntries) {
      const xmlContent = inflateEntry(buffer, footer);
      textParts.push(extractTextFromXml(xmlContent));
    }

    if (textParts.every((part) => part.trim().length === 0)) {
      return {
        error_type: 'unparseable',
        message: 'Document could not be parsed. No text content found in the document structure.',
      };
    }

    return textParts.filter((part) => part.trim().length > 0).join('\n\n');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('encrypted') || errorMessage.includes('password')) {
      return {
        error_type: 'password_protected',
        message: 'Document is password-protected and cannot be processed',
      };
    }

    return {
      error_type: 'corrupted',
      message: 'Document appears to be corrupted and cannot be parsed',
    };
  }
}

// ---------------------------------------------------------------------------
// ZIP Parsing (Lightweight, no external dependencies)
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  dataOffset: number;
}

/**
 * Parses ZIP local file headers to find entries.
 * This is a minimal ZIP parser sufficient for .docx files.
 */
function parseZipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset < buffer.length - 4) {
    // Look for local file header signature (PK\x03\x04)
    if (
      buffer[offset] === 0x50 &&
      buffer[offset + 1] === 0x4b &&
      buffer[offset + 2] === 0x03 &&
      buffer[offset + 3] === 0x04
    ) {
      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const uncompressedSize = buffer.readUInt32LE(offset + 22);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraFieldLength = buffer.readUInt16LE(offset + 28);

      const fileName = buffer
        .subarray(offset + 30, offset + 30 + fileNameLength)
        .toString('utf-8');

      const dataOffset = offset + 30 + fileNameLength + extraFieldLength;

      entries.push({
        name: fileName,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        dataOffset,
      });

      // Move past this entry
      offset = dataOffset + compressedSize;
    } else {
      offset++;
    }
  }

  return entries;
}

/**
 * Inflates (decompresses) a ZIP entry's data.
 */
function inflateEntry(buffer: Buffer, entry: ZipEntry): string {
  const compressedData = buffer.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize
  );

  if (entry.compressionMethod === 0) {
    // Stored (no compression)
    return compressedData.toString('utf-8');
  }

  // Deflate compression (method 8)
  const decompressed = inflateRawSync(compressedData);
  return decompressed.toString('utf-8');
}

/**
 * Extracts text content from Office Open XML.
 * Parses <w:t> elements which contain the actual text in .docx XML.
 */
function extractTextFromXml(xml: string): string {
  // Track paragraph boundaries for proper spacing
  const paragraphs: string[] = [];

  // Split by paragraph markers
  const sections = xml.split(/<w:p[\s>]/g);

  for (const section of sections) {
    const paraText: string[] = [];
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch: RegExpExecArray | null;

    while ((tMatch = tRegex.exec(section)) !== null) {
      paraText.push(tMatch[1]);
    }

    if (paraText.length > 0) {
      paragraphs.push(paraText.join(''));
    }
  }

  return paragraphs.join('\n');
}

// ---------------------------------------------------------------------------
// Main Extraction Orchestrator
// ---------------------------------------------------------------------------

/**
 * Extracts text from a document, validates the result, stores it in S3,
 * and updates the version record in DynamoDB.
 *
 * This is the main entry point for the text extraction pipeline.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 3.3, 3.5, 3.7
 */
export async function extractText(
  input: TextExtractionInput
): Promise<TextExtractionResult | TextExtractionError> {
  const { tenant_id, report_id, version, s3_key, mime_type, file_size, page_count } = input;

  logger.info('Starting text extraction', {
    report_id,
    version,
    mime_type,
    file_size,
    page_count,
  });

  // Validate MIME type
  if (!isSupportedMimeType(mime_type)) {
    const error: TextExtractionError = {
      error_type: 'unsupported_format',
      message: `Unsupported file format for text extraction. Accepted: PDF, .docx, .doc`,
    };
    await updateExtractionStatus(report_id, version, 'failed', error.message);
    return error;
  }

  // Validate document size limits (Requirement 9.6)
  const sizeError = validateDocumentSize(file_size, page_count);
  if (sizeError) {
    await updateExtractionStatus(report_id, version, 'failed', sizeError.message);
    return sizeError;
  }

  // Perform extraction based on MIME type
  let result: TextExtractionResult | TextExtractionError;

  if (mime_type === 'application/pdf') {
    result = await extractTextFromPdf(s3_key, file_size);
  } else if (
    mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime_type === 'application/msword'
  ) {
    result = await extractTextFromDocx(s3_key);
  } else {
    result = {
      error_type: 'unsupported_format',
      message: 'Unsupported file format for text extraction',
    };
  }

  // Handle extraction failure
  if ('error_type' in result) {
    logger.warn('Text extraction failed', {
      report_id,
      version,
      error_type: result.error_type,
      message: result.message,
    });
    await updateExtractionStatus(report_id, version, 'failed', result.message);
    return result;
  }

  // Validate minimum text threshold (Requirement 3.7, 9.3)
  if (result.character_count < MIN_TEXT_EXTRACTION_CHARS) {
    const error: TextExtractionError = {
      error_type: 'insufficient_text',
      message: 'Document does not contain sufficient text for compliance validation',
    };
    await updateExtractionStatus(report_id, version, 'failed', error.message);
    return error;
  }

  // Store extracted text in S3 (Requirement 9.4)
  const extractedTextKey = `${tenant_id}/${report_id}/v${version}/extracted-text.txt`;
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: REPORT_DOCUMENTS_BUCKET,
        Key: extractedTextKey,
        Body: result.text,
        ContentType: 'text/plain; charset=utf-8',
      })
    );
  } catch (error) {
    logger.error('Failed to store extracted text in S3', {
      report_id,
      version,
      extracted_text_key: extractedTextKey,
      error: error instanceof Error ? error.message : String(error),
    });
    await updateExtractionStatus(report_id, version, 'failed', 'Failed to store extracted text');
    return {
      error_type: 'service_error',
      message: 'Failed to store extracted text. Please try again.',
    };
  }

  // Update version record with extraction results (Requirement 9.4)
  await updateExtractionStatus(
    report_id,
    version,
    'completed',
    undefined,
    extractedTextKey,
    result.character_count,
    result.page_count
  );

  logger.info('Text extraction completed', {
    report_id,
    version,
    extraction_method: result.extraction_method,
    character_count: result.character_count,
    page_count: result.page_count,
    extracted_text_key: extractedTextKey,
  });

  return result;
}

// ---------------------------------------------------------------------------
// DynamoDB Update Helpers
// ---------------------------------------------------------------------------

/**
 * Updates the extraction status and related fields on the version record.
 */
async function updateExtractionStatus(
  reportId: string,
  version: number,
  status: 'pending' | 'completed' | 'failed',
  errorMessage?: string,
  extractedTextKey?: string,
  characterCount?: number,
  pageCount?: number
): Promise<void> {
  const updateParts: string[] = ['extraction_status = :status'];
  const exprAttrValues: Record<string, unknown> = {
    ':status': status,
  };

  if (extractedTextKey) {
    updateParts.push('extracted_text_key = :etk');
    exprAttrValues[':etk'] = extractedTextKey;
  }

  if (characterCount !== undefined) {
    updateParts.push('character_count = :cc');
    exprAttrValues[':cc'] = characterCount;
  }

  if (pageCount !== undefined) {
    updateParts.push('page_count = :pc');
    exprAttrValues[':pc'] = pageCount;
  }

  if (errorMessage) {
    updateParts.push('extraction_error = :err');
    exprAttrValues[':err'] = errorMessage;
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: getTableName(REPORT_VERSIONS_TABLE),
        Key: {
          report_id: reportId,
          version,
        },
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeValues: exprAttrValues,
      })
    );
  } catch (error) {
    logger.error('Failed to update extraction status in DynamoDB', {
      report_id: reportId,
      version,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
