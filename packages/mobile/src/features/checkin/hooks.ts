import { useQuery } from '@tanstack/react-query';
import { resolveCheckinToken, ApiError } from '../../lib/api-client';
import type { ResolveTokenResult } from './types';

/** Resolve a scanned/linked check-in token. */
export function useResolveToken(token: string | undefined) {
  return useQuery<ResolveTokenResult, ApiError>({
    queryKey: ['checkin-token', token],
    queryFn: () => resolveCheckinToken(token!),
    enabled: !!token,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
