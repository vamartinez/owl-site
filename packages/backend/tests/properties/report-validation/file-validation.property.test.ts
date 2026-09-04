// Feature: ai-report-validation, Property 1: Report file type validation
// Feature: ai-report-validation, Property 2: Report file size validation

/**
 * Property-based tests for file metadata validation in the upload manager.
 *
 * Property 1: For any file, the report upload validator SHALL accept it if and only if
 * its MIME type is one of [application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document,
 * application/msword]. All other MIME types SHALL be rejected.
 *
 * Property 2: For any file, the report upload validator SHALL accept it if and only if
 * its size is greater than or equal to 1 KB (1024 bytes) AND less than or equal to
 * 25 MB (26,214,400 bytes). Files outside this range SHALL be rejected.
 *
 * **Validates: Requirements 1.1, 1.2, 1.5, 9.7**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateFileMetadata } from '../../../src/services/report-validation/upload-manager.js';
import {
  ALLOWED_REPORT_MIME_TYPES,
  MIN_REPORT_FILE_SIZE,
  MAX_REPORT_FILE_SIZE,
} from '../../../src/services/report-validation/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_MIME_TYPES: readonly string[] = ALLOWED_REPORT_MIME_TYPES;

/** Common MIME types that are NOT valid for report uploads */
const INVALID_MIME_TYPES = [
  'text/plain',
  'text/html',
  'text/csv',
  'application/json',
  'application/xml',
  'application/zip',
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'audio/mpeg',
  'video/mp4',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/rtf',
  'application/x-tar',
  'application/gzip',
] as const;

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for a valid MIME type (one of the three accepted types) */
const arbValidMimeType: fc.Arbitrary<string> = fc.constantFrom(...VALID_MIME_TYPES);

/** Arbitrary for an invalid MIME type (known invalid types + random strings) */
const arbInvalidMimeType: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...INVALID_MIME_TYPES),
  fc.string({ minLength: 1, maxLength: 100 }).filter(
    (s) => !VALID_MIME_TYPES.includes(s)
  ),
);

/** Arbitrary for a valid file size (between 1 KB and 25 MB inclusive) */
const arbValidFileSize: fc.Arbitrary<number> = fc.integer({
  min: MIN_REPORT_FILE_SIZE,
  max: MAX_REPORT_FILE_SIZE,
});

/** Arbitrary for a file size that is too small (less than 1 KB) */
const arbTooSmallFileSize: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: MIN_REPORT_FILE_SIZE - 1,
});

/** Arbitrary for a file size that is too large (greater than 25 MB) */
const arbTooLargeFileSize: fc.Arbitrary<number> = fc.integer({
  min: MAX_REPORT_FILE_SIZE + 1,
  max: MAX_REPORT_FILE_SIZE * 4, // Up to 100 MB
});

/** Arbitrary for any invalid file size (too small or too large) */
const arbInvalidFileSize: fc.Arbitrary<number> = fc.oneof(
  arbTooSmallFileSize,
  arbTooLargeFileSize,
);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('File Validation Property Tests', () => {
  // **Validates: Requirements 1.1, 1.5, 9.7**
  describe('Property 1: Report file type validation', () => {
    it('accepts files with valid MIME types (PDF, .docx, .doc)', () => {
      fc.assert(
        fc.property(arbValidMimeType, arbValidFileSize, (mimeType, fileSize) => {
          const result = validateFileMetadata(mimeType, fileSize);

          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects files with invalid MIME types', () => {
      fc.assert(
        fc.property(arbInvalidMimeType, arbValidFileSize, (mimeType, fileSize) => {
          const result = validateFileMetadata(mimeType, fileSize);

          expect(result).not.toBeNull();
          expect(result).toBeTypeOf('string');
        }),
        { numRuns: 100 },
      );
    });

    it('accepts if and only if MIME type is in the allowed set', () => {
      fc.assert(
        fc.property(
          fc.oneof(arbValidMimeType, arbInvalidMimeType),
          arbValidFileSize,
          (mimeType, fileSize) => {
            const result = validateFileMetadata(mimeType, fileSize);
            const isAllowed = VALID_MIME_TYPES.includes(mimeType);

            if (isAllowed) {
              expect(result).toBeNull();
            } else {
              expect(result).not.toBeNull();
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('exactly three MIME types are accepted', () => {
      // Verify the allowed set has exactly the expected members
      expect(VALID_MIME_TYPES).toHaveLength(3);
      expect(VALID_MIME_TYPES).toContain('application/pdf');
      expect(VALID_MIME_TYPES).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(VALID_MIME_TYPES).toContain('application/msword');
    });
  });

  // **Validates: Requirements 1.2**
  describe('Property 2: Report file size validation', () => {
    it('accepts files within the valid size range [1 KB, 25 MB]', () => {
      fc.assert(
        fc.property(arbValidMimeType, arbValidFileSize, (mimeType, fileSize) => {
          const result = validateFileMetadata(mimeType, fileSize);

          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects files smaller than 1 KB', () => {
      fc.assert(
        fc.property(arbValidMimeType, arbTooSmallFileSize, (mimeType, fileSize) => {
          const result = validateFileMetadata(mimeType, fileSize);

          expect(result).not.toBeNull();
          expect(result).toBeTypeOf('string');
        }),
        { numRuns: 100 },
      );
    });

    it('rejects files larger than 25 MB', () => {
      fc.assert(
        fc.property(arbValidMimeType, arbTooLargeFileSize, (mimeType, fileSize) => {
          const result = validateFileMetadata(mimeType, fileSize);

          expect(result).not.toBeNull();
          expect(result).toBeTypeOf('string');
        }),
        { numRuns: 100 },
      );
    });

    it('accepts if and only if size is >= 1024 and <= 26214400', () => {
      fc.assert(
        fc.property(
          arbValidMimeType,
          fc.oneof(arbValidFileSize, arbInvalidFileSize),
          (mimeType, fileSize) => {
            const result = validateFileMetadata(mimeType, fileSize);
            const isValidSize = fileSize >= MIN_REPORT_FILE_SIZE && fileSize <= MAX_REPORT_FILE_SIZE;

            if (isValidSize) {
              expect(result).toBeNull();
            } else {
              expect(result).not.toBeNull();
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('boundary: accepts exactly 1024 bytes (minimum)', () => {
      fc.assert(
        fc.property(arbValidMimeType, (mimeType) => {
          const result = validateFileMetadata(mimeType, MIN_REPORT_FILE_SIZE);

          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('boundary: accepts exactly 26214400 bytes (maximum)', () => {
      fc.assert(
        fc.property(arbValidMimeType, (mimeType) => {
          const result = validateFileMetadata(mimeType, MAX_REPORT_FILE_SIZE);

          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('boundary: rejects 1023 bytes (one below minimum)', () => {
      fc.assert(
        fc.property(arbValidMimeType, (mimeType) => {
          const result = validateFileMetadata(mimeType, MIN_REPORT_FILE_SIZE - 1);

          expect(result).not.toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('boundary: rejects 26214401 bytes (one above maximum)', () => {
      fc.assert(
        fc.property(arbValidMimeType, (mimeType) => {
          const result = validateFileMetadata(mimeType, MAX_REPORT_FILE_SIZE + 1);

          expect(result).not.toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  });
});
