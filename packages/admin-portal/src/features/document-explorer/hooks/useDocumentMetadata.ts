import { useQuery } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { fetchDocumentMetadata } from '../api';
import type { DocumentMetadataResponse } from '../types';

/**
 * Fetches full metadata for a single document.
 * Query is enabled only when a valid documentId is provided.
 */
export function useDocumentMetadata(documentId: string | null) {
  return useQuery<DocumentMetadataResponse, ApiClientError>({
    queryKey: ['document-explorer', 'metadata', documentId],
    queryFn: () => fetchDocumentMetadata(documentId!),
    enabled: documentId !== null,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
