import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';

/**
 * TanStack Query wrapper for API calls.
 * Provides typed hooks for GET (queries) and POST/PATCH/DELETE (mutations).
 */

export function useApiQuery<T>(
  queryKey: string[],
  path: string,
  params?: Record<string, string>,
  options?: Omit<UseQueryOptions<T, ApiClientError>, 'queryKey' | 'queryFn'>
) {
  return useQuery<T, ApiClientError>({
    queryKey,
    queryFn: () => apiClient.get<T>(path, params),
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors (client errors)
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
    ...options,
  });
}

export function useApiMutation<TData, TVariables>(
  method: 'post' | 'patch' | 'delete',
  path: string | ((variables: TVariables) => string),
  options?: Omit<UseMutationOptions<TData, ApiClientError, TVariables>, 'mutationFn'>
) {
  const queryClient = useQueryClient();

  return useMutation<TData, ApiClientError, TVariables>({
    mutationFn: async (variables: TVariables) => {
      const resolvedPath = typeof path === 'function' ? path(variables) : path;

      switch (method) {
        case 'post':
          return apiClient.post<TData>(resolvedPath, variables);
        case 'patch':
          return apiClient.patch<TData>(resolvedPath, variables);
        case 'delete':
          return apiClient.delete<TData>(resolvedPath);
      }
    },
    ...options,
  });
}

/**
 * Convenience hook to invalidate queries after mutations.
 */
export function useInvalidateQueries() {
  const queryClient = useQueryClient();
  return (queryKeys: string[][]) => {
    queryKeys.forEach((key) => {
      queryClient.invalidateQueries({ queryKey: key });
    });
  };
}
