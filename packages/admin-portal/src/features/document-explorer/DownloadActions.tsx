import { Download, RefreshCw, X } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { useDocumentDownload } from './hooks/useDocumentDownload';
import { DownloadProgressBar } from './DownloadProgressBar';
import { useDocExplorerStore } from './store';
import type { DocumentSummary } from './types';
import { validateBatchDownloadSize } from './utils';

const MAX_BATCH_DOCUMENTS = 50;

interface DownloadActionsProps {
  documents: DocumentSummary[];
}

export function DownloadActions({ documents }: DownloadActionsProps) {
  const selectedDocumentIds = useDocExplorerStore((s) => s.selectedDocumentIds);
  const activeDownload = useDocExplorerStore((s) => s.activeDownload);
  const { startDownload, reset } = useDocumentDownload();

  const selectionCount = selectedDocumentIds.size;

  const selectedDocuments = useMemo(
    () => documents.filter((doc) => selectedDocumentIds.has(doc.id)),
    [documents, selectedDocumentIds],
  );

  const validationError = useMemo(() => {
    if (selectionCount === 0) return null;

    if (selectionCount > MAX_BATCH_DOCUMENTS) {
      return `Cannot download more than ${MAX_BATCH_DOCUMENTS} documents at once. Please reduce your selection.`;
    }

    if (!validateBatchDownloadSize(selectedDocuments)) {
      return 'Selected documents exceed the 500 MB size limit. Please reduce your selection.';
    }

    return null;
  }, [selectionCount, selectedDocuments]);

  const handleDownload = () => {
    if (selectionCount === 0 || validationError) return;
    startDownload(selectedDocuments);
  };

  const handleRetry = () => {
    if (selectionCount === 0) return;
    startDownload(selectedDocuments);
  };

  const buttonLabel =
    selectionCount <= 1 ? 'Download' : `Download (${selectionCount})`;

  const isDownloadActive =
    activeDownload !== null &&
    activeDownload.status !== 'complete' &&
    activeDownload.status !== 'failed' &&
    activeDownload.status !== 'timeout';

  const isErrorState =
    activeDownload !== null &&
    (activeDownload.status === 'failed' || activeDownload.status === 'timeout');

  const isCompleteState =
    activeDownload !== null && activeDownload.status === 'complete';

  return (
    <div className="flex flex-col gap-3">
      {/* Download button */}
      <div className="flex items-center gap-2">
        <Button
          onClick={handleDownload}
          disabled={selectionCount === 0 || isDownloadActive || !!validationError}
          size="sm"
          aria-label={buttonLabel}
        >
          <Download className="h-4 w-4" />
          {buttonLabel}
        </Button>

        {/* Dismiss button when download is complete or in error state */}
        {(isCompleteState || isErrorState) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            aria-label="Dismiss download status"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Validation error */}
      {validationError && (
        <p className="text-xs text-red-600" role="alert">
          {validationError}
        </p>
      )}

      {/* Progress bar during active download */}
      {activeDownload && (
        <DownloadProgressBar progress={activeDownload} />
      )}

      {/* Error state with retry */}
      {isErrorState && (
        <div className="flex items-center gap-2 mt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={selectionCount === 0}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
