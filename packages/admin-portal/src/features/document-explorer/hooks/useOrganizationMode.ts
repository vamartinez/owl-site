import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { getOrganizationMode, setOrganizationMode } from '../api';
import { useDocExplorerStore } from '../store';
import type { OrganizationMode } from '../types';

const QUERY_KEY = ['document-explorer', 'organization-mode'] as const;

/**
 * Manages the user's folder organization mode preference.
 * - Fetches the persisted mode from the API and syncs it to the Zustand store.
 * - Provides a mutation to update the mode with optimistic UI via the store.
 * - On mutation error, reverts the store to the previous mode.
 */
export function useOrganizationMode() {
  const queryClient = useQueryClient();
  const storeSetMode = useDocExplorerStore((s) => s.setOrganizationMode);

  const query = useQuery<{ mode: OrganizationMode }, ApiClientError>({
    queryKey: QUERY_KEY,
    queryFn: getOrganizationMode,
  });

  // Sync fetched mode to store whenever query data changes
  useEffect(() => {
    if (query.data?.mode) {
      storeSetMode(query.data.mode);
    }
  }, [query.data, storeSetMode]);

  const mutation = useMutation<
    { mode: OrganizationMode },
    ApiClientError,
    OrganizationMode,
    { previousMode: OrganizationMode }
  >({
    mutationFn: (mode: OrganizationMode) => setOrganizationMode(mode),
    onMutate: (newMode) => {
      const previousMode = useDocExplorerStore.getState().organizationMode;
      // Optimistic update: immediately apply new mode to the store
      storeSetMode(newMode);
      return { previousMode };
    },
    onError: (_error, _newMode, context) => {
      // Revert to previous mode on failure
      if (context?.previousMode) {
        storeSetMode(context.previousMode);
      }
    },
    onSettled: () => {
      // Invalidate query to refetch the persisted preference
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    /** Current organization mode from the server */
    mode: query.data?.mode,
    /** Whether the initial fetch is loading */
    isLoading: query.isLoading,
    /** Error from fetching the mode */
    error: query.error,
    /** Mutation to update the mode (optimistic) */
    updateMode: mutation.mutate,
    /** Whether the mode update is in-flight */
    isUpdating: mutation.isPending,
    /** Error from updating the mode */
    updateError: mutation.error,
  };
}
