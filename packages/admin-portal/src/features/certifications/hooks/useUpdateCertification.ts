import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import type {
  Certification,
  UpdateCertificationRequest,
  ListCertificationsResponse,
} from '../types';

interface UpdateCertificationVariables extends UpdateCertificationRequest {
  certId: string;
}

interface MutationContext {
  previousCertifications: ListCertificationsResponse | undefined;
}

/**
 * Wraps useApiMutation for PATCH /workers/{id}/certifications/{certId}.
 * Implements optimistic update with rollback on error.
 *
 * Requirements: 3.2, 3.5, 3.6
 */
export function useUpdateCertification(workerId: string) {
  const queryClient = useQueryClient();
  const queryKey = ['certifications', workerId];

  return useApiMutation<Certification, UpdateCertificationVariables>(
    'patch',
    (variables) => `/workers/${workerId}/certifications/${variables.certId}`,
    {
      onMutate: async (variables) => {
        // Cancel any outgoing refetches so they don't overwrite our optimistic update
        await queryClient.cancelQueries({ queryKey });

        // Snapshot the previous value
        const previousCertifications =
          queryClient.getQueryData<ListCertificationsResponse>(queryKey);

        // Optimistically update the cache
        if (previousCertifications) {
          queryClient.setQueryData<ListCertificationsResponse>(
            queryKey,
            previousCertifications.map((cert) =>
              cert.certification_id === variables.certId
                ? {
                    ...cert,
                    validation_status:
                      variables.validation_status ?? cert.validation_status,
                    rejection_reason:
                      variables.rejection_reason ?? cert.rejection_reason,
                  }
                : cert
            )
          );
        }

        return { previousCertifications } as MutationContext;
      },

      onError: (_error, _variables, context) => {
        // Rollback to the snapshot on error
        const ctx = context as MutationContext | undefined;
        if (ctx?.previousCertifications) {
          queryClient.setQueryData<ListCertificationsResponse>(
            queryKey,
            ctx.previousCertifications
          );
        }
      },

      onSettled: () => {
        // Always invalidate to ensure consistency with the server
        queryClient.invalidateQueries({ queryKey });
      },
    }
  );
}
