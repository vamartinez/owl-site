import { useState } from 'react';
import { History, FileText, ChevronRight, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useReportHistory, type VersionHistoryEntry } from './hooks/useReportHistory';
import { ComplianceScoreBadge } from './ComplianceScoreBadge';
import type { ValidationResult } from './types';

interface VersionHistoryPanelProps {
  reportId: string;
  onSelectVersion?: (validation: ValidationResult) => void;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VersionHistoryPanel({ reportId, onSelectVersion }: VersionHistoryPanelProps) {
  const { data, isLoading, error, refetch } = useReportHistory(reportId);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  if (error) {
    return (
      <Card>
        <CardHeader title="Version History" />
        <CardContent>
          <ErrorDisplay
            error={error}
            title="Failed to load version history"
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Version History" />
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse flex flex-col items-center gap-2">
              <div className="h-4 w-32 bg-gray-200 rounded" />
              <div className="h-4 w-48 bg-gray-200 rounded" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const history = data?.history ?? [];

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader title="Version History" />
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <History className="text-gray-300 mb-2" size={32} />
            <p className="text-sm text-gray-500">No version history available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleSelectVersion = (entry: VersionHistoryEntry) => {
    if (!entry.validation) return;
    setSelectedVersion(entry.version.version);
    onSelectVersion?.(entry.validation);
  };

  return (
    <Card>
      <CardHeader
        title="Version History"
        description={`${history.length} version${history.length !== 1 ? 's' : ''}`}
      />
      <CardContent className="p-0">
        <ul className="divide-y divide-gray-100" role="list">
          {history.map((entry) => (
            <VersionHistoryItem
              key={entry.version.version}
              entry={entry}
              isSelected={selectedVersion === entry.version.version}
              onSelect={() => handleSelectVersion(entry)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Version History Item ─────────────────────────────────────────────────────

interface VersionHistoryItemProps {
  entry: VersionHistoryEntry;
  isSelected: boolean;
  onSelect: () => void;
}

function VersionHistoryItem({ entry, isSelected, onSelect }: VersionHistoryItemProps) {
  const { version, validation } = entry;
  const hasValidation = !!validation && validation.status === 'completed';
  const findingCount = validation?.findings?.length ?? 0;

  return (
    <li
      className={`
        px-6 py-3 transition-colors
        ${isSelected ? 'bg-primary-50' : 'hover:bg-gray-50'}
        ${hasValidation ? 'cursor-pointer' : ''}
      `}
    >
      <button
        type="button"
        className="w-full text-left"
        onClick={onSelect}
        disabled={!hasValidation}
        aria-label={`View validation result for version ${version.version}`}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-gray-100">
              <FileText className="text-gray-500" size={14} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="default">v{version.version}</Badge>
                <span className="text-sm font-medium text-gray-900 truncate">
                  {version.file_name}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                <span>{formatDate(version.uploaded_at)}</span>
                <span>{formatFileSize(version.file_size)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {hasValidation ? (
              <>
                <div className="flex flex-col items-end gap-0.5">
                  <ComplianceScoreBadge score={validation.score} />
                  <span className="text-xs text-gray-500">
                    {findingCount} finding{findingCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <ChevronRight className="text-gray-400" size={16} />
              </>
            ) : validation?.status === 'failed' || validation?.status === 'timed_out' ? (
              <div className="flex items-center gap-1 text-xs text-red-600">
                <AlertCircle size={12} />
                <span>
                  {validation.status === 'timed_out' ? 'Timed out' : 'Failed'}
                </span>
              </div>
            ) : (
              <span className="text-xs text-gray-400">No validation</span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

export default VersionHistoryPanel;
