import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import type { Incident, UpdateIncidentRequest } from '../types';

interface UpdateIncidentVariables extends UpdateIncidentRequest {
  incidentId: string;
}

interface MutationContext {
  previousIncident: Incident | undefined;
}

/**
 * Mutation hook for updating an existing incident.
 * Implements optimistic update with rollback on error.
 *
 * Requirements: 5.3, 14.1
 */
export function useUpdateIncident() {
  const queryClient = useQueryClient();

  return useApiMutation<Incident, UpdateIncidentVariables>(
    'patch',
    (variables) => `/incidents/${variables.incidentId}`,
    {
      onMutate: async (variables) => {
        const queryKey = ['incidents', variables.incidentId];

        // Cancel any outgoing refetches so they don't overwrite our optimistic update
        await queryClient.cancelQueries({ queryKey });

        // Snapshot the previous value
        const previousIncident = queryClient.getQueryData<Incident>(queryKey);

        // Optimistically update the cache
        if (previousIncident) {
          queryClient.setQueryData<Incident>(queryKey, {
            ...previousIncident,
            ...variables,
            updated_at: new Date().toISOString(),
          });
        }

        return { previousIncident } as MutationContext;
      },

      onError: (_error, variables, context) => {
        // Rollback to the snapshot on error
        const ctx = context as MutationContext | undefined;
        if (ctx?.previousIncident) {
          queryClient.setQueryData<Incident>(
            ['incidents', variables.incidentId],
            ctx.previousIncident
          );
        }
      },

      onSettled: (_data, _error, variables) => {
        // Always invalidate to ensure consistency with the server
        queryClient.invalidateQueries({ queryKey: ['incidents', variables.incidentId] });
        queryClient.invalidateQueries({ queryKey: ['incidents'] });
      },
    }
  );
}
