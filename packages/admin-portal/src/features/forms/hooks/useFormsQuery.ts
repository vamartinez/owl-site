import { useQuery } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { listForms } from '../api';
import type { Form } from '../types';

export const FORMS_QUERY_KEY = ['forms'];

/**
 * Fetches all forms for the current tenant.
 * Supports optional status filter.
 */
export function useFormsQuery(params?: { status?: string }) {
  const queryParams: Record<string, string> = {};
  if (params?.status) queryParams.status = params.status;

  return useQuery<Form[], ApiClientError>({
    queryKey: [...FORMS_QUERY_KEY, params],
    queryFn: async () => {
      const response = await listForms(
        Object.keys(queryParams).length > 0 ? queryParams : undefined
      );
      return response.forms;
    },
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
