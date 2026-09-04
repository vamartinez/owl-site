import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/charts/StatusBadge';
import { type ColumnDef } from '@tanstack/react-table';
import { Brain, Upload } from 'lucide-react';

interface Finding {
  id: string;
  title: string;
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  site: string;
  status: 'open' | 'in_review' | 'resolved' | 'dismissed';
  detectedAt: string;
  evidenceType: string;
}

interface FindingsResponse {
  findings: Finding[];
  total: number;
}

const statusVariants = {
  open: 'danger' as const,
  in_review: 'warning' as const,
  resolved: 'success' as const,
  dismissed: 'default' as const,
};

const filterConfigs: FilterConfig[] = [
  {
    key: 'severity',
    label: 'Severity',
    options: [
      { value: 'critical', label: 'Critical' },
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Medium' },
      { value: 'low', label: 'Low' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'in_review', label: 'In Review' },
      { value: 'resolved', label: 'Resolved' },
      { value: 'dismissed', label: 'Dismissed' },
    ],
  },
];

export default function Findings() {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<FindingsResponse>(
    ['safety-ai', 'findings', search, JSON.stringify(activeFilters)],
    '/safety-ai/findings',
    { search, ...activeFilters }
  );

  const columns: ColumnDef<Finding, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'title',
        header: 'Finding',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'rule',
        header: 'Rule',
        cell: ({ getValue }) => (
          <Badge variant="info">{getValue() as string}</Badge>
        ),
      },
      {
        accessorKey: 'severity',
        header: 'Severity',
        cell: ({ getValue }) => (
          <StatusBadge status={getValue() as 'critical' | 'high' | 'medium' | 'low'} />
        ),
      },
      {
        accessorKey: 'site',
        header: 'Site',
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => {
          const status = getValue() as Finding['status'];
          return <Badge variant={statusVariants[status]}>{status.replace('_', ' ')}</Badge>;
        },
      },
      {
        accessorKey: 'detectedAt',
        header: 'Detected',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">AI Safety Findings</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} findings detected by Safety AI
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/safety-ai/upload">
            <Button>
              <Upload size={16} />
              New Scan
            </Button>
          </Link>
          <Brain size={24} className="text-purple-600" />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="w-full sm:w-72">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search findings..."
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
        data={data?.findings ?? []}
        columns={columns}
        pageSize={20}
        emptyMessage={isLoading ? 'Loading findings...' : 'No findings found'}
      />
    </div>
  );
}
