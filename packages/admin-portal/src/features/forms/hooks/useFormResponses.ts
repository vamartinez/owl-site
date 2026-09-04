import { useQuery } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { listFormResponses } from '../api';
import type { ListFormResponsesParams, ListFormResponsesResponse } from '../types';

/**
 * Fetches paginated and filtered responses for a form.
 * Only enabled when formId is provided.
 */
export function useFormResponses(
  formId: string | undefined,
  params?: ListFormResponsesParams
) {
  return useQuery<ListFormResponsesResponse, ApiClientError>({
    queryKey: ['forms', formId, 'responses', params],
    queryFn: () => listFormResponses(formId!, params),
    enabled: !!formId,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
