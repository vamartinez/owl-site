import { z } from 'zod';

export const ALLOWED_REPORT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
] as const;

export const MIN_FILE_SIZE = 1024; // 1 KB
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

export const reportUploadSchema = z.object({
  document: z
    .instanceof(File)
    .refine(
      (f) => ALLOWED_REPORT_MIME_TYPES.includes(f.type as any),
      { message: 'File must be PDF, .docx, or .doc format' }
    )
    .refine(
      (f) => f.size >= MIN_FILE_SIZE,
      { message: 'File must be at least 1 KB' }
    )
    .refine(
      (f) => f.size <= MAX_FILE_SIZE,
      { message: 'File must not exceed 25 MB' }
    ),
});

export const kbDocumentUploadSchema = z.object({
  document: z
    .instanceof(File)
    .refine(
      (f) =>
        ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(f.type),
      { message: 'File must be PDF or .docx format' }
    )
    .refine(
      (f) => f.size <= 50 * 1024 * 1024,
      { message: 'File must not exceed 50 MB' }
    ),
  category: z.enum(['worksafebc', 'bc-building-code', 'safety-standards', 'canada-general']),
});

export type ReportUploadData = z.infer<typeof reportUploadSchema>;
export type KBDocumentUploadData = z.infer<typeof kbDocumentUploadSchema>;
