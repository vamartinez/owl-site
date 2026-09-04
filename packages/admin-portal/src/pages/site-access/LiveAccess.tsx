import { useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { type ColumnDef } from '@tanstack/react-table';
import { Users, Clock } from 'lucide-react';

interface LiveWorker {
  id: string;
  workerName: string;
  site: string;
  checkInTime: string;
  contractor: string;
  complianceStatus: 'compliant' | 'conditional';
}

interface LiveAccessResponse {
  workers: LiveWorker[];
  totalOnSite: number;
}

export default function LiveAccess() {
  const { data, isLoading } = useApiQuery<LiveAccessResponse>(
    ['site-access', 'live'],
    '/site-access/live',
    undefined,
    { refetchInterval: 30 * 1000 }
  );

  const columns: ColumnDef<LiveWorker, unknown>[] = useMemo(
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
        accessorKey: 'contractor',
        header: 'Contractor',
      },
      {
        accessorKey: 'checkInTime',
        header: 'Check-In Time',
        cell: ({ getValue }) =>
          new Date(getValue() as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
      {
        accessorKey: 'complianceStatus',
        header: 'Status',
        cell: ({ getValue }) => {
          const status = getValue() as string;
          return (
            <Badge variant={status === 'compliant' ? 'success' : 'warning'}>
              {status === 'compliant' ? 'Compliant' : 'Conditional'}
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
          <h1 className="text-2xl font-semibold text-gray-900">Live Site Access</h1>
          <p className="mt-1 text-sm text-gray-500">
            Real-time view of workers currently on site
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-blue-600">
            <Users size={20} />
            <span className="text-lg font-bold">{data?.totalOnSite ?? 0}</span>
            <span className="text-sm text-gray-500">on site</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Clock size={12} />
            Auto-refreshes every 30s
          </div>
        </div>
      </div>

      <DataTable
        data={data?.workers ?? []}
        columns={columns}
        pageSize={25}
        emptyMessage={isLoading ? 'Loading...' : 'No workers currently on site'}
      />
    </div>
  );
}
