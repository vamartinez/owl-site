import { FolderOpen, SearchX } from 'lucide-react';

export type EmptyStateVariant = 'empty-folder' | 'no-results';

interface EmptyStateProps {
  variant: EmptyStateVariant;
  onClearFilters?: () => void;
}

export function EmptyState({ variant, onClearFilters }: EmptyStateProps) {
  const isNoResults = variant === 'no-results';

  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-4 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
        {isNoResults ? (
          <SearchX className="text-gray-400" size={24} aria-hidden="true" />
        ) : (
          <FolderOpen className="text-gray-400" size={24} aria-hidden="true" />
        )}
      </div>

      <p className="text-sm text-gray-600 max-w-md">
        {isNoResults
          ? 'No documents match the current criteria'
          : 'No documents are available in this location'}
      </p>

      {isNoResults && onClearFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
