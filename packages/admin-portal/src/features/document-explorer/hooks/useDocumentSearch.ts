import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { searchDocuments } from '../api';
import { useDocExplorerStore } from '../store';
import { isSearchTermValid } from '../utils';
import type { DocumentSearchResponse } from '../types';

const DEBOUNCE_MS = 500;

/**
 * Performs a debounced document search using the current search term and filters from the store.
 * The search query is only fired when the debounced search term is valid (>= 2 trimmed characters).
 * Implements a 500ms debounce to avoid excessive API calls on rapid typing.
 */
export function useDocumentSearch() {
  const searchTerm = useDocExplorerStore((s) => s.searchTerm);
  const filters = useDocExplorerStore((s) => s.filters);

  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const enabled = isSearchTermValid(debouncedSearchTerm);

  return useQuery<DocumentSearchResponse, ApiClientError>({
    queryKey: ['document-explorer', 'search', debouncedSearchTerm, filters],
    queryFn: () => searchDocuments(debouncedSearchTerm, filters, 1),
    enabled,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
