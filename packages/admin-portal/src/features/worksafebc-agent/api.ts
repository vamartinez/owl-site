/**
 * WorkSafeBC PDF Compliance Agent — API hooks (TanStack Query).
 * Reuses the shared useApi wrappers and apiClient patterns.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/hooks/useApi';
import { apiClient, type ApiClientError } from '@/services/api-client';
import {
  TERMINAL_STATUSES,
  type AnalysisSession,
  type CreateSessionResponse,
  type DocumentCategory,
  type RegulatoryVersion,
  type SessionStatus,
} from './types';

const POLL_MS = 3000;

export function useCreateSession() {
  return useApiMutation<CreateSessionResponse, {
    document_name: string;
    document_size_bytes: number;
    document_page_count: number;
    site_id: string;
  }>('post', '/worksafebc-agent/sessions');
}

export function useCategorizeSession() {
  return useApiMutation<
    { session_id: string; status: SessionStatus; category: DocumentCategory },
    { sessionId: string; category: DocumentCategory }
  >('patch', (v) => `/worksafebc-agent/sessions/${v.sessionId}/category`);
}

export function useReanalyze() {
  return useApiMutation<{ session_id: string }, { sessionId: string }>(
    'post',
    (v) => `/worksafebc-agent/sessions/${v.sessionId}/reanalyze`
  );
}

export function useSession(sessionId: string | undefined) {
  return useApiQuery<{ session: AnalysisSession }>(
    ['worksafebc-session', sessionId ?? ''],
    `/worksafebc-agent/sessions/${sessionId}`,
    undefined,
    { enabled: !!sessionId }
  );
}

export function useSessions(filters?: Record<string, string>) {
  return useApiQuery<{ sessions: AnalysisSession[]; page_size: number }>(
    ['worksafebc-sessions', JSON.stringify(filters ?? {})],
    '/worksafebc-agent/sessions',
    filters
  );
}

/** Polls a session while non-terminal; invalidates detail on completion. */
export function useSessionPolling(sessionId: string, status: SessionStatus | undefined) {
  const qc = useQueryClient();
  const active = !!status && !TERMINAL_STATUSES.includes(status);
  return useQuery<{ session: AnalysisSession }, ApiClientError>({
    queryKey: ['worksafebc-session-poll', sessionId],
    queryFn: async () => {
      const res = await apiClient.get<{ session: AnalysisSession }>(
        `/worksafebc-agent/sessions/${sessionId}`
      );
      if (TERMINAL_STATUSES.includes(res.session.status)) {
        qc.invalidateQueries({ queryKey: ['worksafebc-session', sessionId] });
        qc.invalidateQueries({ queryKey: ['worksafebc-sessions'] });
      }
      return res;
    },
    enabled: !!sessionId && active,
    refetchInterval: active ? POLL_MS : false,
  });
}

export function useRegulatoryVersions() {
  return useApiQuery<{ versions: RegulatoryVersion[] }>(
    ['worksafebc-versions'],
    '/worksafebc-agent/regulatory-versions'
  );
}

export function usePublishRegulatoryVersion() {
  return useApiMutation<
    { version: RegulatoryVersion },
    { effective_date: string; change_summary: string; clauses: unknown[] }
  >('post', '/worksafebc-agent/regulatory-versions');
}
