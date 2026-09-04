import { z } from 'zod';
import { CertificationType } from './types';

export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const certificationFormSchema = z
  .object({
    certification_type: z.nativeEnum(CertificationType),
    issuer: z.string().min(1, 'Issuer is required').max(200),
    issue_date: z.string().min(1, 'Issue date is required'),
    expiry_date: z.string().min(1, 'Expiry date is required'),
    document: z
      .instanceof(File)
      .refine((f) => ALLOWED_MIME_TYPES.includes(f.type as any), {
        message: 'File must be PDF, JPEG, or PNG',
      })
      .refine((f) => f.size <= MAX_FILE_SIZE, {
        message: 'File must not exceed 10 MB',
      }),
  })
  .refine((data) => new Date(data.expiry_date) > new Date(data.issue_date), {
    message: 'Expiry date must be after issue date',
    path: ['expiry_date'],
  });

export const rejectionReasonSchema = z.object({
  rejection_reason: z
    .string()
    .min(10, 'Rejection reason must be at least 10 characters')
    .max(500),
});

export type CertificationFormData = z.infer<typeof certificationFormSchema>;
export type RejectionReasonData = z.infer<typeof rejectionReasonSchema>;
