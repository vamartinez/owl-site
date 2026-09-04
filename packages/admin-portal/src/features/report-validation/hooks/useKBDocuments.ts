import { useState, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import { useApiMutation } from '@/hooks/useApi';
import { useUploadToS3 } from './useUploadToS3';
import type { KBContextDocument, KBDocumentCategory } from '../types';

// --- List KB Documents ---

interface KBDocumentsListResponse {
  documents: KBContextDocument[];
}

/**
 * Fetches the list of Knowledge Base context documents.
 * Only accessible by tenant_admin role.
 *
 * Validates: Requirements 13.7
 */
export function useKBDocuments() {
  return useQuery<KBDocumentsListResponse, ApiClientError>({
    queryKey: ['kb-documents'],
    queryFn: () => apiClient.get<KBDocumentsListResponse>('/report-validation/kb/documents'),
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}

// --- Upload KB Document ---

export interface CreateKBDocumentRequest {
  file_name: string;
  file_size: number;
  mime_type: string;
  category: KBDocumentCategory;
}

interface CreateKBDocumentResponse {
  document_id: string;
  upload_url: string;
}

export interface UploadKBDocumentParams {
  metadata: CreateKBDocumentRequest;
  file: File;
}

export interface UseCreateKBDocumentReturn {
  createDocument: (params: UploadKBDocumentParams) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  uploadProgress: number;
  isUploading: boolean;
  reset: () => void;
}

/**
 * Hook that orchestrates the two-step KB document upload flow:
 * 1. POST metadata to API → receive presigned upload URL
 * 2. PUT file to S3 via presigned URL
 *
 * On success, invalidates the KB documents query to refresh the list.
 *
 * Validates: Requirements 13.7
 */
export function useCreateKBDocument(): UseCreateKBDocumentReturn {
  const queryClient = useQueryClient();
  const { upload, progress, isUploading, error: uploadError } = useUploadToS3();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const mutation = useApiMutation<CreateKBDocumentResponse, CreateKBDocumentRequest>(
    'post',
    '/report-validation/kb/documents'
  );

  const mutationRef = useRef(mutation);
  mutationRef.current = mutation;

  const createDocument = useCallback(
    async ({ metadata, file }: UploadKBDocumentParams): Promise<void> => {
      setError(null);
      setIsLoading(true);

      try {
        // Step 1: POST metadata to get presigned URL
        const response = await mutationRef.current.mutateAsync(metadata);

        // Step 2: Upload file to S3 using the presigned URL
        await upload(file, response.upload_url);

        // Step 3: Invalidate KB documents query to refresh the list
        await queryClient.invalidateQueries({ queryKey: ['kb-documents'] });
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
    createDocument,
    isLoading: isLoading || mutation.isPending,
    error: error || uploadError,
    uploadProgress: progress,
    isUploading,
    reset,
  };
}

// --- Delete KB Document ---

interface DeleteKBDocumentVariables {
  documentId: string;
}

/**
 * Hook to delete a Knowledge Base context document.
 * On success, invalidates the KB documents query to refresh the list.
 *
 * Validates: Requirements 13.7
 */
export function useDeleteKBDocument() {
  const queryClient = useQueryClient();

  const mutation = useApiMutation<void, DeleteKBDocumentVariables>(
    'delete',
    (variables) => `/report-validation/kb/documents/${variables.documentId}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['kb-documents'] });
      },
    }
  );

  const deleteDocument = useCallback(
    async (documentId: string) => {
      return mutation.mutateAsync({ documentId });
    },
    [mutation]
  );

  return {
    deleteDocument,
    isLoading: mutation.isPending,
    error: mutation.error?.message ?? null,
    reset: mutation.reset,
  };
}
