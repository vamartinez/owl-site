import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import type { TimelineEvent } from '../types';

interface TimelineApiResponse {
  events: TimelineEvent[];
}

/**
 * Fetches the immutable timeline (audit trail) for an incident.
 * Returns events in chronological order.
 *
 * Requirements: 15.2
 */
export function useIncidentTimeline(incidentId: string | undefined) {
  return useQuery<TimelineEvent[], ApiClientError>({
    queryKey: ['incidents', incidentId, 'timeline'],
    queryFn: async () => {
      const response = await apiClient.get<TimelineApiResponse>(
        `/incidents/${incidentId}/timeline`
      );
      return response.events;
    },
    enabled: !!incidentId,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
