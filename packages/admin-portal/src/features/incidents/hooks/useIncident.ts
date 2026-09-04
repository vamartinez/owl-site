import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import type { Incident } from '../types';

/**
 * Fetches a single incident by ID.
 * Only fetches when incidentId is provided (truthy).
 *
 * Requirements: 1.1
 */
export function useIncident(incidentId: string | undefined) {
  return useQuery<Incident, ApiClientError>({
    queryKey: ['incidents', incidentId],
    queryFn: async () => {
      return apiClient.get<Incident>(`/incidents/${incidentId}`);
    },
    enabled: !!incidentId,
    retry: (failureCount, error) => {
      if (error.status === 404) return false;
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
