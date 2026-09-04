import { useMemo } from 'react';
import { useApiQuery, useApiMutation, useInvalidateQueries } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/charts/StatusBadge';
import { type ColumnDef } from '@tanstack/react-table';
import { CheckCircle, XCircle, Eye } from 'lucide-react';

interface PendingFinding {
  id: string;
  title: string;
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  site: string;
  detectedAt: string;
  confidence: number;
  evidenceUrl: string;
}

interface PendingReviewResponse {
  findings: PendingFinding[];
  total: number;
}

export default function PendingReview() {
  const invalidate = useInvalidateQueries();

  const { data, isLoading } = useApiQuery<PendingReviewResponse>(
    ['safety-ai', 'pending-review'],
    '/safety-ai/pending-review'
  );

  const { mutate: confirm } = useApiMutation<void, { id: string }>(
    'patch',
    (vars) => `/safety-ai/findings/${vars.id}/confirm`,
    { onSuccess: () => invalidate([['safety-ai']]) }
  );

  const { mutate: dismiss } = useApiMutation<void, { id: string }>(
    'patch',
    (vars) => `/safety-ai/findings/${vars.id}/dismiss`,
    { onSuccess: () => invalidate([['safety-ai']]) }
  );

  const columns: ColumnDef<PendingFinding, unknown>[] = useMemo(
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
        accessorKey: 'confidence',
        header: 'AI Confidence',
        cell: ({ getValue }) => {
          const conf = getValue() as number;
          return (
            <Badge variant={conf >= 80 ? 'success' : conf >= 60 ? 'warning' : 'danger'}>
              {conf}%
            </Badge>
          );
        },
      },
      {
        accessorKey: 'detectedAt',
        header: 'Detected',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" title="View evidence">
              <Eye size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => confirm({ id: row.original.id })}
              title="Confirm finding"
            >
              <CheckCircle size={14} className="text-green-600" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dismiss({ id: row.original.id })}
              title="Dismiss finding"
            >
              <XCircle size={14} className="text-red-600" />
            </Button>
          </div>
        ),
      },
    ],
    [confirm, dismiss]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Pending Review</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} AI findings awaiting human review
          </p>
        </div>
        <Badge variant="warning">{data?.total ?? 0} pending</Badge>
      </div>

      <DataTable
        data={data?.findings ?? []}
        columns={columns}
        pageSize={15}
        emptyMessage={isLoading ? 'Loading...' : 'No findings pending review'}
      />
    </div>
  );
}
