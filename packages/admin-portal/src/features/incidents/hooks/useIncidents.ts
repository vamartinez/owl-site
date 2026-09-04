import { useQuery } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import { useAuthStore } from '@/store/auth-store';
import type { Incident, IncidentStatus, OperationalSeverity, RegulatoryFlag } from '../types';

/**
 * Filters for the incidents list query.
 */
export interface IncidentFilters {
  siteId?: string;
  status?: IncidentStatus;
  severity?: OperationalSeverity;
  regulatoryFlag?: RegulatoryFlag;
  page?: number;
  pageSize?: number;
}

interface IncidentsApiResponse {
  incidents: Incident[];
  total?: number;
  nextToken?: string;
}

/** Roles that have no access to incidents */
const NO_ACCESS_ROLES = ['worker', 'gate_operator'] as const;

/**
 * Fetches incidents with filters and pagination.
 * Applies role-based filtering:
 * - tenant_admin and cso see all incidents in their tenant
 * - site_admin and supervisor see only incidents for their assigned sites
 * - worker and gate_operator see no incidents (query disabled)
 *
 * Requirements: 1.1, 21.5
 */
export function useIncidents(filters: IncidentFilters = {}) {
  const role = useAuthStore((state) => state.role);

  const queryParams: Record<string, string> = {};
  if (filters.siteId) queryParams.site_id = filters.siteId;
  if (filters.status) queryParams.status = filters.status;
  if (filters.severity) queryParams.severity = filters.severity;
  if (filters.regulatoryFlag) queryParams.regulatory_flag = filters.regulatoryFlag;
  if (filters.page !== undefined) queryParams.page = String(filters.page);
  if (filters.pageSize !== undefined) queryParams.page_size = String(filters.pageSize);

  const hasAccess = role && !NO_ACCESS_ROLES.includes(role as (typeof NO_ACCESS_ROLES)[number]);

  return useQuery<Incident[], ApiClientError>({
    queryKey: ['incidents', queryParams],
    queryFn: async () => {
      const response = await apiClient.get<IncidentsApiResponse>(
        '/incidents',
        queryParams
      );
      return response.incidents;
    },
    enabled: !!hasAccess,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
