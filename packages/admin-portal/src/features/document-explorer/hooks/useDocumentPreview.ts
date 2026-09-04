import { useQuery } from '@tanstack/react-query';
import { type ApiClientError } from '@/services/api-client';
import { fetchDocumentPreview } from '../api';
import { useDocExplorerStore } from '../store';
import { isPreviewable } from '../utils';

interface UseDocumentPreviewOptions {
  mimeType: string | undefined;
}

/**
 * Fetches a presigned preview URL for the currently selected document.
 * Only enabled when previewDocumentId is set and the document's mimeType is previewable.
 */
export function useDocumentPreview({ mimeType }: UseDocumentPreviewOptions) {
  const previewDocumentId = useDocExplorerStore((s) => s.previewDocumentId);

  const enabled =
    previewDocumentId !== null &&
    mimeType !== undefined &&
    isPreviewable(mimeType);

  const { data, isLoading, isError } = useQuery<
    { previewUrl: string; expiresAt: string },
    ApiClientError
  >({
    queryKey: ['document-explorer', 'preview', previewDocumentId],
    queryFn: () => fetchDocumentPreview(previewDocumentId!),
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes (less than presigned URL expiry)
    retry: (failureCount, error) => {
      if (error.status === 404) return false;
      return failureCount < 2;
    },
  });

  return {
    previewUrl: data?.previewUrl ?? null,
    expiresAt: data?.expiresAt ?? null,
    isLoading: enabled && isLoading,
    isError,
  };
}
