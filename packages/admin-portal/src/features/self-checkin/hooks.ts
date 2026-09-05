/**
 * React Query hooks for the admin self check-in mutations.
 */

import { useMutation } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { getOrCreateSiteToken, regenerateSiteToken, sendSmsLink } from './api';
import type { SiteTokenResponse, SendSmsLinkResponse } from './types';

/** Fetch (create-if-absent) the site's persistent check-in QR token. */
export function useSiteCheckinToken() {
  return useMutation<SiteTokenResponse, ApiClientError, string>({
    mutationFn: (siteId: string) => getOrCreateSiteToken(siteId),
  });
}

/** Rotate the site's check-in QR token — invalidates the previous QR. */
export function useRegenerateSiteToken() {
  return useMutation<SiteTokenResponse, ApiClientError, string>({
    mutationFn: (siteId: string) => regenerateSiteToken(siteId),
  });
}

/** Send a one-time SMS check-in magic link to a worker for a site. */
export function useSendCheckinLink() {
  return useMutation<
    SendSmsLinkResponse,
    ApiClientError,
    { workerId: string; siteId: string }
  >({
    mutationFn: ({ workerId, siteId }) => sendSmsLink(workerId, siteId),
  });
}
