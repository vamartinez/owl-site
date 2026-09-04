import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/charts/StatusBadge';
import { Button } from '@/components/ui/Button';
import { BarChart } from '@/components/charts/BarChart';
import { Card, CardContent } from '@/components/ui/Card';
import { type ColumnDef } from '@tanstack/react-table';
import { Download } from 'lucide-react';

interface SafetyFinding {
  id: string;
  title: string;
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  site: string;
  status: 'open' | 'resolved' | 'dismissed';
  detectedAt: string;
  resolvedAt: string | null;
}

interface SafetyFindingsResponse {
  findings: SafetyFinding[];
  total: number;
  bySeverity: { severity: string; count: number }[];
}

const statusVariants = {
  open: 'danger' as const,
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
      { value: 'resolved', label: 'Resolved' },
      { value: 'dismissed', label: 'Dismissed' },
    ],
  },
];

export default function SafetyFindings() {
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<SafetyFindingsResponse>(
    ['reports', 'safety-findings', JSON.stringify(activeFilters)],
    '/reports/safety-findings',
    activeFilters
  );

  const columns: ColumnDef<SafetyFinding, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'title',
        header: 'Finding',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue() as string}</span>
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
        accessorKey: 'rule',
        header: 'Rule',
        cell: ({ getValue }) => (
          <Badge variant="info">{getValue() as string}</Badge>
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
          const status = getValue() as SafetyFinding['status'];
          return <Badge variant={statusVariants[status]}>{status}</Badge>;
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
          <h1 className="text-2xl font-semibold text-gray-900">Safety Findings Report</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} total findings
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Download size={16} />
          Export
        </Button>
      </div>

      {data?.bySeverity && data.bySeverity.length > 0 && (
        <Card>
          <CardContent>
            <BarChart
              data={data.bySeverity}
              dataKey="count"
              xAxisKey="severity"
              color="#f59e0b"
              height={200}
              label="Findings by Severity"
            />
          </CardContent>
        </Card>
      )}

      <Filters
        filters={filterConfigs}
        activeFilters={activeFilters}
        onChange={(key, value) =>
          setActiveFilters((prev) => ({ ...prev, [key]: value }))
        }
        onClear={() => setActiveFilters({})}
      />

      <DataTable
        data={data?.findings ?? []}
        columns={columns}
        pageSize={20}
        emptyMessage={isLoading ? 'Loading...' : 'No findings found'}
      />
    </div>
  );
}
