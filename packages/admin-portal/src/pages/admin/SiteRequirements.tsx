import { useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, ClipboardCheck } from 'lucide-react';

interface SiteRequirement {
  id: string;
  site: string;
  certType: string;
  isRequired: boolean;
  enforcementLevel: 'strict' | 'warning' | 'info';
  appliesTo: string;
  createdAt: string;
}

interface SiteRequirementsResponse {
  requirements: SiteRequirement[];
  total: number;
}

const enforcementVariants = {
  strict: 'danger' as const,
  warning: 'warning' as const,
  info: 'info' as const,
};

export default function SiteRequirements() {
  const { data, isLoading } = useApiQuery<SiteRequirementsResponse>(
    ['admin', 'site-requirements'],
    '/admin/site-requirements'
  );

  const columns: ColumnDef<SiteRequirement, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'site',
        header: 'Site',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'certType',
        header: 'Certification',
        cell: ({ getValue }) => (
          <Badge variant="info">{getValue() as string}</Badge>
        ),
      },
      {
        accessorKey: 'appliesTo',
        header: 'Applies To',
      },
      {
        accessorKey: 'enforcementLevel',
        header: 'Enforcement',
        cell: ({ getValue }) => {
          const level = getValue() as SiteRequirement['enforcementLevel'];
          return <Badge variant={enforcementVariants[level]}>{level}</Badge>;
        },
      },
      {
        accessorKey: 'isRequired',
        header: 'Required',
        cell: ({ getValue }) => (
          <Badge variant={getValue() ? 'danger' : 'default'}>
            {getValue() ? 'Required' : 'Optional'}
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
          <h1 className="text-2xl font-semibold text-gray-900">Site Requirements</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} certification requirements configured
          </p>
        </div>
        <Button size="sm">
          <Plus size={16} />
          Add Requirement
        </Button>
      </div>

      <DataTable
        data={data?.requirements ?? []}
        columns={columns}
        pageSize={20}
        emptyMessage={isLoading ? 'Loading...' : 'No requirements configured'}
      />
    </div>
  );
}
