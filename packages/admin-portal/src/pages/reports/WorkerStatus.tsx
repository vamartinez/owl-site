import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { type ColumnDef } from '@tanstack/react-table';
import { Download } from 'lucide-react';

interface WorkerStatusRow {
  id: string;
  name: string;
  contractor: string;
  site: string;
  complianceStatus: 'compliant' | 'non_compliant' | 'pending';
  activeCerts: number;
  expiredCerts: number;
  lastCheckIn: string | null;
}

interface WorkerStatusResponse {
  workers: WorkerStatusRow[];
  total: number;
}

const statusVariants = {
  compliant: 'success' as const,
  non_compliant: 'danger' as const,
  pending: 'warning' as const,
};

const filterConfigs: FilterConfig[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'compliant', label: 'Compliant' },
      { value: 'non_compliant', label: 'Non-Compliant' },
      { value: 'pending', label: 'Pending' },
    ],
  },
];

export default function WorkerStatus() {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<WorkerStatusResponse>(
    ['reports', 'worker-status', search, JSON.stringify(activeFilters)],
    '/reports/worker-status',
    { search, ...activeFilters }
  );

  const columns: ColumnDef<WorkerStatusRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Worker',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'contractor',
        header: 'Contractor',
      },
      {
        accessorKey: 'site',
        header: 'Site',
      },
      {
        accessorKey: 'activeCerts',
        header: 'Active Certs',
      },
      {
        accessorKey: 'expiredCerts',
        header: 'Expired',
        cell: ({ getValue }) => {
          const count = getValue() as number;
          return count > 0 ? (
            <Badge variant="danger">{count}</Badge>
          ) : (
            <span className="text-gray-400">0</span>
          );
        },
      },
      {
        accessorKey: 'complianceStatus',
        header: 'Status',
        cell: ({ getValue }) => {
          const status = getValue() as WorkerStatusRow['complianceStatus'];
          return <Badge variant={statusVariants[status]}>{status.replace('_', ' ')}</Badge>;
        },
      },
      {
        accessorKey: 'lastCheckIn',
        header: 'Last Check-In',
        cell: ({ getValue }) => {
          const val = getValue() as string | null;
          return val ? new Date(val).toLocaleDateString() : <span className="text-gray-400">Never</span>;
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Worker Status Report</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} workers
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Download size={16} />
          Export CSV
        </Button>
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
        pageSize={25}
        emptyMessage={isLoading ? 'Loading...' : 'No workers found'}
      />
    </div>
  );
}
