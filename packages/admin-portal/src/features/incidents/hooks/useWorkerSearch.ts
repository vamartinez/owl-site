import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import type { ComboboxOption } from '@/components/ui/Combobox';
import type { ApiWorkerListItem, ApiListWorkersResponse } from '@/types/api-contracts';

export interface UseWorkerSearchResult {
  options: ComboboxOption[];
  rawData: ApiWorkerListItem[];
  isLoading: boolean;
  isError: boolean;
  error: ApiClientError | null;
}

/**
 * Formats a worker into a display label.
 * Uses "{legal_name}" or "{legal_name} ({preferred_name})" when preferred_name exists.
 */
export function formatWorkerLabel(worker: ApiWorkerListItem): string {
  if (worker.preferred_name) {
    return `${worker.legal_name} (${worker.preferred_name})`;
  }
  return worker.legal_name;
}

/**
 * Fetches workers from GET /workers with optional search filtering.
 * Maps results to ComboboxOption[] for use with the Combobox component.
 *
 * Requirements: 5.1, 5.3, 5.4, 5.5, 3.2
 */
export function useWorkerSearch(query: string): UseWorkerSearchResult {
  const params: Record<string, string> = {};
  if (query) {
    params.search = query;
  }

  const { data, isLoading, isError, error } = useQuery<ApiListWorkersResponse, ApiClientError>({
    queryKey: ['workers', query],
    queryFn: async () => {
      return apiClient.get<ApiListWorkersResponse>('/workers', params);
    },
    staleTime: 30_000, // 30 seconds — avoid redundant requests for repeated queries
    retry: (failureCount, err) => {
      if (err.status >= 400 && err.status < 500) return false;
      return failureCount < 2;
    },
  });

  const rawData = data?.workers ?? [];

  const options: ComboboxOption[] = rawData.map((worker) => ({
    value: worker.worker_id,
    label: formatWorkerLabel(worker),
  }));

  return {
    options,
    rawData,
    isLoading,
    isError,
    error: error ?? null,
  };
}
