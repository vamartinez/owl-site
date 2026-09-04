import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import { FORMS_QUERY_KEY } from './useFormsQuery';
import type { CreateFormRequest, CreateFormResponse } from '../types';

/**
 * Mutation hook for creating a new form.
 * Invalidates the forms list on success.
 */
export function useCreateForm() {
  const queryClient = useQueryClient();

  return useApiMutation<CreateFormResponse, CreateFormRequest>('post', '/forms', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FORMS_QUERY_KEY });
    },
  });
}
