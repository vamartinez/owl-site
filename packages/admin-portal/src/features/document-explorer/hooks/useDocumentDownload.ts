import { useMutation } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import type { ApiClientError } from '@/services/api-client';
import { initiateDownload, pollDownloadStatus } from '../api';
import { useDocExplorerStore } from '../store';
import type {
  BatchDownloadStatusResponse,
  DocumentSummary,
  DownloadInitResponse,
  DownloadProgress,
} from '../types';
import { validateBatchDownloadSize } from '../utils';

const DOWNLOAD_TIMEOUT_MS = 120_000; // 120 seconds
const POLL_INTERVAL_MS = 2_000; // Poll every 2 seconds

interface UseDocumentDownloadResult {
  startDownload: (documents: Pick<DocumentSummary, 'id' | 'fileSize'>[]) => void;
  isInitiating: boolean;
  error: ApiClientError | null;
  reset: () => void;
}

/**
 * Hook for initiating single or batch document downloads.
 *
 * - Validates batch size (≤500 MB) before initiating.
 * - For single documents, opens the presigned URL directly.
 * - For batch downloads, polls status until ready or timeout (120s).
 * - Manages download progress state via Zustand store.
 * - Handles partial failures (skippedDocuments) by completing with warning.
 */
export function useDocumentDownload(): UseDocumentDownloadResult {
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDownloadProgress = useDocExplorerStore.getState().setDownloadProgress;

  const cleanupTimers = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const updateProgress = useCallback(
    (update: Partial<DownloadProgress> & { downloadId: string }) => {
      const current = useDocExplorerStore.getState().activeDownload;
      const progress: DownloadProgress = {
        downloadId: update.downloadId,
        status: update.status ?? current?.status ?? 'initiating',
        bytesDownloaded: update.bytesDownloaded ?? current?.bytesDownloaded ?? 0,
        totalBytes: update.totalBytes ?? current?.totalBytes ?? 0,
        startedAt: current?.startedAt ?? Date.now(),
        estimatedRemainingMs: update.estimatedRemainingMs ?? current?.estimatedRemainingMs ?? null,
        errorMessage: update.errorMessage,
      };
      setDownloadProgress(progress);
    },
    [setDownloadProgress],
  );

  const pollBatchStatus = useCallback(
    (downloadId: string, totalBytes: number) => {
      const startedAt = Date.now();

      // Set up the 120-second timeout
      timeoutRef.current = setTimeout(() => {
        cleanupTimers();
        updateProgress({
          downloadId,
          status: 'timeout',
          errorMessage: 'Download timed out after 120 seconds.',
        });
      }, DOWNLOAD_TIMEOUT_MS);

      const poll = async () => {
        try {
          const status: BatchDownloadStatusResponse =
            await pollDownloadStatus(downloadId);

          const elapsedMs = Date.now() - startedAt;
          const progressBytes = Math.round(
            (status.progress / 100) * totalBytes,
          );

          if (status.status === 'ready') {
            cleanupTimers();

            // Handle partial failures
            const hasSkipped =
              status.skippedDocuments && status.skippedDocuments.length > 0;
            const skippedNames = hasSkipped
              ? status.skippedDocuments!
                  .map((d) => `${d.name} (${d.reason})`)
                  .join(', ')
              : undefined;

            updateProgress({
              downloadId,
              status: 'complete',
              bytesDownloaded: totalBytes,
              totalBytes,
              estimatedRemainingMs: 0,
              errorMessage: hasSkipped
                ? `Completed with warnings. Skipped: ${skippedNames}`
                : undefined,
            });

            // Open download URL
            if (status.downloadUrl) {
              window.open(status.downloadUrl, '_blank');
            }
            return;
          }

          if (status.status === 'failed') {
            cleanupTimers();
            updateProgress({
              downloadId,
              status: 'failed',
              errorMessage:
                status.errorMessage ?? 'Download failed on the server.',
            });
            return;
          }

          if (status.status === 'expired') {
            cleanupTimers();
            updateProgress({
              downloadId,
              status: 'failed',
              errorMessage: 'Download link has expired.',
            });
            return;
          }

          // Still preparing — update progress and continue polling
          const bytesPerMs =
            elapsedMs > 0 ? progressBytes / elapsedMs : 0;
          const remainingBytes = totalBytes - progressBytes;
          const estimatedRemainingMs =
            bytesPerMs > 0 ? Math.max(0, remainingBytes / bytesPerMs) : null;

          updateProgress({
            downloadId,
            status: status.status === 'preparing' ? 'packaging' : 'downloading',
            bytesDownloaded: progressBytes,
            totalBytes,
            estimatedRemainingMs,
          });

          // Schedule next poll
          pollingRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } catch {
          cleanupTimers();
          updateProgress({
            downloadId,
            status: 'failed',
            errorMessage: 'Failed to check download status.',
          });
        }
      };

      // Start first poll
      pollingRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    },
    [cleanupTimers, updateProgress],
  );

  const mutation = useMutation<
    DownloadInitResponse,
    ApiClientError,
    string[]
  >({
    mutationFn: (documentIds: string[]) => initiateDownload(documentIds),
    onSuccess: (data, documentIds) => {
      const isSingleDocument = documentIds.length === 1;

      if (isSingleDocument) {
        // For single documents, open the presigned URL directly
        updateProgress({
          downloadId: data.downloadId,
          status: 'complete',
          bytesDownloaded: data.totalSize,
          totalBytes: data.totalSize,
          estimatedRemainingMs: 0,
        });
        window.open(data.downloadUrl, '_blank');
      } else {
        // For batch downloads, start polling
        updateProgress({
          downloadId: data.downloadId,
          status: 'packaging',
          bytesDownloaded: 0,
          totalBytes: data.totalSize,
          estimatedRemainingMs: null,
        });
        pollBatchStatus(data.downloadId, data.totalSize);
      }
    },
    onError: (error) => {
      setDownloadProgress({
        downloadId: 'error',
        status: 'failed',
        bytesDownloaded: 0,
        totalBytes: 0,
        startedAt: Date.now(),
        estimatedRemainingMs: null,
        errorMessage: error.message,
      });
    },
  });

  const startDownload = useCallback(
    (documents: Pick<DocumentSummary, 'id' | 'fileSize'>[]) => {
      if (documents.length === 0) return;

      // Validate batch download size
      if (!validateBatchDownloadSize(documents)) {
        setDownloadProgress({
          downloadId: 'validation-error',
          status: 'failed',
          bytesDownloaded: 0,
          totalBytes: 0,
          startedAt: Date.now(),
          estimatedRemainingMs: null,
          errorMessage:
            'Selected documents exceed the 500 MB size limit. Please reduce your selection.',
        });
        return;
      }

      // Clean up any existing timers from previous download
      cleanupTimers();

      const documentIds = documents.map((d) => d.id);

      // Set initial progress state
      setDownloadProgress({
        downloadId: 'pending',
        status: 'initiating',
        bytesDownloaded: 0,
        totalBytes: documents.reduce((sum, d) => sum + d.fileSize, 0),
        startedAt: Date.now(),
        estimatedRemainingMs: null,
      });

      mutation.mutate(documentIds);
    },
    [mutation, setDownloadProgress, cleanupTimers],
  );

  const reset = useCallback(() => {
    cleanupTimers();
    setDownloadProgress(null);
    mutation.reset();
  }, [cleanupTimers, setDownloadProgress, mutation]);

  return {
    startDownload,
    isInitiating: mutation.isPending,
    error: mutation.error,
    reset,
  };
}
