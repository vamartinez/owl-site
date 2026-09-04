import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useDocumentUrl } from './hooks/useDocumentUrl';
import type { Certification } from './types';

interface DocumentViewerModalProps {
  open: boolean;
  onClose: () => void;
  certification: Certification;
  workerId: string;
}

export function DocumentViewerModal({
  open,
  onClose,
  certification,
  workerId,
}: DocumentViewerModalProps) {
  const hasDocument = !!certification.document_key;
  const { data, isLoading, error, refetch } = useDocumentUrl(
    workerId,
    certification.certification_id,
    open && hasDocument
  );

  return (
    <Modal open={open} onClose={onClose} title="Certification Document" size="lg">
      {!hasDocument && <NoDocumentAvailable />}
      {hasDocument && isLoading && <LoadingIndicator />}
      {hasDocument && error && <ErrorState error={error} onRetry={() => refetch()} />}
      {hasDocument && data && (
        <DocumentRenderer
          url={data.url}
          contentType={data.content_type}
          certification={certification}
        />
      )}
    </Modal>
  );
}

function NoDocumentAvailable() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-gray-700">No document available for this certification.</p>
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-primary-600" />
    </div>
  );
}

interface ErrorStateProps {
  error: { status?: number; message?: string };
  onRetry: () => void;
}

function ErrorState({ error, onRetry }: ErrorStateProps) {
  const is404 = error.status === 404;

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-gray-700 mb-4">
        {is404
          ? 'Document not found. It may have been removed.'
          : 'Failed to load the document. Please try again.'}
      </p>
      {!is404 && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

interface DocumentRendererProps {
  url: string;
  contentType: string;
  certification: Certification;
}

function DocumentRenderer({ url, contentType, certification }: DocumentRendererProps) {
  const [loadError, setLoadError] = useState(false);

  if (loadError) {
    return (
      <div className="flex items-center justify-center py-12 text-center text-red-600">
        The document could not be rendered.
      </div>
    );
  }

  if (contentType === 'application/pdf') {
    return (
      <iframe
        src={url}
        title={`${certification.certification_type} certification document`}
        className="w-full h-[70vh] border-0 rounded"
        onError={() => setLoadError(true)}
      />
    );
  }

  if (contentType === 'image/jpeg' || contentType === 'image/png') {
    return (
      <img
        src={url}
        alt={`${certification.certification_type} certification document from ${certification.issuer}`}
        className="max-w-full max-h-[70vh] mx-auto rounded"
        onError={() => setLoadError(true)}
      />
    );
  }

  return (
    <div className="flex items-center justify-center py-12 text-center text-gray-600">
      Unsupported document format.
    </div>
  );
}
