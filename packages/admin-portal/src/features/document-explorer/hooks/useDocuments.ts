import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ApiClientError } from '@/services/api-client';
import { useDocExplorerStore } from '../store';
import { fetchFolderContents } from '../api';
import type { DocumentSummary, FolderContentsResponse } from '../types';

const DEFAULT_PAGE_SIZE = 50;

/**
 * Sorts documents by createdAt in descending order (most recent first).
 */
function sortByCreatedAtDesc(documents: DocumentSummary[]): DocumentSummary[] {
  return [...documents].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Hook for fetching paginated documents in the current folder.
 * Uses the current path and organization mode from the store.
 * Returns documents sorted by createdAt descending by default.
 *
 * Requirements: 2.1, 2.2
 */
export function useDocuments(pageSize: number = DEFAULT_PAGE_SIZE) {
  const currentPath = useDocExplorerStore((state) => state.currentPath);
  const organizationMode = useDocExplorerStore((state) => state.organizationMode);
  const [page, setPage] = useState(1);

  const pathString = currentPath.join('/');

  const query = useQuery<FolderContentsResponse, ApiClientError>({
    queryKey: ['document-explorer', 'documents', pathString, organizationMode, page],
    queryFn: () => fetchFolderContents(pathString, page, pageSize, organizationMode),
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });

  const documents = query.data
    ? sortByCreatedAtDesc(query.data.documents)
    : [];

  const totalDocuments = query.data?.totalDocuments ?? 0;
  const totalPages = query.data?.totalPages ?? 0;

  const goToPage = useCallback(
    (targetPage: number) => {
      if (targetPage >= 1 && targetPage <= totalPages) {
        setPage(targetPage);
      }
    },
    [totalPages],
  );

  const nextPage = useCallback(() => {
    goToPage(page + 1);
  }, [page, goToPage]);

  const prevPage = useCallback(() => {
    goToPage(page - 1);
  }, [page, goToPage]);

  return {
    documents,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    // Pagination
    page,
    pageSize,
    totalDocuments,
    totalPages,
    goToPage,
    nextPage,
    prevPage,
  };
}
