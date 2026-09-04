import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/api-client';
import { useUploadToS3 } from '@/features/certifications/hooks/useUploadToS3';
import type { InitiateAttachmentRequest, InitiateAttachmentResponse } from '../types';

export interface UseEvidenceUploadOptions {
  incidentId: string;
}

export interface UploadEvidenceParams {
  file: File;
  durationSeconds?: number;
}

export interface UseEvidenceUploadReturn {
  uploadEvidence: (params: UploadEvidenceParams) => Promise<void>;
  confirmUpload: (attachmentId: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  uploadProgress: number;
  isUploading: boolean;
  reset: () => void;
}

/**
 * Hook that orchestrates the evidence upload flow:
 * 1. POST metadata to API → receive presigned URL and attachment_id
 * 2. PUT file to S3 via presigned URL (with progress tracking)
 * 3. PATCH to confirm upload completion
 *
 * Reuses the useUploadToS3 pattern from certifications.
 * On success, invalidates the incident query to refresh attachments.
 *
 * Requirements: 12.4
 */
export function useEvidenceUpload({
  incidentId,
}: UseEvidenceUploadOptions): UseEvidenceUploadReturn {
  const queryClient = useQueryClient();
  const { upload, progress, isUploading, error: uploadError } = useUploadToS3();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const incidentIdRef = useRef(incidentId);
  incidentIdRef.current = incidentId;

  const uploadEvidence = useCallback(
    async ({ file, durationSeconds }: UploadEvidenceParams): Promise<void> => {
      setError(null);
      setIsLoading(true);

      try {
        // Step 1: POST metadata to get presigned URL
        const metadata: InitiateAttachmentRequest = {
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          duration_seconds: durationSeconds,
        };

        const response = await apiClient.post<InitiateAttachmentResponse>(
          `/incidents/${incidentIdRef.current}/attachments`,
          metadata
        );

        // Step 2: Upload file to S3 using the presigned URL
        await upload(file, response.upload_url);

        // Step 3: Confirm upload completion
        await apiClient.patch(
          `/incidents/${incidentIdRef.current}/attachments/${response.attachment_id}/confirm`,
          {}
        );

        // Step 4: Invalidate queries to refresh data
        await queryClient.invalidateQueries({ queryKey: ['incidents', incidentIdRef.current] });
        await queryClient.invalidateQueries({ queryKey: ['incidents', incidentIdRef.current, 'timeline'] });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [upload, queryClient]
  );

  const confirmUpload = useCallback(
    async (attachmentId: string): Promise<void> => {
      await apiClient.patch(
        `/incidents/${incidentIdRef.current}/attachments/${attachmentId}/confirm`,
        {}
      );
      await queryClient.invalidateQueries({ queryKey: ['incidents', incidentIdRef.current] });
    },
    [queryClient]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    uploadEvidence,
    confirmUpload,
    isLoading,
    error: error || uploadError,
    uploadProgress: progress,
    isUploading,
    reset,
  };
}
