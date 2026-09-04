/**
 * File upload URL generation for the Forms Service.
 *
 * Implements:
 * - POST /public/forms/{token}/upload-url (task 5.7)
 * - POST /forms/{id}/upload-url (authenticated variant)
 *
 * Generates S3 presigned URLs for direct file upload from the client.
 * Validates file type (PDF, JPEG, PNG) and size (max 10 MB).
 *
 * Requirements: 11.5, 15.4
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createLogger } from '../../shared/logger.js';
import {
  MAX_FILE_SIZE_MB,
  ALLOWED_FILE_TYPES,
  SIGNED_URL_EXPIRY_SECONDS,
} from './types.js';

const logger = createLogger('form-upload');
const s3Client = new S3Client({});

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum file size in bytes (10 MB) */
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/** Map of allowed file extensions to MIME content types */
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Reverse map: content type → extension */
const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpeg',
  'image/png': 'png',
};

// ─── Input / Output Types ─────────────────────────────────────────────────────

export interface GenerateUploadUrlInput {
  filename: string;
  content_type: string;
  size: number;
}

export interface GenerateUploadUrlSuccess {
  success: true;
  upload_url: string;
  fields: Record<string, string>;
  file_key: string;
}

export interface GenerateUploadUrlError {
  success: false;
  statusCode: number;
  code: string;
  message: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates file type and size for upload.
 * Returns an error message if invalid, null if valid.
 */
export function validateFileUpload(
  contentType: string,
  size: number
): string | null {
  // Validate content type
  if (!CONTENT_TYPE_TO_EXT[contentType]) {
    const allowedTypes = Object.values(ALLOWED_CONTENT_TYPES).join(', ');
    return `Tipo de archivo no permitido. Tipos permitidos: ${allowedTypes}`;
  }

  // Validate file size
  if (size <= 0) {
    return 'El tamaño del archivo debe ser mayor a 0';
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    return `El archivo excede el tamaño máximo de ${MAX_FILE_SIZE_MB} MB`;
  }

  return null;
}

/**
 * Validates the upload request input fields.
 * Returns an error message if invalid, null if valid.
 */
export function validateUploadInput(
  input: Partial<GenerateUploadUrlInput>
): string | null {
  if (!input.filename || typeof input.filename !== 'string' || input.filename.trim().length === 0) {
    return 'El nombre del archivo es requerido';
  }

  if (!input.content_type || typeof input.content_type !== 'string') {
    return 'El tipo de contenido es requerido';
  }

  if (input.size === undefined || input.size === null || typeof input.size !== 'number') {
    return 'El tamaño del archivo es requerido';
  }

  return null;
}

// ─── S3 Key Generation ────────────────────────────────────────────────────────

/**
 * Generates the S3 key for a form file upload.
 * Structure: forms/{tenant_id}/{form_id}/responses/{response_id}/{field_id}/{filename}
 */
export function generateS3Key(
  tenantId: string,
  formId: string,
  responseId: string,
  fieldId: string,
  filename: string
): string {
  // Sanitize filename: remove path separators and control characters
  const sanitizedFilename = filename
    .replace(/[/\\]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();

  return `forms/${tenantId}/${formId}/responses/${responseId}/${fieldId}/${sanitizedFilename}`;
}

// ─── Generate Presigned URL ───────────────────────────────────────────────────

/**
 * Generates a presigned S3 URL for file upload.
 *
 * Validates:
 * - File type is PDF, JPEG, or PNG
 * - File size does not exceed 10 MB
 *
 * Returns:
 * - upload_url: presigned PUT URL (15-minute expiration)
 * - fields: metadata fields for the upload (content-type)
 * - file_key: the S3 key where the file will be stored
 */
export async function generateFormUploadUrl(
  tenantId: string,
  formId: string,
  responseId: string,
  fieldId: string,
  input: GenerateUploadUrlInput
): Promise<GenerateUploadUrlSuccess | GenerateUploadUrlError> {
  // 1. Validate input fields
  const inputError = validateUploadInput(input);
  if (inputError) {
    return {
      success: false,
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: inputError,
    };
  }

  // 2. Validate file type and size
  const fileError = validateFileUpload(input.content_type, input.size);
  if (fileError) {
    // Determine specific error code
    const isTypeError = !CONTENT_TYPE_TO_EXT[input.content_type];
    return {
      success: false,
      statusCode: 400,
      code: isTypeError ? 'INVALID_FILE_TYPE' : 'FILE_TOO_LARGE',
      message: fileError,
    };
  }

  // 3. Generate S3 key
  const fileKey = generateS3Key(tenantId, formId, responseId, fieldId, input.filename);

  // 4. Generate presigned URL
  const bucketName = process.env['MEDIA_BUCKET_NAME'] ?? 'compliance-media-assets';

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    ContentType: input.content_type,
    ContentLength: input.size,
  });

  try {
    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: SIGNED_URL_EXPIRY_SECONDS,
    });

    logger.info('Generated presigned upload URL', {
      tenant_id: tenantId,
      form_id: formId,
      response_id: responseId,
      field_id: fieldId,
      filename: input.filename,
      content_type: input.content_type,
      size: input.size,
    });

    return {
      success: true,
      upload_url: uploadUrl,
      fields: {
        'Content-Type': input.content_type,
      },
      file_key: fileKey,
    };
  } catch (error) {
    logger.error('Failed to generate presigned URL', {
      error: error instanceof Error ? error.message : String(error),
      tenant_id: tenantId,
      form_id: formId,
    });

    return {
      success: false,
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo generar la URL de carga',
    };
  }
}
