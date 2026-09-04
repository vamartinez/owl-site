import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useApiQuery, useApiMutation, useInvalidateQueries } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Site {
  id: string;
  name: string;
  address: string;
  activeWorkers: number;
  compliancePercent: number;
  status: 'active' | 'inactive' | 'setup';
  contractor: string;
}

interface SitesResponse {
  sites: Site[];
  total: number;
}

const statusVariants = {
  active: 'success' as const,
  inactive: 'default' as const,
  setup: 'warning' as const,
};

const filterConfigs: FilterConfig[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'setup', label: 'Setup' },
    ],
  },
];

export default function SiteList() {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const { error, setError, clearError } = useErrorHandler();
  const invalidate = useInvalidateQueries();

  const { data, isLoading } = useApiQuery<SitesResponse>(
    ['sites', search, JSON.stringify(activeFilters)],
    '/sites',
    { search, ...activeFilters }
  );

  const { register, handleSubmit, reset, formState: { errors: formErrors } } = useForm<{
    name: string;
    address: string;
    timezone: string;
  }>();

  const { mutate: createSite, isPending } = useApiMutation<Site, Record<string, string>>(
    'post',
    '/sites',
    {
      onSuccess: () => {
        setShowAddModal(false);
        clearError();
        reset();
        invalidate([['sites']]);
      },
      onError: (err) => setError(err),
    }
  );

  const columns: ColumnDef<Site, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Site Name',
        cell: ({ row }) => (
          <Link
            to={`/sites/${row.original.id}`}
            className="font-medium text-primary-600 hover:text-primary-700"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'address',
        header: 'Address',
      },
      {
        accessorKey: 'contractor',
        header: 'Contractor',
      },
      {
        accessorKey: 'activeWorkers',
        header: 'Workers',
      },
      {
        accessorKey: 'compliancePercent',
        header: 'Compliance',
        cell: ({ getValue }) => {
          const pct = getValue() as number | undefined;
          if (pct === undefined || pct === null) return <span className="text-gray-400">N/A</span>;
          return (
            <Badge variant={pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger'}>
              {pct}%
            </Badge>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => {
          const status = getValue() as Site['status'];
          return <Badge variant={statusVariants[status]}>{status}</Badge>;
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Sites</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} sites registered
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAddModal(true)}>
          <Plus size={16} />
          Add Site
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="w-full sm:w-72">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search sites..."
          />
        </div>
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
        data={data?.sites ?? []}
        columns={columns}
        pageSize={15}
        emptyMessage={isLoading ? 'Loading sites...' : 'No sites found'}
      />

      {/* Add Site Modal */}
      <Modal
        open={showAddModal}
        onClose={() => { setShowAddModal(false); clearError(); reset(); }}
        title="Add New Site"
      >
        <form onSubmit={handleSubmit((data) => createSite(data))} className="space-y-4">
          <ErrorDisplay
            error={error ? new Error(error.message) : null}
            title={error?.title}
            variant="banner"
            onDismiss={clearError}
            debugInfo={error?.debugInfo}
          />

          <Input
            label="Site Name"
            {...register('name', { required: 'Site name is required' })}
            error={formErrors.name?.message}
            placeholder="e.g., Downtown Tower Project"
          />

          <Input
            label="Address"
            {...register('address', { required: 'Address is required' })}
            error={formErrors.address?.message}
            placeholder="e.g., 123 Main St, Vancouver, BC"
          />

          <Select
            label="Timezone"
            {...register('timezone')}
            options={[
              { value: 'America/Vancouver', label: 'Pacific (Vancouver)' },
              { value: 'America/Edmonton', label: 'Mountain (Edmonton)' },
              { value: 'America/Toronto', label: 'Eastern (Toronto)' },
            ]}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setShowAddModal(false); clearError(); reset(); }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating...' : 'Create Site'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
