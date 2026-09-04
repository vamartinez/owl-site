import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import type { Incident, IncidentStatus, StateTransitionRequest } from '../types';

interface StateTransitionVariables extends StateTransitionRequest {
  incidentId: string;
}

interface MutationContext {
  previousIncident: Incident | undefined;
}

/**
 * Mutation hook for transitioning an incident's state.
 * Implements optimistic update with rollback on error.
 *
 * On 422 (invalid transition), the error response includes valid transitions
 * which can be displayed to the user.
 *
 * Requirements: 5.3
 */
export function useStateTransition() {
  const queryClient = useQueryClient();

  return useApiMutation<Incident, StateTransitionVariables>(
    'patch',
    (variables) => `/incidents/${variables.incidentId}/state`,
    {
      onMutate: async (variables) => {
        const queryKey = ['incidents', variables.incidentId];

        // Cancel any outgoing refetches
        await queryClient.cancelQueries({ queryKey });

        // Snapshot the previous value
        const previousIncident = queryClient.getQueryData<Incident>(queryKey);

        // Optimistically update the status in cache
        if (previousIncident) {
          queryClient.setQueryData<Incident>(queryKey, {
            ...previousIncident,
            status: variables.status,
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
        // Timeline will have a new state_change event
        queryClient.invalidateQueries({ queryKey: ['incidents', variables.incidentId, 'timeline'] });
      },
    }
  );
}
