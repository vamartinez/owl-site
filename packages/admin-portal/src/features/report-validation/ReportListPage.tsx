import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { DataTable } from '@/components/data/DataTable';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { PageContainer } from '@/components/layout/PageContainer';
import { useReports, type UseReportsParams } from './hooks';
import { type Report, type ReportStatus } from './types';
import { getScoreColor } from './utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusLabels: Record<ReportStatus, string> = {
  draft: 'Draft',
  validating: 'Validating',
  validated: 'Validated',
  submitted: 'Submitted',
};

const statusVariants: Record<ReportStatus, 'default' | 'success' | 'warning' | 'info' | 'purple'> = {
  draft: 'default',
  validating: 'info',
  validated: 'success',
  submitted: 'purple',
};

const scoreColorVariants: Record<string, 'success' | 'warning' | 'danger'> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
};

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function truncateTitle(title: string, maxLength = 100): string {
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength)}…`;
}

// ─── Filter Configuration ─────────────────────────────────────────────────────

const filterConfigs: FilterConfig[] = [
  {
    key: 'status',
    label: 'All Statuses',
    options: [
      { value: 'draft', label: 'Draft' },
      { value: 'validating', label: 'Validating' },
      { value: 'validated', label: 'Validated' },
      { value: 'submitted', label: 'Submitted' },
    ],
  },
  {
    key: 'sort_by',
    label: 'Sort By',
    options: [
      { value: 'upload_date', label: 'Upload Date' },
      { value: 'validation_date', label: 'Validation Date' },
    ],
  },
  {
    key: 'sort_order',
    label: 'Order',
    options: [
      { value: 'desc', label: 'Newest First' },
      { value: 'asc', label: 'Oldest First' },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export function ReportListPage() {
  const navigate = useNavigate();
  // Cursor-based pagination: the backend returns an opaque `next_cursor` and does
  // not support jumping to an arbitrary page number. We keep a stack of the cursors
  // used to reach each page so "Previous" can walk back. `cursorStack[i]` is the
  // cursor that produced the page currently shown at 1-based page (i + 1); the first
  // page uses `undefined`.
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const currentCursor = cursorStack[cursorStack.length - 1];
  const pageNumber = cursorStack.length;

  const queryParams: UseReportsParams = {
    cursor: currentCursor,
    limit: PAGE_SIZE,
    status: (activeFilters.status as ReportStatus) || undefined,
    sort_by: (activeFilters.sort_by as 'upload_date' | 'validation_date') || 'upload_date',
    sort_order: (activeFilters.sort_order as 'asc' | 'desc') || 'desc',
  };

  const { data, isLoading, error, refetch } = useReports(queryParams);

  const reports = data?.reports ?? [];
  const nextCursor = data?.pagination?.next_cursor;
  const hasNextPage = Boolean(nextCursor);
  const hasPrevPage = cursorStack.length > 1;

  const resetPagination = () => setCursorStack([undefined]);

  const handleNextPage = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, nextCursor]);
  };

  const handlePrevPage = () => {
    setCursorStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const handleFilterChange = (key: string, value: string) => {
    setActiveFilters((prev) => ({ ...prev, [key]: value }));
    resetPagination();
  };

  const handleClearFilters = () => {
    setActiveFilters({});
    resetPagination();
  };

  const columns = useMemo<ColumnDef<Report, unknown>[]>(
    () => [
      {
        accessorKey: 'title',
        header: 'Title',
        cell: ({ row }) => (
          <button
            onClick={() => navigate(`/reports/${row.original.report_id}`)}
            className="font-medium text-primary-600 hover:text-primary-700 text-left"
          >
            {truncateTitle(row.original.title)}
          </button>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = row.original.status;
          return (
            <div className="flex items-center gap-2">
              <Badge variant={statusVariants[status]}>
                {statusLabels[status]}
              </Badge>
              {status === 'validating' && (
                <span
                  className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse"
                  aria-label="Validation in progress"
                />
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'latest_score',
        header: 'Score',
        cell: ({ getValue }) => {
          const score = getValue<number | undefined>();
          if (score === undefined || score === null) {
            return <span className="text-gray-400">—</span>;
          }
          const color = getScoreColor(score);
          return (
            <Badge variant={scoreColorVariants[color]}>
              {score}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'created_at',
        header: 'Upload Date',
        cell: ({ getValue }) => formatDate(getValue<string>()),
      },
      {
        accessorKey: 'latest_validation_date',
        header: 'Validation Date',
        cell: ({ getValue }) => {
          const date = getValue<string | undefined>();
          return date ? formatDate(date) : <span className="text-gray-400">—</span>;
        },
      },
      {
        accessorKey: 'current_version',
        header: 'Versions',
        cell: ({ getValue }) => getValue<number>(),
      },
    ],
    [navigate]
  );

  if (error) {
    return (
      <PageContainer title="Reports">
        <ErrorDisplay
          error={error}
          title="Failed to load reports"
          onRetry={() => refetch()}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Reports"
      description="Upload, validate, and submit construction reports for compliance review"
      actions={
        <Button onClick={() => navigate('/reports/new')}>
          <Plus size={16} />
          Upload Report
        </Button>
      }
    >
      <div className="space-y-4">
        <Filters
          filters={filterConfigs}
          activeFilters={activeFilters}
          onChange={handleFilterChange}
          onClear={handleClearFilters}
        />

        {!isLoading && reports.length === 0 && !activeFilters.status ? (
          <EmptyState onUpload={() => navigate('/reports/new')} />
        ) : (
          <>
            <DataTable
              data={reports}
              columns={columns}
              pageSize={PAGE_SIZE}
              emptyMessage={
                isLoading
                  ? 'Loading reports...'
                  : 'No reports match the selected filters'
              }
            />

            {(hasPrevPage || hasNextPage) && (
              <nav
                className="flex items-center justify-between"
                aria-label="Pagination"
              >
                <p className="text-sm text-gray-500">Page {pageNumber}</p>

                <div className="flex items-center gap-1">
                  <button
                    onClick={handlePrevPage}
                    disabled={!hasPrevPage || isLoading}
                    className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={handleNextPage}
                    disabled={!hasNextPage || isLoading}
                    className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Next page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="flex items-center justify-center h-16 w-16 rounded-full bg-gray-100 mb-4">
        <FileText className="text-gray-400" size={32} />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-1">No reports yet</h3>
      <p className="text-sm text-gray-600 max-w-sm mb-6">
        Upload your first construction report to get started with AI-powered compliance validation against BC construction laws.
      </p>
      <Button onClick={onUpload}>
        <Plus size={16} />
        Upload Your First Report
      </Button>
    </div>
  );
}

export default ReportListPage;
