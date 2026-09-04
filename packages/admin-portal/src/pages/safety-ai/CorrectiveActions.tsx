import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/charts/StatusBadge';
import { type ColumnDef } from '@tanstack/react-table';
import { Gavel } from 'lucide-react';

interface CorrectiveAction {
  id: string;
  findingTitle: string;
  assignedTo: string;
  site: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
  dueDate: string;
  createdAt: string;
}

interface CorrectiveActionsResponse {
  actions: CorrectiveAction[];
  total: number;
}

const statusVariants = {
  pending: 'warning' as const,
  in_progress: 'info' as const,
  completed: 'success' as const,
  overdue: 'danger' as const,
};

const filterConfigs: FilterConfig[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'pending', label: 'Pending' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'completed', label: 'Completed' },
      { value: 'overdue', label: 'Overdue' },
    ],
  },
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
];

export default function CorrectiveActions() {
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<CorrectiveActionsResponse>(
    ['safety-ai', 'corrective-actions', JSON.stringify(activeFilters)],
    '/safety-ai/corrective-actions',
    activeFilters
  );

  const columns: ColumnDef<CorrectiveAction, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'findingTitle',
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
        accessorKey: 'assignedTo',
        header: 'Assigned To',
      },
      {
        accessorKey: 'site',
        header: 'Site',
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => {
          const status = getValue() as CorrectiveAction['status'];
          return <Badge variant={statusVariants[status]}>{status.replace('_', ' ')}</Badge>;
        },
      },
      {
        accessorKey: 'dueDate',
        header: 'Due Date',
        cell: ({ getValue }) => {
          const date = new Date(getValue() as string);
          const isOverdue = date < new Date();
          return (
            <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
              {date.toLocaleDateString()}
            </span>
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
          <h1 className="text-2xl font-semibold text-gray-900">Corrective Actions</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} corrective actions tracked
          </p>
        </div>
        <Gavel size={24} className="text-gray-400" />
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
        data={data?.actions ?? []}
        columns={columns}
        pageSize={20}
        emptyMessage={isLoading ? 'Loading...' : 'No corrective actions found'}
      />
    </div>
  );
}
