import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import type { ComboboxOption } from '@/components/ui/Combobox';

/**
 * Site object as returned by the GET /sites endpoint.
 */
export interface Site {
  id: string;
  name: string;
  address: string;
  timezone?: string;
  status?: string;
  created_at?: string;
}

interface SitesApiResponse {
  sites: Site[];
  total: number;
}

export interface UseSiteSearchResult {
  options: ComboboxOption[];
  rawData: Site[];
  isLoading: boolean;
  isError: boolean;
  error: ApiClientError | null;
}

/**
 * Formats a site into a display label.
 * Uses "{name} — {address}" format.
 */
export function formatSiteLabel(site: Site): string {
  return `${site.name} — ${site.address}`;
}

/**
 * Fetches sites filtered by a search query using React Query.
 * When query is empty, fetches the unfiltered list of sites.
 *
 * Requirements: 5.2, 5.3, 5.4, 5.5, 2.2
 */
export function useSiteSearch(query: string): UseSiteSearchResult {
  const params: Record<string, string> = {};
  if (query) {
    params.search = query;
  }

  const { data, isLoading, isError, error } = useQuery<SitesApiResponse, ApiClientError>({
    queryKey: ['sites', query],
    queryFn: async () => {
      return apiClient.get<SitesApiResponse>('/sites', params);
    },
    staleTime: 30_000, // 30 seconds — avoids redundant requests for repeated queries
  });

  const sites = data?.sites ?? [];

  const options: ComboboxOption[] = sites.map((site) => ({
    value: site.id,
    label: formatSiteLabel(site),
  }));

  return {
    options,
    rawData: sites,
    isLoading,
    isError,
    error: error ?? null,
  };
}
