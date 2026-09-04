import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Button } from '@/components/ui/Button';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  type ApiListWorkersResponse,
  type WorkerListItem,
  normalizeWorkerListItem,
} from '@/types/api-contracts';

const filterConfigs: FilterConfig[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
    ],
  },
];

export default function WorkerDirectory() {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data: rawData, isLoading } = useApiQuery<ApiListWorkersResponse>(
    ['workers', search, JSON.stringify(activeFilters)],
    '/workers',
    { search, ...activeFilters }
  );

  const data = useMemo(() => {
    if (!rawData) return undefined;
    return {
      workers: rawData.workers.map(normalizeWorkerListItem),
      total: rawData.total,
    };
  }, [rawData]);

  const columns: ColumnDef<WorkerListItem, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'legalName',
        header: 'Name',
        cell: ({ row }) => (
          <Link
            to={`/workers/${row.original.id}`}
            className="font-medium text-primary-600 hover:text-primary-700"
          >
            {row.original.legalName}
          </Link>
        ),
      },
      {
        accessorKey: 'preferredName',
        header: 'Preferred Name',
        cell: ({ getValue }) => getValue() || <span className="text-gray-400">—</span>,
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
      },
      {
        accessorKey: 'languagePreference',
        header: 'Language',
        cell: ({ getValue }) => {
          const lang = getValue() as string;
          const labels: Record<string, string> = { en: 'English', es: 'Spanish', pa: 'Punjabi' };
          return labels[lang] || lang;
        },
      },
      {
        accessorKey: 'createdAt',
        header: 'Registered',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Worker Directory</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} workers registered
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/workers/bulk-import">
            <Button variant="outline" size="sm">
              <Upload size={16} />
              Bulk Import
            </Button>
          </Link>
          <Link to="/workers/onboarding">
            <Button size="sm">
              <Plus size={16} />
              Add Worker
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="w-full sm:w-72">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search workers..."
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
        data={data?.workers ?? []}
        columns={columns}
        pageSize={20}
        emptyMessage={isLoading ? 'Loading workers...' : 'No workers found'}
      />
    </div>
  );
}
