import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useDocuments } from './hooks/useDocuments';
import { useDocExplorerStore } from './store';
import type { DocumentSummary } from './types';

/**
 * Formats a file size in bytes to a human-readable string.
 * e.g. 1024 → '1.0 KB', 1048576 → '1.0 MB'
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, units.length - 1);
  const value = bytes / Math.pow(k, index);

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * Formats an ISO date string to a readable locale date.
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats a document category to a human-readable label.
 * e.g. 'safety_evidence' → 'Safety Evidence'
 */
function formatCategory(category: string): string {
  return category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * DocumentList renders a paginated table of documents in the current folder.
 * Supports row selection (checkbox per row + select-all), click to preview,
 * and is sorted by creation date descending by default.
 *
 * Requirements: 2.1, 2.2, 2.5
 */
export function DocumentList() {
  const {
    documents,
    isLoading,
    isError,
    error,
    page,
    totalPages,
    goToPage,
  } = useDocuments();

  const selectedDocumentIds = useDocExplorerStore((state) => state.selectedDocumentIds);
  const toggleDocumentSelection = useDocExplorerStore((state) => state.toggleDocumentSelection);
  const selectAll = useDocExplorerStore((state) => state.selectAll);
  const clearSelection = useDocExplorerStore((state) => state.clearSelection);
  const openPreview = useDocExplorerStore((state) => state.openPreview);

  const allSelected =
    documents.length > 0 && documents.every((doc) => selectedDocumentIds.has(doc.id));

  const handleSelectAll = () => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll(documents.map((doc) => doc.id));
    }
  };

  const columns = useMemo<ColumnDef<DocumentSummary, unknown>[]>(
    () => [
      {
        id: 'select',
        header: () => (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={handleSelectAll}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            aria-label="Select all documents"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedDocumentIds.has(row.original.id)}
            onChange={(e) => {
              e.stopPropagation();
              toggleDocumentSelection(row.original.id);
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            aria-label={`Select ${row.original.name}`}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Type',
        cell: ({ getValue }) => formatCategory(getValue<string>()),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ getValue }) => formatDate(getValue<string>()),
      },
      {
        accessorKey: 'siteName',
        header: 'Site',
      },
      {
        accessorKey: 'fileSize',
        header: 'Size',
        cell: ({ getValue }) => formatFileSize(getValue<number>()),
      },
    ],
    [allSelected, selectedDocumentIds, toggleDocumentSelection],
  );

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse" data-testid="document-list-loading">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-10 bg-gray-200 rounded" />
        <div className="h-10 bg-gray-200 rounded" />
        <div className="h-10 bg-gray-200 rounded" />
        <div className="h-10 bg-gray-200 rounded" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorDisplay
        error={error}
        title="Failed to load documents"
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (documents.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 px-4 text-center"
        data-testid="document-list-empty"
      >
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
          <svg
            className="h-6 w-6 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
        </div>
        <h3 className="text-sm font-medium text-gray-900 mb-1">No documents</h3>
        <p className="text-sm text-gray-500">
          There are no documents available in this folder.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="document-list">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id ?? (col as { accessorKey?: string }).accessorKey ?? ''}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {typeof col.header === 'function'
                    ? col.header({} as never)
                    : col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {documents.map((doc) => (
              <tr
                key={doc.id}
                onClick={() => openPreview(doc.id)}
                className="hover:bg-gray-50 transition-colors cursor-pointer"
                data-testid={`document-row-${doc.id}`}
              >
                <td className="px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedDocumentIds.has(doc.id)}
                    onChange={() => toggleDocumentSelection(doc.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    aria-label={`Select ${doc.name}`}
                  />
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className="font-medium text-gray-900">{doc.name}</span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {formatCategory(doc.category)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {formatDate(doc.createdAt)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {doc.siteName}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {formatFileSize(doc.fileSize)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={goToPage}
        />
      )}
    </div>
  );
}
