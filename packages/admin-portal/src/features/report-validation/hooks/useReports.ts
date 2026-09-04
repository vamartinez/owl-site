import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import type { Report, ReportStatus } from '../types';

export interface ReportsApiResponse {
  reports: Report[];
  pagination: {
    total: number;
    page_size: number;
    next_cursor?: string;
  };
}

export interface UseReportsParams {
  /** Opaque cursor (report_id) marking where the next page starts. Omit for the first page. */
  cursor?: string;
  /** Page size; maps to the backend `limit` query param (1-100). */
  limit?: number;
  status?: ReportStatus;
  sort_by?: 'upload_date' | 'validation_date';
  sort_order?: 'asc' | 'desc';
}

/**
 * Fetches a cursor-paginated list of reports with optional status filter and sort.
 * Results are scoped by the user's role (own/site/tenant) server-side.
 *
 * The query param contract here MUST match the backend `listReportsQuerySchema`
 * (`packages/backend/src/services/report-validation/types.ts`): `sort_by` accepts
 * `upload_date`/`validation_date`, and pagination is cursor-based (`limit`/`cursor`
 * per `paginationQuerySchema`), NOT page-based.
 *
 * Validates: Requirements 8.1, 8.2
 */
export function useReports(params: UseReportsParams = {}) {
  const { cursor, limit = 20, status, sort_by = 'upload_date', sort_order = 'desc' } = params;

  const queryParams: Record<string, string> = {
    limit: String(limit),
    sort_by,
    sort_order,
  };

  if (cursor) {
    queryParams.cursor = cursor;
  }

  if (status) {
    queryParams.status = status;
  }

  return useQuery<ReportsApiResponse, ApiClientError>({
    queryKey: ['reports', cursor, limit, status, sort_by, sort_order].filter(Boolean) as string[],
    queryFn: () => apiClient.get<ReportsApiResponse>('/report-validation/reports', queryParams),
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
