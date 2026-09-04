// Feature: contractor-forms-qr, Property 28: Validación de archivos

/**
 * Property-based tests for file validation.
 *
 * Property 28: For any file attachment in a carga_archivo field, the system must
 * reject it if it exceeds 10 MB or if its type is not PDF, JPEG, or PNG,
 * returning an error that indicates the maximum size and allowed types.
 *
 * Tests both:
 * - form-upload.ts: validateFileUpload (presigned URL generation validation)
 * - form-validation.ts: validateField (form response validation for file fields)
 *
 * **Validates: Requirements 10.4, 11.5, 15.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateFileUpload } from '../../src/services/forms/form-upload.js';
import { validateField } from '../../src/services/forms/form-validation.js';
import { FieldType, MAX_FILE_SIZE_MB, ALLOWED_FILE_TYPES } from '../../src/services/forms/types.js';
import type { FieldConfig } from '../../src/services/forms/types.js';
import type { FileMetadata } from '../../src/services/forms/form-validation.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024; // 10 MB in bytes

/** Valid MIME types for file uploads */
const VALID_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** Invalid MIME types that should be rejected */
const INVALID_CONTENT_TYPES = [
  'application/zip',
  'application/json',
  'text/plain',
  'text/html',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/octet-stream',
  'video/mp4',
  'audio/mpeg',
  'application/xml',
  'application/javascript',
  'text/csv',
  'image/bmp',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid content types (PDF, JPEG, PNG) */
const arbValidContentType = fc.constantFrom(...VALID_CONTENT_TYPES);

/** Arbitrary for invalid content types */
const arbInvalidContentType = fc.constantFrom(...INVALID_CONTENT_TYPES);

/** Arbitrary for file sizes exceeding 10 MB (10 MB + 1 byte to 50 MB) */
const arbOversizedBytes = fc.integer({ min: MAX_FILE_SIZE_BYTES + 1, max: 50 * 1024 * 1024 });

/** Arbitrary for valid file sizes (1 byte to 10 MB inclusive) */
const arbValidSizeBytes = fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES });

/** Arbitrary for a carga_archivo field configuration */
const arbFileField = fc.tuple(fc.uuid(), fc.string({ minLength: 1, maxLength: 100 })).map(
  ([field_id, label]): FieldConfig => ({
    field_id,
    type: FieldType.CARGA_ARCHIVO,
    label,
    required: false,
    order: 1,
  }),
);

/** Arbitrary for a required carga_archivo field */
const arbRequiredFileField = fc.tuple(fc.uuid(), fc.string({ minLength: 1, maxLength: 100 })).map(
  ([field_id, label]): FieldConfig => ({
    field_id,
    type: FieldType.CARGA_ARCHIVO,
    label,
    required: true,
    order: 1,
  }),
);

/** Arbitrary for a valid filename */
const arbFilename = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 50, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')) }),
    fc.constantFrom('pdf', 'jpeg', 'png'),
  )
  .map(([name, ext]) => `${name}.${ext}`);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Forms File Validation Property Tests', () => {
  // **Validates: Requirements 10.4, 15.4**
  describe('Property 28: Files exceeding 10 MB are rejected', () => {
    it('validateFileUpload rejects any file exceeding 10 MB regardless of valid content type', () => {
      fc.assert(
        fc.property(arbValidContentType, arbOversizedBytes, (contentType, size) => {
          const error = validateFileUpload(contentType, size);

          // Must be rejected
          expect(error).not.toBeNull();
          // Error must mention the maximum size
          expect(error).toContain(String(MAX_FILE_SIZE_MB));
        }),
        { numRuns: 100 },
      );
    });

    it('form-validation validateField rejects file metadata exceeding 10 MB', () => {
      fc.assert(
        fc.property(
          arbFileField,
          arbValidContentType,
          arbOversizedBytes,
          arbFilename,
          (field, contentType, sizeBytes, filename) => {
            const fileMeta: FileMetadata = {
              filename,
              size_bytes: sizeBytes,
              content_type: contentType,
            };

            // Provide a non-empty value so the field is not considered empty
            const errors = validateField(field, 'file-key-placeholder', fileMeta);

            // Must have at least one error about file size
            const sizeErrors = errors.filter((e) => e.message.includes(String(MAX_FILE_SIZE_MB)));
            expect(sizeErrors.length).toBeGreaterThan(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 10.4, 11.5**
  describe('Property 28: Only PDF, JPEG, PNG content types are accepted', () => {
    it('validateFileUpload rejects any invalid content type regardless of valid size', () => {
      fc.assert(
        fc.property(arbInvalidContentType, arbValidSizeBytes, (contentType, size) => {
          const error = validateFileUpload(contentType, size);

          // Must be rejected
          expect(error).not.toBeNull();
          // Error must mention allowed types
          expect(error).toContain('Tipo de archivo no permitido');
        }),
        { numRuns: 100 },
      );
    });

    it('form-validation validateField rejects file metadata with invalid content type', () => {
      fc.assert(
        fc.property(
          arbFileField,
          arbInvalidContentType,
          arbValidSizeBytes,
          arbFilename,
          (field, contentType, sizeBytes, filename) => {
            const fileMeta: FileMetadata = {
              filename,
              size_bytes: sizeBytes,
              content_type: contentType,
            };

            const errors = validateField(field, 'file-key-placeholder', fileMeta);

            // Must have at least one error about file type
            const typeErrors = errors.filter(
              (e) => e.message.includes('solo acepta archivos de tipo'),
            );
            expect(typeErrors.length).toBeGreaterThan(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 10.4, 11.5, 15.4**
  describe('Property 28: Valid files (correct type and size) are accepted', () => {
    it('validateFileUpload accepts any file with valid content type and size <= 10 MB', () => {
      fc.assert(
        fc.property(arbValidContentType, arbValidSizeBytes, (contentType, size) => {
          const error = validateFileUpload(contentType, size);

          // Must be accepted (no error)
          expect(error).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('form-validation validateField accepts file metadata with valid type and size', () => {
      fc.assert(
        fc.property(
          arbFileField,
          arbValidContentType,
          arbValidSizeBytes,
          arbFilename,
          (field, contentType, sizeBytes, filename) => {
            const fileMeta: FileMetadata = {
              filename,
              size_bytes: sizeBytes,
              content_type: contentType,
            };

            const errors = validateField(field, 'file-key-placeholder', fileMeta);

            // Must have no errors
            expect(errors).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('validateFileUpload accepts files at exactly 10 MB boundary', () => {
      fc.assert(
        fc.property(arbValidContentType, (contentType) => {
          const error = validateFileUpload(contentType, MAX_FILE_SIZE_BYTES);

          // Exactly at the limit must be accepted
          expect(error).toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  });
});
