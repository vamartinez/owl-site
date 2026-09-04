import { Folder } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useFolders } from './hooks/useFolders';
import { useDocExplorerStore } from './store';
import { EmptyState } from './EmptyState';
import type { FolderNode } from './types';

/**
 * Formats an ISO 8601 timestamp into a short readable date string.
 */
function formatLastUpdated(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function FolderTreeSkeleton() {
  return (
    <div className="space-y-2 animate-pulse" data-testid="folder-tree-loading">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <div className="h-5 w-5 bg-gray-200 rounded" />
          <div className="flex-1 space-y-1">
            <div className="h-4 bg-gray-200 rounded w-2/3" />
            <div className="h-3 bg-gray-200 rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface FolderItemProps {
  folder: FolderNode;
  onClick: () => void;
}

function FolderItem({ folder, onClick }: FolderItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
      aria-label={`Open folder ${folder.name}`}
    >
      <Folder className="text-gray-400 shrink-0" size={18} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">
            {folder.name}
          </span>
          <Badge variant="default">{folder.documentCount}</Badge>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {formatLastUpdated(folder.lastUpdated)}
        </p>
      </div>
    </button>
  );
}

export function FolderTree() {
  const { data, isLoading, error, refetch } = useFolders();
  const currentPath = useDocExplorerStore((s) => s.currentPath);
  const navigateTo = useDocExplorerStore((s) => s.navigateTo);

  if (isLoading) {
    return <FolderTreeSkeleton />;
  }

  if (error) {
    return (
      <ErrorDisplay
        error={error}
        title="Failed to load folders"
        onRetry={() => refetch()}
        variant="inline"
      />
    );
  }

  const folders = data?.folders ?? [];
  const documents = data?.documents ?? [];

  if (folders.length === 0 && documents.length === 0) {
    return <EmptyState variant="empty-folder" />;
  }

  return (
    <nav aria-label="Folder navigation" className="space-y-1">
      {folders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          onClick={() => navigateTo([...currentPath, folder.name])}
        />
      ))}
    </nav>
  );
}
