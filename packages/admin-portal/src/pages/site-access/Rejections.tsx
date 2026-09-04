import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { type ColumnDef } from '@tanstack/react-table';
import { ShieldX } from 'lucide-react';

interface Rejection {
  id: string;
  workerName: string;
  site: string;
  reason: string;
  timestamp: string;
  missingRequirements: string[];
}

interface RejectionsResponse {
  rejections: Rejection[];
  total: number;
}

const filterConfigs: FilterConfig[] = [
  {
    key: 'reason',
    label: 'Reason',
    options: [
      { value: 'expired_cert', label: 'Expired Certification' },
      { value: 'missing_cert', label: 'Missing Certification' },
      { value: 'blacklisted', label: 'Blacklisted' },
      { value: 'no_assignment', label: 'No Site Assignment' },
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

export default function Rejections() {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<RejectionsResponse>(
    ['site-access', 'rejections', search, JSON.stringify(activeFilters)],
    '/site-access/rejections',
    { search, ...activeFilters }
  );

  const columns: ColumnDef<Rejection, unknown>[] = useMemo(
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
        accessorKey: 'reason',
        header: 'Reason',
        cell: ({ getValue }) => (
          <Badge variant="danger">{getValue() as string}</Badge>
        ),
      },
      {
        accessorKey: 'missingRequirements',
        header: 'Missing',
        cell: ({ getValue }) => {
          const reqs = getValue() as string[];
          return reqs.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {reqs.slice(0, 2).map((r) => (
                <Badge key={r} variant="warning">{r}</Badge>
              ))}
              {reqs.length > 2 && (
                <Badge variant="default">+{reqs.length - 2}</Badge>
              )}
            </div>
          ) : (
            <span className="text-gray-400">—</span>
          );
        },
      },
      {
        accessorKey: 'timestamp',
        header: 'Time',
        cell: ({ getValue }) =>
          new Date(getValue() as string).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          }),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Access Rejections</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} rejected access attempts
          </p>
        </div>
        <ShieldX size={24} className="text-red-500" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="w-full sm:w-72">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search rejections..."
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
        data={data?.rejections ?? []}
        columns={columns}
        pageSize={20}
        emptyMessage={isLoading ? 'Loading...' : 'No rejections found'}
      />
    </div>
  );
}
