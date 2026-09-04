import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { type ColumnDef } from '@tanstack/react-table';
import { ClipboardList } from 'lucide-react';

interface Visit {
  id: string;
  workerName: string;
  site: string;
  checkInTime: string;
  checkOutTime: string | null;
  duration: string | null;
  decision: 'allowed' | 'conditional' | 'denied';
}

interface VisitLogResponse {
  visits: Visit[];
  total: number;
}

const filterConfigs: FilterConfig[] = [
  {
    key: 'decision',
    label: 'Decision',
    options: [
      { value: 'allowed', label: 'Allowed' },
      { value: 'conditional', label: 'Conditional' },
      { value: 'denied', label: 'Denied' },
    ],
  },
  {
    key: 'period',
    label: 'Period',
    options: [
      { value: 'today', label: 'Today' },
      { value: 'week', label: 'This Week' },
      { value: 'month', label: 'This Month' },
    ],
  },
];

const decisionVariants = {
  allowed: 'success' as const,
  conditional: 'warning' as const,
  denied: 'danger' as const,
};

export default function VisitLog() {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<VisitLogResponse>(
    ['site-access', 'visits', search, JSON.stringify(activeFilters)],
    '/site-access/visits',
    { search, ...activeFilters }
  );

  const columns: ColumnDef<Visit, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'workerName',
        header: 'Worker',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'site',
        header: 'Site',
      },
      {
        accessorKey: 'checkInTime',
        header: 'Check-In',
        cell: ({ getValue }) =>
          new Date(getValue() as string).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          }),
      },
      {
        accessorKey: 'checkOutTime',
        header: 'Check-Out',
        cell: ({ getValue }) => {
          const val = getValue() as string | null;
          return val
            ? new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : <Badge variant="info">On site</Badge>;
        },
      },
      {
        accessorKey: 'duration',
        header: 'Duration',
        cell: ({ getValue }) => (getValue() as string) || '—',
      },
      {
        accessorKey: 'decision',
        header: 'Decision',
        cell: ({ getValue }) => {
          const decision = getValue() as Visit['decision'];
          return <Badge variant={decisionVariants[decision]}>{decision}</Badge>;
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Visit Log</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} visit records
          </p>
        </div>
        <ClipboardList size={24} className="text-gray-400" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="w-full sm:w-72">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search visits..."
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
        data={data?.visits ?? []}
        columns={columns}
        pageSize={25}
        emptyMessage={isLoading ? 'Loading...' : 'No visits found'}
      />
    </div>
  );
}
