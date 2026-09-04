import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import { useAuthStore } from '@/store/auth-store';
import type { IncidentComment, AddCommentRequest, ListCommentsResponse } from '../types';

interface CommentsApiResponse {
  comments: IncidentComment[];
}

interface AddCommentVariables extends AddCommentRequest {
  incidentId: string;
}

interface MutationContext {
  previousComments: ListCommentsResponse | undefined;
}

/**
 * Fetches comments for an incident in ascending chronological order.
 *
 * Requirements: 14.2
 */
export function useIncidentComments(incidentId: string | undefined) {
  return useQuery<IncidentComment[], ApiClientError>({
    queryKey: ['incidents', incidentId, 'comments'],
    queryFn: async () => {
      const response = await apiClient.get<CommentsApiResponse>(
        `/incidents/${incidentId}/comments`
      );
      return response.comments;
    },
    enabled: !!incidentId,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}

/**
 * Mutation hook for adding a comment to an incident.
 * Implements optimistic append with rollback on error.
 *
 * Requirements: 14.1
 */
export function useAddComment() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  return useMutation<IncidentComment, ApiClientError, AddCommentVariables, MutationContext>({
    mutationFn: async (variables) => {
      return apiClient.post<IncidentComment>(
        `/incidents/${variables.incidentId}/comments`,
        { content: variables.content }
      );
    },

    onMutate: async (variables) => {
      const queryKey = ['incidents', variables.incidentId, 'comments'];

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousComments = queryClient.getQueryData<ListCommentsResponse>(queryKey);

      // Optimistically append the new comment
      const optimisticComment: IncidentComment = {
        comment_id: `temp-${Date.now()}`,
        incident_id: variables.incidentId,
        tenant_id: '',
        author_id: user?.id || '',
        author_name: user?.name || user?.email || 'You',
        content: variables.content,
        created_at: new Date().toISOString(),
      };

      queryClient.setQueryData<ListCommentsResponse>(queryKey, [
        ...(previousComments || []),
        optimisticComment,
      ]);

      return { previousComments };
    },

    onError: (_error, variables, context) => {
      // Rollback to the snapshot on error
      if (context?.previousComments) {
        queryClient.setQueryData<ListCommentsResponse>(
          ['incidents', variables.incidentId, 'comments'],
          context.previousComments
        );
      }
    },

    onSettled: (_data, _error, variables) => {
      // Always invalidate to ensure consistency with the server
      queryClient.invalidateQueries({ queryKey: ['incidents', variables.incidentId, 'comments'] });
      // Timeline will have a new comment_added event
      queryClient.invalidateQueries({ queryKey: ['incidents', variables.incidentId, 'timeline'] });
    },
  });
}
