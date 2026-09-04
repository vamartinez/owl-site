// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { reportUploadSchema } from '../schemas';

// ─── Schema validation tests (no component rendering, avoids memory issues) ──

describe('ReportUploadForm - file type validation', () => {
  function createFile(name: string, size: number, type: string): File {
    const content = 'x'.repeat(Math.min(size, 100));
    const file = new File([content], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  }

  describe('validates file type', () => {
    it('accepts PDF files', () => {
      const file = createFile('report.pdf', 5000, 'application/pdf');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(true);
    });

    it('accepts .docx files', () => {
      const file = createFile('report.docx', 5000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(true);
    });

    it('accepts .doc files', () => {
      const file = createFile('report.doc', 5000, 'application/msword');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(true);
    });

    it('rejects text/plain files', () => {
      const file = createFile('report.txt', 5000, 'text/plain');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]!.message).toContain('PDF');
      }
    });

    it('rejects image files', () => {
      const file = createFile('report.png', 5000, 'image/png');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(false);
    });

    it('rejects application/json files', () => {
      const file = createFile('data.json', 5000, 'application/json');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(false);
    });
  });

  describe('validates file size', () => {
    it('rejects files smaller than 1 KB', () => {
      const file = createFile('report.pdf', 500, 'application/pdf');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]!.message).toContain('at least 1 KB');
      }
    });

    it('accepts files exactly 1 KB (1024 bytes)', () => {
      const file = createFile('report.pdf', 1024, 'application/pdf');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(true);
    });

    it('accepts files exactly 25 MB', () => {
      const file = createFile('report.pdf', 25 * 1024 * 1024, 'application/pdf');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(true);
    });

    it('rejects files larger than 25 MB', () => {
      const file = createFile('report.pdf', 25 * 1024 * 1024 + 1, 'application/pdf');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]!.message).toContain('25 MB');
      }
    });

    it('rejects zero-byte files', () => {
      const file = createFile('report.pdf', 0, 'application/pdf');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(false);
    });
  });

  describe('handles upload success/failure scenarios', () => {
    it('valid file passes all validation rules', () => {
      const file = createFile('safety-report.pdf', 2 * 1024 * 1024, 'application/pdf');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(true);
    });

    it('invalid type is caught before size check', () => {
      const file = createFile('report.txt', 5000, 'text/plain');
      const result = reportUploadSchema.safeParse({ document: file });
      expect(result.success).toBe(false);
      if (!result.success) {
        // First error should be about file type
        expect(result.error.errors[0]!.message).toContain('PDF');
      }
    });
  });
});
