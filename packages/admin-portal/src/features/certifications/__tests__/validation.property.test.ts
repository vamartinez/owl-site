// Feature: worker-certification-upload, Property 3: Date ordering validation
// Feature: worker-certification-upload, Property 4: Document file validation
// Feature: worker-certification-upload, Property 9: Rejection reason minimum length

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  certificationFormSchema,
  rejectionReasonSchema,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
} from '../schemas';
import { CertificationType } from '../types';

/**
 * Helper to create a mock File object with specific type and size.
 */
function createMockFile(name: string, size: number, mimeType: string): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type: mimeType });
}

/**
 * Helper to build valid base form data for the certification schema.
 * Only the fields under test are varied; others use known-valid values.
 */
function validBaseFormData(overrides: Partial<{
  issue_date: string;
  expiry_date: string;
  document: File;
}> = {}) {
  return {
    certification_type: CertificationType.WHMIS_2015,
    issuer: 'Test Issuer',
    issue_date: overrides.issue_date ?? '2023-01-01',
    expiry_date: overrides.expiry_date ?? '2025-01-01',
    document: overrides.document ?? createMockFile('cert.pdf', 1024, 'application/pdf'),
  };
}

describe('Validation Property Tests', () => {
  // **Validates: Requirements 2.4**
  describe('Property 3: Date ordering validation', () => {
    it('rejects when expiry_date <= issue_date', () => {
      fc.assert(
        fc.property(
          // Generate two dates where expiry is on or before issue
          fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
          fc.date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') }),
          (date1, date2) => {
            // Ensure expiry <= issue by sorting
            const [earlier, later] = date1 <= date2 ? [date1, date2] : [date2, date1];
            const issueDate = later.toISOString().split('T')[0]!;
            const expiryDate = earlier.toISOString().split('T')[0]!;

            // Only test when expiry <= issue (skip if they happen to produce expiry > issue after formatting)
            if (expiryDate >= issueDate) {
              // expiry_date is on or before issue_date — schema should reject
              const data = validBaseFormData({ issue_date: issueDate, expiry_date: expiryDate });
              const result = certificationFormSchema.safeParse(data);
              expect(result.success).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('accepts when expiry_date > issue_date', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2000-01-01'), max: new Date('2098-12-31') }),
          fc.integer({ min: 1, max: 3650 }), // days to add
          (issueDate, daysToAdd) => {
            const issueDateStr = issueDate.toISOString().split('T')[0]!;
            const expiryDate = new Date(issueDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
            const expiryDateStr = expiryDate.toISOString().split('T')[0]!;

            // Only test when expiry is strictly after issue
            if (expiryDateStr > issueDateStr) {
              const data = validBaseFormData({ issue_date: issueDateStr, expiry_date: expiryDateStr });
              const result = certificationFormSchema.safeParse(data);
              // The date refinement should pass (other validations are valid via base data)
              expect(result.success).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 2.6, 2.7**
  describe('Property 4: Document file validation', () => {
    const validMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    const invalidMimeTypes = [
      'application/msword',
      'text/plain',
      'image/gif',
      'image/webp',
      'application/zip',
      'video/mp4',
    ];

    it('accepts files with valid MIME type and size <= 10 MB', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...validMimeTypes),
          fc.integer({ min: 1, max: MAX_FILE_SIZE }),
          (mimeType, size) => {
            const file = createMockFile('document.pdf', size, mimeType);
            const data = validBaseFormData({ document: file });
            const result = certificationFormSchema.safeParse(data);
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects files with invalid MIME type', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...invalidMimeTypes),
          fc.integer({ min: 1, max: MAX_FILE_SIZE }),
          (mimeType, size) => {
            const file = createMockFile('document.txt', size, mimeType);
            const data = validBaseFormData({ document: file });
            const result = certificationFormSchema.safeParse(data);
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects files exceeding 10 MB', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...validMimeTypes),
          fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 3 }),
          (mimeType, size) => {
            const file = createMockFile('large-file.pdf', size, mimeType);
            const data = validBaseFormData({ document: file });
            const result = certificationFormSchema.safeParse(data);
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejects files with both invalid MIME type and size > 10 MB', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...invalidMimeTypes),
          fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 3 }),
          (mimeType, size) => {
            const file = createMockFile('bad-file.doc', size, mimeType);
            const data = validBaseFormData({ document: file });
            const result = certificationFormSchema.safeParse(data);
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 3.4**
  describe('Property 9: Rejection reason minimum length', () => {
    it('rejects strings shorter than 10 characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 9 }),
          (reason) => {
            const result = rejectionReasonSchema.safeParse({ rejection_reason: reason });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('accepts strings of 10 to 500 characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 500 }),
          (reason) => {
            const result = rejectionReasonSchema.safeParse({ rejection_reason: reason });
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
