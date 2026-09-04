// Feature: ai-report-validation, Property 17: KB document validation
// Feature: ai-report-validation, Property 18: KB document S3 key prefix by category

/**
 * Property-based tests for Knowledge Base document validation and S3 key construction.
 *
 * Property 17: For any file, the KB document upload validator SHALL accept it if and only if
 * its MIME type is one of [application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document]
 * AND its size is less than or equal to 50 MB (52,428,800 bytes).
 *
 * Property 18: For any KBDocumentCategory value, document ID, and file name,
 * `buildKBDocumentS3Key(category, id, name)` SHALL produce a key starting with the category
 * prefix ("worksafebc/", "bc-building-code/", "safety-standards/", or "canada-general/")
 * followed by the document ID and file name.
 *
 * **Validates: Requirements 13.2, 13.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateKBFileMetadata } from '../../../src/services/report-validation/kb-manager.js';
import { buildKBDocumentS3Key } from '../../../src/services/report-validation/utils.js';
import {
  ALLOWED_KB_MIME_TYPES,
  MAX_KB_FILE_SIZE,
} from '../../../src/services/report-validation/types.js';
import type { KBDocumentCategory } from '../../../src/services/report-validation/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_KB_MIME_TYPES: readonly string[] = ALLOWED_KB_MIME_TYPES;

const ALL_KB_CATEGORIES: KBDocumentCategory[] = [
  'worksafebc',
  'bc-building-code',
  'safety-standards',
  'canada-general',
];

const CATEGORY_PREFIX_MAP: Record<KBDocumentCategory, string> = {
  worksafebc: 'worksafebc/',
  'bc-building-code': 'bc-building-code/',
  'safety-standards': 'safety-standards/',
  'canada-general': 'canada-general/',
};

/** Common MIME types that are NOT valid for KB document uploads */
const INVALID_KB_MIME_TYPES = [
  'application/msword',
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
  'audio/mpeg',
  'video/mp4',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/rtf',
  'application/x-tar',
  'application/gzip',
] as const;

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for a valid KB MIME type (PDF or .docx only) */
const arbValidKBMimeType: fc.Arbitrary<string> = fc.constantFrom(...VALID_KB_MIME_TYPES);

/** Arbitrary for an invalid KB MIME type */
const arbInvalidKBMimeType: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...INVALID_KB_MIME_TYPES),
  fc.string({ minLength: 1, maxLength: 100 }).filter(
    (s) => !VALID_KB_MIME_TYPES.includes(s)
  ),
);

/** Arbitrary for a valid KB file size (1 byte to 50 MB inclusive) */
const arbValidKBFileSize: fc.Arbitrary<number> = fc.integer({
  min: 1,
  max: MAX_KB_FILE_SIZE,
});

/** Arbitrary for a file size that exceeds 50 MB */
const arbTooLargeKBFileSize: fc.Arbitrary<number> = fc.integer({
  min: MAX_KB_FILE_SIZE + 1,
  max: MAX_KB_FILE_SIZE * 4, // Up to 200 MB
});

/** Arbitrary for an invalid file size (0 or negative, or too large) */
const arbInvalidKBFileSize: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: -1000, max: 0 }),
  arbTooLargeKBFileSize,
);

/** Arbitrary for a KBDocumentCategory value */
const arbCategory: fc.Arbitrary<KBDocumentCategory> = fc.constantFrom(...ALL_KB_CATEGORIES);

/** Arbitrary for a document ID (non-empty alphanumeric string like a ULID) */
const arbDocumentId: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'0123456789ABCDEFGHJKMNPQRSTVWXYZ'.split('')),
  { minLength: 10, maxLength: 26 },
);

/** Arbitrary for a file name (non-empty, no path separators) */
const arbFileName: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_.'.split('')),
  { minLength: 1, maxLength: 100 },
).map((s) => s + '.pdf');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('KB Validation Property Tests', () => {
  // **Validates: Requirements 13.2**
  describe('Property 17: KB document validation', () => {
    it('accepts files with valid MIME types and valid size', () => {
      fc.assert(
        fc.property(arbValidKBMimeType, arbValidKBFileSize, (mimeType, fileSize) => {
          const result = validateKBFileMetadata(mimeType, fileSize);

          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('rejects files with invalid MIME types regardless of size', () => {
      fc.assert(
        fc.property(arbInvalidKBMimeType, arbValidKBFileSize, (mimeType, fileSize) => {
          const result = validateKBFileMetadata(mimeType, fileSize);

          expect(result).not.toBeNull();
          expect(result).toBeTypeOf('string');
        }),
        { numRuns: 100 },
      );
    });

    it('rejects files exceeding 50 MB regardless of MIME type', () => {
      fc.assert(
        fc.property(arbValidKBMimeType, arbTooLargeKBFileSize, (mimeType, fileSize) => {
          const result = validateKBFileMetadata(mimeType, fileSize);

          expect(result).not.toBeNull();
          expect(result).toBeTypeOf('string');
        }),
        { numRuns: 100 },
      );
    });

    it('rejects files with zero or negative size', () => {
      fc.assert(
        fc.property(
          arbValidKBMimeType,
          fc.oneof(fc.constant(0), fc.integer({ min: -1000, max: -1 })),
          (mimeType, fileSize) => {
            const result = validateKBFileMetadata(mimeType, fileSize);

            expect(result).not.toBeNull();
            expect(result).toBeTypeOf('string');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('accepts if and only if MIME type is valid AND size is in (0, 52428800]', () => {
      fc.assert(
        fc.property(
          fc.oneof(arbValidKBMimeType, arbInvalidKBMimeType),
          fc.oneof(arbValidKBFileSize, arbInvalidKBFileSize),
          (mimeType, fileSize) => {
            const result = validateKBFileMetadata(mimeType, fileSize);
            const isValidMime = VALID_KB_MIME_TYPES.includes(mimeType);
            const isValidSize = fileSize > 0 && fileSize <= MAX_KB_FILE_SIZE;

            if (isValidMime && isValidSize) {
              expect(result).toBeNull();
            } else {
              expect(result).not.toBeNull();
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('boundary: accepts exactly 52428800 bytes (50 MB maximum)', () => {
      fc.assert(
        fc.property(arbValidKBMimeType, (mimeType) => {
          const result = validateKBFileMetadata(mimeType, MAX_KB_FILE_SIZE);

          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('boundary: rejects 52428801 bytes (one above maximum)', () => {
      fc.assert(
        fc.property(arbValidKBMimeType, (mimeType) => {
          const result = validateKBFileMetadata(mimeType, MAX_KB_FILE_SIZE + 1);

          expect(result).not.toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it('exactly two MIME types are accepted for KB documents', () => {
      expect(VALID_KB_MIME_TYPES).toHaveLength(2);
      expect(VALID_KB_MIME_TYPES).toContain('application/pdf');
      expect(VALID_KB_MIME_TYPES).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });
  });

  // **Validates: Requirements 13.4**
  describe('Property 18: KB document S3 key prefix by category', () => {
    it('produces a key starting with the correct category prefix', () => {
      fc.assert(
        fc.property(arbCategory, arbDocumentId, arbFileName, (category, docId, fileName) => {
          const key = buildKBDocumentS3Key(category, docId, fileName);
          const expectedPrefix = CATEGORY_PREFIX_MAP[category];

          expect(key.startsWith(expectedPrefix)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('contains the document ID after the category prefix', () => {
      fc.assert(
        fc.property(arbCategory, arbDocumentId, arbFileName, (category, docId, fileName) => {
          const key = buildKBDocumentS3Key(category, docId, fileName);
          const prefix = CATEGORY_PREFIX_MAP[category];
          const afterPrefix = key.slice(prefix.length);

          expect(afterPrefix.startsWith(docId)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('contains the file name after the document ID', () => {
      fc.assert(
        fc.property(arbCategory, arbDocumentId, arbFileName, (category, docId, fileName) => {
          const key = buildKBDocumentS3Key(category, docId, fileName);

          expect(key.endsWith(fileName)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('produces the exact format: {category}/{documentId}/{fileName}', () => {
      fc.assert(
        fc.property(arbCategory, arbDocumentId, arbFileName, (category, docId, fileName) => {
          const key = buildKBDocumentS3Key(category, docId, fileName);
          const expectedKey = `${category}/${docId}/${fileName}`;

          expect(key).toBe(expectedKey);
        }),
        { numRuns: 100 },
      );
    });

    it('all four categories produce distinct prefixes', () => {
      const prefixes = ALL_KB_CATEGORIES.map((cat) => CATEGORY_PREFIX_MAP[cat]);
      const uniquePrefixes = new Set(prefixes);

      expect(uniquePrefixes.size).toBe(4);
    });

    it('key always contains exactly two forward slashes (category/id/name)', () => {
      fc.assert(
        fc.property(arbCategory, arbDocumentId, arbFileName, (category, docId, fileName) => {
          const key = buildKBDocumentS3Key(category, docId, fileName);
          const slashCount = (key.match(/\//g) || []).length;

          expect(slashCount).toBe(2);
        }),
        { numRuns: 100 },
      );
    });
  });
});
