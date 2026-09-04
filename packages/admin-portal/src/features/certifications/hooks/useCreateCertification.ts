import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import { useUploadToS3 } from './useUploadToS3';
import type { CreateCertificationRequest, CreateCertificationResponse } from '../types';

export interface UseCreateCertificationOptions {
  workerId: string;
}

export interface CreateCertificationParams {
  metadata: CreateCertificationRequest;
  file: File;
}

export interface UseCreateCertificationReturn {
  createCertification: (params: CreateCertificationParams) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  uploadProgress: number;
  isUploading: boolean;
  reset: () => void;
}

/**
 * Hook that orchestrates the two-step certification creation flow:
 * 1. POST metadata to API → receive signed upload URL
 * 2. PUT file to S3 via signed URL
 *
 * On success, invalidates the certifications query to refresh the list.
 */
export function useCreateCertification({
  workerId,
}: UseCreateCertificationOptions): UseCreateCertificationReturn {
  const queryClient = useQueryClient();
  const { upload, progress, isUploading, error: uploadError } = useUploadToS3();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const mutation = useApiMutation<CreateCertificationResponse, CreateCertificationRequest>(
    'post',
    `/workers/${workerId}/certifications`
  );

  // Use a ref to avoid including mutation in useCallback dependencies
  const mutationRef = useRef(mutation);
  mutationRef.current = mutation;

  const createCertification = useCallback(
    async ({ metadata, file }: CreateCertificationParams): Promise<void> => {
      setError(null);
      setIsLoading(true);

      try {
        // Step 1: POST metadata to get signed URL
        const response = await mutationRef.current.mutateAsync(metadata);

        // Step 2: Upload file to S3 using the signed URL
        await upload(file, response.upload_url);

        // Step 3: Invalidate certifications query to refresh the list
        await queryClient.invalidateQueries({ queryKey: ['certifications', workerId] });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [upload, queryClient, workerId]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsLoading(false);
    mutationRef.current.reset();
  }, []);

  return {
    createCertification,
    isLoading: isLoading || mutation.isPending,
    error: error || uploadError,
    uploadProgress: progress,
    isUploading,
    reset,
  };
}
