/**
 * Pure search filter functions for workers and sites.
 * Extracted from handler logic to enable direct unit and property testing.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

export interface WorkerRecord {
  worker_id: string;
  legal_name?: string;
  preferred_name?: string;
  [key: string]: unknown;
}

export interface SiteRecord {
  id: string;
  name?: string;
  address?: string;
  [key: string]: unknown;
}

const SEARCH_RESULT_LIMIT = 20;

/**
 * Filters workers by search string (case-insensitive match on legal_name or preferred_name).
 * When search is empty or undefined, returns all workers unfiltered.
 * When search is non-empty, returns at most 20 matching results.
 */
export function filterWorkers(workers: WorkerRecord[], search: string | undefined): WorkerRecord[] {
  if (!search) {
    return workers;
  }

  const searchLower = search.toLowerCase();
  return workers
    .filter((worker) => {
      const legalName = worker.legal_name?.toLowerCase() ?? '';
      const preferredName = worker.preferred_name?.toLowerCase() ?? '';
      return legalName.includes(searchLower) || preferredName.includes(searchLower);
    })
    .slice(0, SEARCH_RESULT_LIMIT);
}

/**
 * Filters sites by search string (case-insensitive match on name or address).
 * When search is empty or undefined, returns all sites unfiltered.
 * When search is non-empty, returns at most 20 matching results.
 */
export function filterSites(sites: SiteRecord[], search: string | undefined): SiteRecord[] {
  if (!search) {
    return sites;
  }

  const searchLower = search.toLowerCase();
  return sites
    .filter((site) => {
      const nameMatch = site.name?.toLowerCase().includes(searchLower) ?? false;
      const addressMatch = site.address?.toLowerCase().includes(searchLower) ?? false;
      return nameMatch || addressMatch;
    })
    .slice(0, SEARCH_RESULT_LIMIT);
}
