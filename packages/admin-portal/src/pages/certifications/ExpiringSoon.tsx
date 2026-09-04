import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { type ColumnDef } from '@tanstack/react-table';
import { Clock } from 'lucide-react';

interface ExpiringCert {
  id: string;
  workerName: string;
  workerId: string;
  certType: string;
  expiryDate: string;
  daysRemaining: number;
  site: string;
}

interface ExpiringSoonResponse {
  certifications: ExpiringCert[];
  total: number;
}

const filterConfigs: FilterConfig[] = [
  {
    key: 'urgency',
    label: 'Urgency',
    options: [
      { value: '7', label: 'Within 7 days' },
      { value: '14', label: 'Within 14 days' },
      { value: '30', label: 'Within 30 days' },
      { value: '60', label: 'Within 60 days' },
    ],
  },
];

function getUrgencyVariant(days: number) {
  if (days <= 7) return 'danger' as const;
  if (days <= 14) return 'warning' as const;
  return 'info' as const;
}

export default function ExpiringSoon() {
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<ExpiringSoonResponse>(
    ['certifications', 'expiring', JSON.stringify(activeFilters)],
    '/certifications/expiring',
    activeFilters
  );

  const columns: ColumnDef<ExpiringCert, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'workerName',
        header: 'Worker',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'certType',
        header: 'Certification',
      },
      {
        accessorKey: 'site',
        header: 'Site',
      },
      {
        accessorKey: 'expiryDate',
        header: 'Expiry Date',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
      {
        accessorKey: 'daysRemaining',
        header: 'Days Left',
        cell: ({ getValue }) => {
          const days = getValue() as number;
          return (
            <Badge variant={getUrgencyVariant(days)}>
              {days}d remaining
            </Badge>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Expiring Soon</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} certifications expiring within selected period
          </p>
        </div>
        <div className="flex items-center gap-2 text-orange-600">
          <Clock size={20} />
          <span className="text-sm font-medium">{data?.total ?? 0} expiring</span>
        </div>
      </div>

      <Filters
        filters={filterConfigs}
        activeFilters={activeFilters}
        onChange={(key, value) =>
          setActiveFilters((prev) => ({ ...prev, [key]: value }))
        }
        onClear={() => setActiveFilters({})}
      />

      <DataTable
        data={data?.certifications ?? []}
        columns={columns}
        pageSize={20}
        emptyMessage={isLoading ? 'Loading...' : 'No certifications expiring soon'}
      />
    </div>
  );
}
