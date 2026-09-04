import { useMutation } from '@tanstack/react-query';
import type { ApiClientError } from '@/services/api-client';
import { verifyIntegrity } from '../api';
import type { IntegrityVerificationResponse } from '../types';

/**
 * Triggers an integrity verification for a document.
 * Computes the current SHA-256 hash server-side and returns whether it
 * matches the hash recorded at upload time.
 */
export function useIntegrityVerify() {
  return useMutation<IntegrityVerificationResponse, ApiClientError, string>({
    mutationFn: (documentId: string) => verifyIntegrity(documentId),
  });
}
