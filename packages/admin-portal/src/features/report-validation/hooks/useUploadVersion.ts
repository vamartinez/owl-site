import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import { useUploadToS3 } from './useUploadToS3';

export interface UploadVersionRequest {
  file_name: string;
  file_size: number;
  mime_type: string;
}

export interface UploadVersionResponse {
  report_id: string;
  version: number;
  upload_url: string;
  status: 'draft';
}

export interface UploadVersionParams {
  metadata: UploadVersionRequest;
  file: File;
}

export interface UseUploadVersionReturn {
  uploadVersion: (params: UploadVersionParams) => Promise<UploadVersionResponse>;
  isLoading: boolean;
  error: string | null;
  uploadProgress: number;
  isUploading: boolean;
  reset: () => void;
}

/**
 * Hook that orchestrates the two-step version upload flow:
 * 1. POST metadata to API → receive presigned upload URL + new version number
 * 2. PUT file to S3 via presigned URL
 *
 * On success, invalidates report detail and history queries.
 *
 * Validates: Requirements 6.5
 */
export function useUploadVersion(reportId: string): UseUploadVersionReturn {
  const queryClient = useQueryClient();
  const { upload, progress, isUploading, error: uploadError } = useUploadToS3();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const mutation = useApiMutation<UploadVersionResponse, UploadVersionRequest>(
    'post',
    `/report-validation/reports/${reportId}/versions`
  );

  const mutationRef = useRef(mutation);
  mutationRef.current = mutation;

  const uploadVersion = useCallback(
    async ({ metadata, file }: UploadVersionParams): Promise<UploadVersionResponse> => {
      setError(null);
      setIsLoading(true);

      try {
        // Step 1: POST metadata to get presigned URL
        const response = await mutationRef.current.mutateAsync(metadata);

        // Step 2: Upload file to S3 using the presigned URL
        await upload(file, response.upload_url);

        // Step 3: Invalidate queries to refresh report detail and history
        await queryClient.invalidateQueries({ queryKey: ['report', reportId] });
        await queryClient.invalidateQueries({ queryKey: ['report-history', reportId] });
        await queryClient.invalidateQueries({ queryKey: ['reports'] });

        return response;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [upload, queryClient, reportId]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsLoading(false);
    mutationRef.current.reset();
  }, []);

  return {
    uploadVersion,
    isLoading: isLoading || mutation.isPending,
    error: error || uploadError,
    uploadProgress: progress,
    isUploading,
    reset,
  };
}
