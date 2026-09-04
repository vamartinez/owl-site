import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import { FORMS_QUERY_KEY } from './useFormsQuery';
import type { UpdateFormRequest, UpdateFormResponse } from '../types';

interface UpdateFormVariables extends UpdateFormRequest {
  formId: string;
}

/**
 * Mutation hook for updating a draft form.
 * Invalidates both the forms list and the specific form query on success.
 */
export function useUpdateForm() {
  const queryClient = useQueryClient();

  return useApiMutation<UpdateFormResponse, UpdateFormVariables>(
    'patch',
    (variables) => `/forms/${variables.formId}`,
    {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: FORMS_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ['forms', variables.formId] });
      },
    }
  );
}
