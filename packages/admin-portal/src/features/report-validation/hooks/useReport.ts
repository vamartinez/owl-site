import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import type { Report, ValidationResult } from '../types';

export interface ReportDetailResponse {
  report: Report;
  latest_validation?: ValidationResult;
}

/**
 * Fetches a single report detail including the latest validation result.
 * Only fetches when a valid reportId is provided.
 *
 * Validates: Requirements 8.3
 */
export function useReport(reportId: string) {
  return useQuery<ReportDetailResponse, ApiClientError>({
    queryKey: ['report', reportId],
    queryFn: () =>
      apiClient.get<ReportDetailResponse>(`/report-validation/reports/${reportId}`),
    enabled: !!reportId,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
