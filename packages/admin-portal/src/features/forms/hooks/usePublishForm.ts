import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import { FORMS_QUERY_KEY } from './useFormsQuery';
import type { PublishFormResponse } from '../types';

interface PublishFormVariables {
  formId: string;
}

/**
 * Mutation hook for publishing a draft form.
 * Invalidates forms list and the specific form query on success.
 */
export function usePublishForm() {
  const queryClient = useQueryClient();

  return useApiMutation<PublishFormResponse, PublishFormVariables>(
    'post',
    (variables) => `/forms/${variables.formId}/publish`,
    {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: FORMS_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ['forms', variables.formId] });
      },
    }
  );
}
