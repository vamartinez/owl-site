import { useQuery } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { fetchFolderContents } from '../api';
import { useDocExplorerStore } from '../store';
import type { FolderContentsResponse } from '../types';

/**
 * Fetches folder contents at the current navigation path.
 * Query key includes the current path and organization mode so the cache
 * is automatically invalidated when the user navigates or switches modes.
 */
export function useFolders() {
  const currentPath = useDocExplorerStore((s) => s.currentPath);
  const organizationMode = useDocExplorerStore((s) => s.organizationMode);

  const pathString = currentPath.join('/');

  return useQuery<FolderContentsResponse, ApiClientError>({
    queryKey: ['document-explorer', 'folders', currentPath, organizationMode],
    queryFn: () => fetchFolderContents(pathString, 1, 50, organizationMode),
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
