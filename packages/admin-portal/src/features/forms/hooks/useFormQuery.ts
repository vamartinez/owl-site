import { useQuery } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { getForm } from '../api';
import type { Form } from '../types';

/**
 * Fetches a single form by ID.
 * Only enabled when formId is provided.
 */
export function useFormQuery(formId: string | undefined) {
  return useQuery<Form, ApiClientError>({
    queryKey: ['forms', formId],
    queryFn: async () => {
      const response = await getForm(formId!);
      return response.form;
    },
    enabled: !!formId,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
