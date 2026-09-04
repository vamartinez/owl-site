import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApi';

interface SubmitReportResponse {
  report_id: string;
  status: 'submitted';
  submitted_at: string;
}

/**
 * Hook to submit a report. Changes the report status to "submitted" (terminal state).
 * On success, invalidates both the report detail and reports list queries.
 *
 * Validates: Requirements 7.1, 7.2
 */
export function useSubmitReport(reportId: string) {
  const queryClient = useQueryClient();

  const mutation = useApiMutation<SubmitReportResponse, void>(
    'post',
    `/report-validation/reports/${reportId}/submit`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['report', reportId] });
        queryClient.invalidateQueries({ queryKey: ['reports'] });
      },
    }
  );

  const submit = useCallback(async () => {
    return mutation.mutateAsync(undefined as unknown as void);
  }, [mutation]);

  return {
    submit,
    isLoading: mutation.isPending,
    error: mutation.error?.message ?? null,
    reset: mutation.reset,
  };
}
