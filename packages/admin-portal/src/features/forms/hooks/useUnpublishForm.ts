import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import { FORMS_QUERY_KEY } from './useFormsQuery';
import type { UnpublishFormResponse } from '../types';

interface UnpublishFormVariables {
  formId: string;
}

/**
 * Mutation hook for unpublishing a published form.
 * Invalidates forms list and the specific form query on success.
 */
export function useUnpublishForm() {
  const queryClient = useQueryClient();

  return useApiMutation<UnpublishFormResponse, UnpublishFormVariables>(
    'post',
    (variables) => `/forms/${variables.formId}/unpublish`,
    {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: FORMS_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ['forms', variables.formId] });
      },
    }
  );
}
