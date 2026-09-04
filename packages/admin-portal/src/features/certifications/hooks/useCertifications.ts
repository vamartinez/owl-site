import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import type { Certification } from '../types';

interface CertificationsApiResponse {
  certifications: Certification[];
}

/**
 * Fetches certifications for a given worker and returns them
 * sorted by expiry_date in ascending order (earliest first).
 */
export function useCertifications(workerId: string) {
  return useQuery<Certification[], ApiClientError>({
    queryKey: ['certifications', workerId],
    queryFn: async () => {
      const response = await apiClient.get<CertificationsApiResponse>(
        `/workers/${workerId}/certifications`
      );
      return response.certifications;
    },
    enabled: !!workerId,
    select: (data: Certification[]) =>
      [...data].sort(
        (a, b) =>
          new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()
      ),
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
