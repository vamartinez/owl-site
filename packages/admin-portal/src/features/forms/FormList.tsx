import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Copy } from 'lucide-react';
import { DataTable } from '@/components/data/DataTable';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useFormsQuery } from './hooks/useFormsQuery';
import { useDuplicateForm } from './hooks/useDuplicateForm';
import { FormStatus, type Form } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusLabels: Record<FormStatus, string> = {
  [FormStatus.BORRADOR]: 'Draft',
  [FormStatus.PUBLICADO]: 'Published',
  [FormStatus.DESPUBLICADO]: 'Unpublished',
};

const statusVariants: Record<FormStatus, 'default' | 'success' | 'warning'> = {
  [FormStatus.BORRADOR]: 'default',
  [FormStatus.PUBLICADO]: 'success',
  [FormStatus.DESPUBLICADO]: 'warning',
};

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Filter Configuration ─────────────────────────────────────────────────────

const filterConfigs: FilterConfig[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: FormStatus.BORRADOR, label: 'Draft' },
      { value: FormStatus.PUBLICADO, label: 'Published' },
      { value: FormStatus.DESPUBLICADO, label: 'Unpublished' },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function FormList() {
  const navigate = useNavigate();
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const statusFilter = activeFilters.status || undefined;
  const { data: forms, isLoading, error, refetch } = useFormsQuery({ status: statusFilter });
  const duplicateMutation = useDuplicateForm();

  const handleCreateForm = () => {
    navigate('/forms/new');
  };

  const handleDuplicate = (formId: string) => {
    duplicateMutation.mutate({ formId });
  };

  const columns = useMemo<ColumnDef<Form, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <button
            onClick={() => navigate(`/forms/${row.original.form_id}`)}
            className="font-medium text-primary-600 hover:text-primary-700 text-left"
          >
            {row.original.name}
          </button>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => {
          const status = getValue<FormStatus>();
          return (
            <Badge variant={statusVariants[status]}>
              {statusLabels[status]}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'created_at',
        header: 'Created',
        cell: ({ getValue }) => formatDate(getValue<string>()),
      },
      {
        accessorKey: 'fields',
        header: 'Responses',
        cell: ({ row }) => {
          // Response count is derived from the current_version presence
          // The actual count comes from the API list response if available
          return <span>{row.original.current_version ? '—' : '0'}</span>;
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDuplicate(row.original.form_id)}
              disabled={duplicateMutation.isPending}
              title="Duplicate form"
            >
              <Copy size={14} />
              Duplicate
            </Button>
          </div>
        ),
      },
    ],
    [navigate, duplicateMutation.isPending]
  );

  if (error) {
    return (
      <ErrorDisplay
        error={error}
        title="Failed to load forms"
        onRetry={() => refetch()}
      />
    );
  }

  const formList = forms ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Forms</h1>
          <p className="mt-1 text-sm text-gray-500">
            {formList.length} form{formList.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={handleCreateForm}>
          <Plus size={16} />
          Create Form
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Filters
          filters={filterConfigs}
          activeFilters={activeFilters}
          onChange={(key, value) =>
            setActiveFilters((prev) => ({ ...prev, [key]: value }))
          }
          onClear={() => setActiveFilters({})}
        />
      </div>

      <DataTable
        data={formList}
        columns={columns}
        pageSize={15}
        emptyMessage={isLoading ? 'Loading forms...' : 'No forms found'}
      />
    </div>
  );
}

export default FormList;
