import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';

/**
 * Regulatory data types supported by the API.
 */
export type RegulatoryDataType = 'worksafebc_employer' | 'osha_300' | 'worksafebc_emergency';

/**
 * Generic regulatory form data response.
 * The shape varies by type (WorkSafeBCEmployerReport, OshaRecordingData, etc.)
 */
export type RegulatoryFormData = Record<string, unknown>;

interface SaveRegulatoryDataVariables {
  incidentId: string;
  data: RegulatoryFormData;
}

/**
 * Fetches regulatory form data for an incident.
 * Returns the saved regulatory data (OSHA or WorkSafeBC form fields).
 *
 * Requirements: 14.1, 14.2
 */
export function useRegulatoryData(incidentId: string | undefined) {
  return useQuery<RegulatoryFormData, ApiClientError>({
    queryKey: ['incidents', incidentId, 'regulatory-data'],
    queryFn: async () => {
      return apiClient.get<RegulatoryFormData>(
        `/incidents/${incidentId}/regulatory-data`
      );
    },
    enabled: !!incidentId,
    retry: (failureCount, error) => {
      if (error.status === 404) return false;
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}

/**
 * Mutation hook for saving regulatory form data (OSHA/WorkSafeBC).
 * Invalidates the regulatory data query on success.
 *
 * Requirements: 14.1
 */
export function useSaveRegulatoryData() {
  const queryClient = useQueryClient();

  return useMutation<RegulatoryFormData, ApiClientError, SaveRegulatoryDataVariables>({
    mutationFn: async (variables) => {
      return apiClient.post<RegulatoryFormData>(
        `/incidents/${variables.incidentId}/regulatory-data`,
        variables.data
      );
    },

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['incidents', variables.incidentId, 'regulatory-data'],
      });
      // Timeline will have a new event
      queryClient.invalidateQueries({
        queryKey: ['incidents', variables.incidentId, 'timeline'],
      });
    },
  });
}
