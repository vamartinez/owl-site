import { useState, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Download, FileText } from 'lucide-react';
import { DataTable } from '@/components/data/DataTable';
import { Pagination } from '@/components/data/Pagination';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useFormResponses } from './hooks/useFormResponses';
import { useFormResponseDetail } from './hooks/useFormResponseDetail';
import { useExportResponses } from './hooks/useExportResponses';
import { FieldType } from './types';
import type { FormResponse, FieldConfig, ListFormResponsesParams } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
const MAX_DATE_RANGE_DAYS = 365;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getDaysDifference(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// ─── Status Options ───────────────────────────────────────────────────────────

const statusOptions = [
  { value: 'recibida', label: 'Received' },
  { value: 'revisada', label: 'Reviewed' },
  { value: 'aprobada', label: 'Approved' },
  { value: 'rechazada', label: 'Rejected' },
];

const statusVariants: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  recibida: 'info',
  revisada: 'default',
  aprobada: 'success',
  rechazada: 'danger',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function FormResponses() {
  const { id: formId } = useParams<{ id: string }>();

  // Modal state for response detail
  const [selectedResponseId, setSelectedResponseId] = useState<string | null>(null);

  // Filter state
  const [currentPage, setCurrentPage] = useState(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [contractorFilter, setContractorFilter] = useState('');
  const [dateError, setDateError] = useState('');

  // Build query params
  const queryParams = useMemo<ListFormResponsesParams>(() => {
    const params: ListFormResponsesParams = { page: currentPage };
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (statusFilter) params.status = statusFilter;
    if (contractorFilter) params.contractor = contractorFilter;
    return params;
  }, [currentPage, startDate, endDate, statusFilter, contractorFilter]);

  const { data, isLoading, error, refetch } = useFormResponses(formId, queryParams);
  const exportMutation = useExportResponses();

  // Date range validation
  const handleStartDateChange = useCallback(
    (value: string) => {
      setStartDate(value);
      setDateError('');
      if (value && endDate) {
        const days = getDaysDifference(value, endDate);
        if (days > MAX_DATE_RANGE_DAYS) {
          setDateError(`The maximum allowed range is ${MAX_DATE_RANGE_DAYS} days`);
        } else if (days < 0) {
          setDateError('The start date must be before the end date');
        }
      }
      setCurrentPage(1);
    },
    [endDate]
  );

  const handleEndDateChange = useCallback(
    (value: string) => {
      setEndDate(value);
      setDateError('');
      if (startDate && value) {
        const days = getDaysDifference(startDate, value);
        if (days > MAX_DATE_RANGE_DAYS) {
          setDateError(`The maximum allowed range is ${MAX_DATE_RANGE_DAYS} days`);
        } else if (days < 0) {
          setDateError('The start date must be before the end date');
        }
      }
      setCurrentPage(1);
    },
    [startDate]
  );

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  }, []);

  const handleContractorChange = useCallback((value: string) => {
    setContractorFilter(value);
    setCurrentPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setStartDate('');
    setEndDate('');
    setStatusFilter('');
    setContractorFilter('');
    setDateError('');
    setCurrentPage(1);
  }, []);

  const handleExport = useCallback(() => {
    if (formId) {
      exportMutation.mutate({ formId });
    }
  }, [formId, exportMutation]);

  const handleRowClick = useCallback(
    (responseId: string) => {
      setSelectedResponseId(responseId);
    },
    []
  );

  // Fetch response detail when modal is open
  const { data: detailData, isLoading: isDetailLoading } = useFormResponseDetail(
    selectedResponseId ? formId : undefined,
    selectedResponseId ?? undefined
  );

  // Table columns
  const columns = useMemo<ColumnDef<FormResponse, unknown>[]>(
    () => [
      {
        accessorKey: 'folio',
        header: 'Folio',
        cell: ({ row }) => (
          <button
            onClick={() => handleRowClick(row.original.response_id)}
            className="font-mono font-medium text-primary-600 hover:text-primary-700"
          >
            {row.original.folio}
          </button>
        ),
      },
      {
        accessorKey: 'submitted_at',
        header: 'Submitted',
        cell: ({ getValue }) => formatDate(getValue<string>()),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const status = (row.original as FormResponse & { status?: string }).status || 'recibida';
          const variant = statusVariants[status] || 'default';
          const label = statusOptions.find((o) => o.value === status)?.label || status;
          return <Badge variant={variant}>{label}</Badge>;
        },
      },
      {
        id: 'contractor',
        header: 'Contractor',
        cell: ({ row }) => {
          const metadata = row.original.metadata;
          return (
            <span className="text-gray-600">
              {metadata?.ip_address || '—'}
            </span>
          );
        },
      },
    ],
    [handleRowClick]
  );

  // Pagination
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const responses = data?.responses ?? [];
  const hasFilters = !!(startDate || endDate || statusFilter || contractorFilter);

  if (error) {
    return (
      <ErrorDisplay
        error={error}
        title="Failed to load responses"
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Responses</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data
              ? `${data.total} response${data.total !== 1 ? 's' : ''} found`
              : 'Loading responses...'}
          </p>
        </div>
        <Button
          onClick={handleExport}
          variant="outline"
          disabled={exportMutation.isPending || !formId}
        >
          <Download size={16} />
          {exportMutation.isPending ? 'Exporting...' : 'Export CSV'}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Date range */}
          <div className="space-y-1">
            <label htmlFor="start-date" className="block text-xs font-medium text-gray-600">
              From
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => handleStartDateChange(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5
                focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
              aria-label="Start date"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="end-date" className="block text-xs font-medium text-gray-600">
              To
            </label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => handleEndDateChange(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5
                focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
              aria-label="End date"
            />
          </div>

          {/* Status filter */}
          <div className="space-y-1">
            <label htmlFor="status-filter" className="block text-xs font-medium text-gray-600">
              Status
            </label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5
                focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
              aria-label="Filter by status"
            >
              <option value="">All</option>
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Contractor filter */}
          <div className="space-y-1">
            <label htmlFor="contractor-filter" className="block text-xs font-medium text-gray-600">
              Contractor
            </label>
            <input
              id="contractor-filter"
              type="text"
              value={contractorFilter}
              onChange={(e) => handleContractorChange(e.target.value)}
              placeholder="Search contractor..."
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5
                focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
              aria-label="Filter by contractor"
            />
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={handleClearFilters}
              className="text-xs text-gray-500 hover:text-gray-700 pb-1.5"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Date range error */}
        {dateError && (
          <p className="text-xs text-red-600" role="alert">
            {dateError}
          </p>
        )}
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : responses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileText size={48} className="text-gray-300 mb-4" />
          <p className="text-sm text-gray-500">
            {hasFilters
              ? 'No responses found for the selected criteria'
              : 'No responses received for this form yet'}
          </p>
          {hasFilters && (
            <button
              onClick={handleClearFilters}
              className="mt-2 text-sm text-primary-600 hover:text-primary-700"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <DataTable
            data={responses}
            columns={columns}
            pageSize={PAGE_SIZE}
            emptyMessage="No responses found"
          />

          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}

      {/* Response Detail Modal */}
      <Modal
        open={!!selectedResponseId}
        onClose={() => setSelectedResponseId(null)}
        title="Response Detail"
        size="lg"
      >
        {isDetailLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : detailData ? (
          <ResponseDetailModal response={detailData.response} version={detailData.version} />
        ) : (
          <p className="text-sm text-gray-500 text-center py-8">
            Could not load the response detail
          </p>
        )}
      </Modal>
    </div>
  );
}

// ─── Response Detail Modal Content ────────────────────────────────────────────

function ResponseDetailModal({
  response,
  version,
}: {
  response: FormResponse;
  version: { version_number: number; fields_snapshot: FieldConfig[] };
}) {
  const fields = [...version.fields_snapshot].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      {/* Metadata */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-gray-500">Folio:</span>{' '}
          <span className="font-mono font-medium">{response.folio}</span>
        </div>
        <div>
          <span className="text-gray-500">Date:</span>{' '}
          <span>{formatDate(response.submitted_at)}</span>
        </div>
        <div>
          <span className="text-gray-500">Origin:</span>{' '}
          <span>{response.metadata?.origin_type || '—'}</span>
        </div>
        <div>
          <span className="text-gray-500">Version:</span>{' '}
          <span>v{version.version_number}</span>
        </div>
      </div>

      <hr className="border-gray-200" />

      {/* Field answers */}
      <dl className="space-y-3">
        {fields.map((field) => {
          const value = response.answers[field.field_id];
          return (
            <div key={field.field_id} className="space-y-0.5">
              <dt className="text-sm font-medium text-gray-700">
                {field.label}
                {field.required && <span className="text-red-500 ml-0.5">*</span>}
              </dt>
              <dd className="text-sm text-gray-900">
                <FieldValueDisplay field={field} value={value} />
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function FieldValueDisplay({ field, value }: { field: FieldConfig; value: unknown }) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-gray-400 italic">No answer</span>;
  }

  switch (field.type) {
    case FieldType.CHECKBOX_ACEPTACION:
      return <Badge variant={value ? 'success' : 'default'}>{value ? 'Accepted' : 'Not accepted'}</Badge>;

    case FieldType.SELECCION_MULTIPLE:
      if (Array.isArray(value)) {
        return (
          <div className="flex flex-wrap gap-1">
            {value.map((v, i) => {
              const option = field.options?.find((o) => o.option_id === v);
              return <Badge key={i} variant="info">{option?.label ?? String(v)}</Badge>;
            })}
          </div>
        );
      }
      return <span>{String(value)}</span>;

    case FieldType.SELECCION_SIMPLE: {
      const option = field.options?.find((o) => o.option_id === value);
      return <span>{option?.label ?? String(value)}</span>;
    }

    case FieldType.TEXTO_LARGO:
      return <p className="whitespace-pre-wrap">{String(value)}</p>;

    default:
      return <span>{String(value)}</span>;
  }
}

export default FormResponses;
