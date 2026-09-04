import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import { FORMS_QUERY_KEY } from './useFormsQuery';
import type { DuplicateFormResponse } from '../types';

interface DuplicateFormVariables {
  formId: string;
}

/**
 * Mutation hook for duplicating a form.
 * Invalidates the forms list on success to show the new copy.
 */
export function useDuplicateForm() {
  const queryClient = useQueryClient();

  return useApiMutation<DuplicateFormResponse, DuplicateFormVariables>(
    'post',
    (variables) => `/forms/${variables.formId}/duplicate`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: FORMS_QUERY_KEY });
      },
    }
  );
}
