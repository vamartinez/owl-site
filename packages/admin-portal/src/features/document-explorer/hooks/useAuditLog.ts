import { useMutation } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { logAuditEvent } from '../api';
import type { AuditLogEntry } from '../types';

/**
 * Logs audit events for document downloads.
 * Called on successful download completion to satisfy audit trail requirements.
 */
export function useAuditLog() {
  return useMutation<void, ApiClientError, AuditLogEntry>({
    mutationFn: (entry: AuditLogEntry) => logAuditEvent(entry),
  });
}
