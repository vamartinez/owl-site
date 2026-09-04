import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import type { CreateIncidentRequest, CreateIncidentResponse } from '../types';

/**
 * Mutation hook for creating a new incident.
 * On success, invalidates the incidents list query to refresh data.
 *
 * Requirements: 1.1
 */
export function useCreateIncident() {
  const queryClient = useQueryClient();

  return useApiMutation<CreateIncidentResponse, CreateIncidentRequest>(
    'post',
    '/incidents',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['incidents'] });
      },
    }
  );
}
