import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';
import type { Report } from '../types';

interface ValidateReportResponse {
  report_id: string;
  status: 'validating';
  validation_id: string;
}

/**
 * Hook to initiate AI validation on a report.
 * After a successful validation request, invalidates the report query
 * so the UI picks up the "validating" status and starts polling.
 *
 * Validates: Requirements 3.1
 */
export function useValidateReport(reportId: string) {
  const queryClient = useQueryClient();

  const mutation = useApiMutation<ValidateReportResponse, void>(
    'post',
    `/report-validation/reports/${reportId}/validate`,
    {
      onSuccess: () => {
        // Invalidate report detail so polling picks up the new status
        queryClient.invalidateQueries({ queryKey: ['report', reportId] });
        queryClient.invalidateQueries({ queryKey: ['reports'] });
      },
    }
  );

  const validate = useCallback(async () => {
    return mutation.mutateAsync(undefined as unknown as void);
  }, [mutation]);

  return {
    validate,
    isLoading: mutation.isPending,
    error: mutation.error?.message ?? null,
    reset: mutation.reset,
  };
}
