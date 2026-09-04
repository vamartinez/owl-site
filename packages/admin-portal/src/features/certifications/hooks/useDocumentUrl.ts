import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';

interface DocumentUrlResponse {
  url: string;
  content_type: string;
}

/**
 * Fetches a signed URL for viewing a certification document.
 * Only fetches when `enabled` is true (i.e., when the viewer modal is open).
 */
export function useDocumentUrl(
  workerId: string,
  certificationId: string,
  enabled: boolean
) {
  return useQuery<DocumentUrlResponse, ApiClientError>({
    queryKey: ['document-url', workerId, certificationId],
    queryFn: async () => {
      return apiClient.get<DocumentUrlResponse>(
        `/workers/${workerId}/certifications/${certificationId}/document-url`
      );
    },
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes (less than URL expiry of 15 min)
    retry: (failureCount, error) => {
      if (error.status === 404) return false;
      return failureCount < 2;
    },
  });
}
