import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { type ColumnDef } from '@tanstack/react-table';
import { Download } from 'lucide-react';

interface AccessLogEntry {
  id: string;
  workerName: string;
  site: string;
  decision: 'allowed' | 'conditional' | 'denied';
  timestamp: string;
  method: string;
  operator: string;
}

interface SiteAccessLogsResponse {
  logs: AccessLogEntry[];
  total: number;
}

const decisionVariants = {
  allowed: 'success' as const,
  conditional: 'warning' as const,
  denied: 'danger' as const,
};

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
      { value: 'quarter', label: 'This Quarter' },
    ],
  },
];

export default function SiteAccessLogs() {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<SiteAccessLogsResponse>(
    ['reports', 'site-access-logs', search, JSON.stringify(activeFilters)],
    '/reports/site-access-logs',
    { search, ...activeFilters }
  );

  const columns: ColumnDef<AccessLogEntry, unknown>[] = useMemo(
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
        accessorKey: 'decision',
        header: 'Decision',
        cell: ({ getValue }) => {
          const decision = getValue() as AccessLogEntry['decision'];
          return <Badge variant={decisionVariants[decision]}>{decision}</Badge>;
        },
      },
      {
        accessorKey: 'method',
        header: 'Method',
      },
      {
        accessorKey: 'operator',
        header: 'Operator',
      },
      {
        accessorKey: 'timestamp',
        header: 'Timestamp',
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
          <h1 className="text-2xl font-semibold text-gray-900">Site Access Logs</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} access log entries
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
            placeholder="Search logs..."
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
        data={data?.logs ?? []}
        columns={columns}
        pageSize={25}
        emptyMessage={isLoading ? 'Loading...' : 'No access logs found'}
      />
    </div>
  );
}
