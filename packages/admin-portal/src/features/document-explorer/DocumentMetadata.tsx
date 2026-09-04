import { useState } from 'react';
import {
  Calendar,
  User,
  MapPin,
  FileType,
  Hash,
  Download,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useDocumentMetadata } from './hooks/useDocumentMetadata';
import type { DocumentCategory } from './types';

interface DocumentMetadataProps {
  documentId: string | null;
}

/**
 * Formats a document category to a human-readable label.
 * e.g. 'safety_evidence' → 'Safety Evidence'
 */
function formatCategory(category: DocumentCategory): string {
  return category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * DocumentMetadata displays full metadata detail for a selected document.
 * Shows creation timestamp, creator user, site, document type, SHA-256 hash,
 * and download count. Handles partial unavailability by showing "Unavailable"
 * for null/undefined fields.
 *
 * Requirements: 7.1, 7.4
 */
export function DocumentMetadata({ documentId }: DocumentMetadataProps) {
  const { data, isLoading, isError, error, refetch } = useDocumentMetadata(documentId);

  if (!documentId) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 text-center"
        data-testid="document-metadata-empty"
      >
        <FileType className="text-gray-300 mb-2" size={32} />
        <p className="text-sm text-gray-500">Select a document to view its metadata</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="space-y-4 animate-pulse p-4"
        data-testid="document-metadata-loading"
      >
        <div className="flex items-center gap-2">
          <Loader2 className="animate-spin text-gray-400" size={16} />
          <span className="text-sm text-gray-500">Loading metadata…</span>
        </div>
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 rounded w-2/3" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-200 rounded w-full" />
          <div className="h-4 bg-gray-200 rounded w-1/4" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="document-metadata-error">
        <ErrorDisplay
          error={error}
          title="Failed to load document metadata"
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const document = data?.document ?? null;

  return (
    <div className="space-y-1 p-4" data-testid="document-metadata">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Document Details</h3>
      <dl className="space-y-3">
        <MetadataRow
          icon={<Calendar size={14} className="text-gray-400" />}
          label="Created"
          value={document?.createdAt ?? null}
        />
        <MetadataRow
          icon={<User size={14} className="text-gray-400" />}
          label="Creator"
          value={document?.creatorUserName ?? null}
        />
        <MetadataRow
          icon={<MapPin size={14} className="text-gray-400" />}
          label="Site"
          value={document?.siteName ?? null}
        />
        <MetadataRow
          icon={<FileType size={14} className="text-gray-400" />}
          label="Document Type"
          value={document?.category ? formatCategory(document.category) : null}
        />
        <HashRow
          hash={document?.sha256Hash ?? null}
        />
        <MetadataRow
          icon={<Download size={14} className="text-gray-400" />}
          label="Downloads"
          value={document?.downloadCount != null ? String(document.downloadCount) : null}
        />
      </dl>
    </div>
  );
}

// ─── MetadataRow ───────────────────────────────────────────────────────────────

interface MetadataRowProps {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}

function MetadataRow({ icon, label, value }: MetadataRowProps) {
  return (
    <div className="flex items-start gap-2" data-testid={`metadata-field-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
        <dd className="text-sm text-gray-900 mt-0.5">
          {value != null ? (
            value
          ) : (
            <UnavailableIndicator />
          )}
        </dd>
      </div>
    </div>
  );
}

// ─── HashRow ───────────────────────────────────────────────────────────────────

interface HashRowProps {
  hash: string | null;
}

function HashRow({ hash }: HashRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="flex items-start gap-2" data-testid="metadata-field-sha-256-hash">
      <div className="flex-shrink-0 mt-0.5">
        <Hash size={14} className="text-gray-400" />
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">SHA-256 Hash</dt>
        <dd className="text-sm mt-0.5">
          {hash != null ? (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="font-mono text-xs text-gray-900 break-all text-left hover:text-primary-700 transition-colors"
              title={isExpanded ? 'Click to truncate' : hash}
              aria-label={isExpanded ? 'Click to truncate hash' : 'Click to show full hash'}
            >
              {isExpanded ? hash : `${hash.slice(0, 16)}…`}
            </button>
          ) : (
            <UnavailableIndicator />
          )}
        </dd>
      </div>
    </div>
  );
}

// ─── UnavailableIndicator ─────────────────────────────────────────────────────

function UnavailableIndicator() {
  return (
    <span className="inline-flex items-center gap-1 text-sm text-gray-400 italic">
      <AlertCircle size={12} />
      Unavailable
    </span>
  );
}

export default DocumentMetadata;
