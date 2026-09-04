import { useQuery } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { getFormResponseDetail } from '../api';
import type { GetFormResponseDetailResponse } from '../types';

/**
 * Fetches the detail of a single form response, including the version schema.
 * Only enabled when both formId and responseId are provided.
 */
export function useFormResponseDetail(
  formId: string | undefined,
  responseId: string | undefined
) {
  return useQuery<GetFormResponseDetailResponse, ApiClientError>({
    queryKey: ['forms', formId, 'responses', responseId],
    queryFn: () => getFormResponseDetail(formId!, responseId!),
    enabled: !!formId && !!responseId,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
