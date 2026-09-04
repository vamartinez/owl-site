import { useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Shield } from 'lucide-react';

interface AccessRule {
  id: string;
  name: string;
  site: string;
  requiredCerts: string[];
  enforcementLevel: 'strict' | 'warning' | 'info';
  isActive: boolean;
  createdAt: string;
}

interface AccessRulesResponse {
  rules: AccessRule[];
  total: number;
}

const enforcementVariants = {
  strict: 'danger' as const,
  warning: 'warning' as const,
  info: 'info' as const,
};

export default function AccessRules() {
  const { data, isLoading } = useApiQuery<AccessRulesResponse>(
    ['site-access', 'rules'],
    '/site-access/rules'
  );

  const columns: ColumnDef<AccessRule, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Rule Name',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'site',
        header: 'Site',
      },
      {
        accessorKey: 'requiredCerts',
        header: 'Required Certs',
        cell: ({ getValue }) => {
          const certs = getValue() as string[];
          return (
            <div className="flex flex-wrap gap-1">
              {certs.slice(0, 3).map((c) => (
                <Badge key={c} variant="info">{c}</Badge>
              ))}
              {certs.length > 3 && <Badge variant="default">+{certs.length - 3}</Badge>}
            </div>
          );
        },
      },
      {
        accessorKey: 'enforcementLevel',
        header: 'Enforcement',
        cell: ({ getValue }) => {
          const level = getValue() as AccessRule['enforcementLevel'];
          return <Badge variant={enforcementVariants[level]}>{level}</Badge>;
        },
      },
      {
        accessorKey: 'isActive',
        header: 'Status',
        cell: ({ getValue }) => (
          <Badge variant={getValue() ? 'success' : 'default'}>
            {getValue() ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Access Rules</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} rules configured
          </p>
        </div>
        <Button size="sm">
          <Plus size={16} />
          Add Rule
        </Button>
      </div>

      <DataTable
        data={data?.rules ?? []}
        columns={columns}
        pageSize={15}
        emptyMessage={isLoading ? 'Loading...' : 'No access rules configured'}
      />
    </div>
  );
}
