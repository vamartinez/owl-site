import { useMemo } from 'react';
import { useApiQuery, useApiMutation, useInvalidateQueries } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { type ColumnDef } from '@tanstack/react-table';
import { CheckCircle, XCircle, Eye } from 'lucide-react';

interface PendingCert {
  id: string;
  workerName: string;
  certType: string;
  uploadedAt: string;
  documentUrl: string;
  expiryDate: string;
}

interface PendingResponse {
  certifications: PendingCert[];
  total: number;
}

export default function PendingValidations() {
  const invalidate = useInvalidateQueries();

  const { data, isLoading } = useApiQuery<PendingResponse>(
    ['certifications', 'pending'],
    '/certifications/pending'
  );

  const { mutate: approve } = useApiMutation<void, { id: string }>(
    'patch',
    (vars) => `/certifications/${vars.id}/approve`,
    { onSuccess: () => invalidate([['certifications']]) }
  );

  const { mutate: reject } = useApiMutation<void, { id: string }>(
    'patch',
    (vars) => `/certifications/${vars.id}/reject`,
    { onSuccess: () => invalidate([['certifications']]) }
  );

  const columns: ColumnDef<PendingCert, unknown>[] = useMemo(
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
        accessorKey: 'uploadedAt',
        header: 'Uploaded',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
      {
        accessorKey: 'expiryDate',
        header: 'Expiry Date',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" title="View document">
              <Eye size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => approve({ id: row.original.id })}
              title="Approve"
            >
              <CheckCircle size={14} className="text-green-600" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => reject({ id: row.original.id })}
              title="Reject"
            >
              <XCircle size={14} className="text-red-600" />
            </Button>
          </div>
        ),
      },
    ],
    [approve, reject]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Pending Validations</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} certifications awaiting review
          </p>
        </div>
        <Badge variant="warning">{data?.total ?? 0} pending</Badge>
      </div>

      <DataTable
        data={data?.certifications ?? []}
        columns={columns}
        pageSize={15}
        emptyMessage={isLoading ? 'Loading...' : 'No pending validations'}
      />
    </div>
  );
}
