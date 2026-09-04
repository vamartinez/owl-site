import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import { useApiMutation } from '@/hooks/useApi';
import type {
  LinkedDocument,
  LinkedDocumentsResponse,
  LinkableResponsesResponse,
  CreateLinkRequest,
  DocumentCategory,
} from '../types';

// ─── Query Keys ──────────────────────────────────────────────────────────────

const linkedDocumentsKeys = {
  all: (incidentId: string) => ['incidents', incidentId, 'linked-documents'] as const,
  linkable: (incidentId: string) => ['incidents', incidentId, 'linkable-responses'] as const,
  incident: (incidentId: string) => ['incidents', incidentId] as const,
};

// ─── useLinkedDocuments ──────────────────────────────────────────────────────

/**
 * Fetches linked documents for an incident, optionally filtered by categories.
 *
 * Requirements: 1.2, 3.1, 5.3
 */
export function useLinkedDocuments(
  incidentId: string | undefined,
  categories?: DocumentCategory[]
) {
  const params: Record<string, string> = {};
  if (categories && categories.length > 0) {
    params.categories = categories.join(',');
  }

  return useQuery<LinkedDocumentsResponse, ApiClientError>({
    queryKey: [...linkedDocumentsKeys.all(incidentId!), { categories }],
    queryFn: () =>
      apiClient.get<LinkedDocumentsResponse>(
        `/incidents/${incidentId}/linked-documents`,
        Object.keys(params).length > 0 ? params : undefined
      ),
    enabled: !!incidentId,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}

// ─── useLinkDocument ─────────────────────────────────────────────────────────

/**
 * Mutation hook for linking a form response to an incident (POST).
 * Invalidates linked documents and incident detail queries on success.
 *
 * Requirements: 1.2, 6.1
 */
export function useLinkDocument(incidentId: string) {
  const queryClient = useQueryClient();

  return useMutation<LinkedDocument, ApiClientError, CreateLinkRequest>({
    mutationFn: (payload) =>
      apiClient.post<LinkedDocument>(
        `/incidents/${incidentId}/linked-documents`,
        payload
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: linkedDocumentsKeys.all(incidentId),
      });
      queryClient.invalidateQueries({
        queryKey: linkedDocumentsKeys.incident(incidentId),
      });
    },
  });
}

// ─── useLinkableResponses ────────────────────────────────────────────────────

interface LinkableResponsesOptions {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
}

/**
 * Fetches form responses available to link to an incident, with search, date filters, and pagination.
 *
 * Requirements: 6.1, 6.2, 6.4
 */
export function useLinkableResponses(
  incidentId: string | undefined,
  options?: LinkableResponsesOptions
) {
  const params: Record<string, string> = {};
  if (options?.search) params.search = options.search;
  if (options?.dateFrom) params.date_from = options.dateFrom;
  if (options?.dateTo) params.date_to = options.dateTo;
  if (options?.page) params.page = String(options.page);

  return useQuery<LinkableResponsesResponse, ApiClientError>({
    queryKey: [...linkedDocumentsKeys.linkable(incidentId!), options],
    queryFn: () =>
      apiClient.get<LinkableResponsesResponse>(
        `/incidents/${incidentId}/linkable-responses`,
        Object.keys(params).length > 0 ? params : undefined
      ),
    enabled: !!incidentId,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}

// ─── useUnlinkDocument ───────────────────────────────────────────────────────

interface UnlinkVariables {
  linkId: string;
  justification: string;
}

/**
 * Mutation hook for unlinking a document from an incident (DELETE with justification body).
 * Invalidates linked documents and incident detail queries on success.
 *
 * Requirements: 5.3, 9.3
 */
export function useUnlinkDocument(incidentId: string) {
  const queryClient = useQueryClient();

  return useApiMutation<void, UnlinkVariables>(
    'delete',
    (variables) => `/incidents/${incidentId}/linked-documents/${variables.linkId}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: linkedDocumentsKeys.all(incidentId),
        });
        queryClient.invalidateQueries({
          queryKey: linkedDocumentsKeys.incident(incidentId),
        });
      },
    }
  );
}
