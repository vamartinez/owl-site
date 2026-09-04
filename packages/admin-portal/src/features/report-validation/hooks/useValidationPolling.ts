import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import type { ReportStatus } from '../types';

interface PollResponse {
  report_id: string;
  status: ReportStatus;
}

const POLLING_INTERVAL_MS = 3000;

/**
 * Polls the report status while it is "validating" (every 3 seconds).
 * Automatically stops polling when the status changes away from "validating".
 * On status change, invalidates the report detail query to fetch full results.
 *
 * Validates: Requirements 10.6
 */
export function useValidationPolling(reportId: string, currentStatus: ReportStatus) {
  const queryClient = useQueryClient();
  const isValidating = currentStatus === 'validating';

  return useQuery<PollResponse, ApiClientError>({
    queryKey: ['report-poll', reportId],
    queryFn: async () => {
      const response = await apiClient.get<PollResponse>(
        `/report-validation/reports/${reportId}`
      );

      // When status changes from "validating", invalidate to fetch full detail
      if (response.status !== 'validating') {
        queryClient.invalidateQueries({ queryKey: ['report', reportId] });
        queryClient.invalidateQueries({ queryKey: ['report-history', reportId] });
        queryClient.invalidateQueries({ queryKey: ['reports'] });
      }

      return response;
    },
    enabled: !!reportId && isValidating,
    refetchInterval: isValidating ? POLLING_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
