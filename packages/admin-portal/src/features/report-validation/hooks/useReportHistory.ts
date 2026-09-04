import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import type { ReportVersion, ValidationResult } from '../types';

export interface VersionHistoryEntry {
  version: ReportVersion;
  validation?: ValidationResult;
}

export interface ReportHistoryResponse {
  history: VersionHistoryEntry[];
}

/**
 * Fetches the version and validation history for a report.
 * Returns entries in reverse chronological order (most recent version first).
 *
 * Validates: Requirements 6.5
 */
export function useReportHistory(reportId: string) {
  return useQuery<ReportHistoryResponse, ApiClientError>({
    queryKey: ['report-history', reportId],
    queryFn: () =>
      apiClient.get<ReportHistoryResponse>(
        `/report-validation/reports/${reportId}/history`
      ),
    enabled: !!reportId,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
