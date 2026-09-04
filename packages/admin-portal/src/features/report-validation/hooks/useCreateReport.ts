import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import { useUploadToS3 } from './useUploadToS3';

export interface CreateReportRequest {
  file_name: string;
  file_size: number;
  mime_type: string;
}

export interface CreateReportResponse {
  report_id: string;
  upload_url: string;
  status: 'draft';
  created_at: string;
}

export interface CreateReportParams {
  metadata: CreateReportRequest;
  file: File;
}

export interface UseCreateReportReturn {
  createReport: (params: CreateReportParams) => Promise<CreateReportResponse>;
  isLoading: boolean;
  error: string | null;
  uploadProgress: number;
  isUploading: boolean;
  reset: () => void;
}

/**
 * Hook that orchestrates the two-step report creation flow:
 * 1. POST metadata to API → receive presigned upload URL
 * 2. PUT file to S3 via presigned URL
 *
 * On success, invalidates the reports query to refresh the list.
 *
 * Validates: Requirements 3.1
 */
export function useCreateReport(): UseCreateReportReturn {
  const queryClient = useQueryClient();
  const { upload, progress, isUploading, error: uploadError } = useUploadToS3();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const mutation = useApiMutation<CreateReportResponse, CreateReportRequest>(
    'post',
    '/report-validation/reports'
  );

  const mutationRef = useRef(mutation);
  mutationRef.current = mutation;

  const createReport = useCallback(
    async ({ metadata, file }: CreateReportParams): Promise<CreateReportResponse> => {
      setError(null);
      setIsLoading(true);

      try {
        // Step 1: POST metadata to get presigned URL
        const response = await mutationRef.current.mutateAsync(metadata);

        // Step 2: Upload file to S3 using the presigned URL
        await upload(file, response.upload_url);

        // Step 3: Invalidate reports query to refresh the list
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
    [upload, queryClient]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsLoading(false);
    mutationRef.current.reset();
  }, []);

  return {
    createReport,
    isLoading: isLoading || mutation.isPending,
    error: error || uploadError,
    uploadProgress: progress,
    isUploading,
    reset,
  };
}
