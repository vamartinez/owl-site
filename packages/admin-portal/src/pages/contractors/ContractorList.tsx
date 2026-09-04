import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Briefcase } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Contractor {
  contractor_id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  status: 'active' | 'suspended' | 'pending';
  total_workers?: number;
  compliance_percent?: number;
}

interface ContractorsResponse {
  contractors: Contractor[];
  total: number;
}

const statusVariants = {
  active: 'success' as const,
  suspended: 'danger' as const,
  pending: 'warning' as const,
};

const filterConfigs: FilterConfig[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'suspended', label: 'Suspended' },
      { value: 'pending', label: 'Pending' },
    ],
  },
];

export default function ContractorList() {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<ContractorsResponse>(
    ['contractors', search, JSON.stringify(activeFilters)],
    '/contractors',
    { search, ...activeFilters }
  );

  const columns: ColumnDef<Contractor, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'company_name',
        header: 'Company',
        cell: ({ row }) => (
          <Link
            to={`/contractors/${row.original.contractor_id}`}
            className="font-medium text-primary-600 hover:text-primary-700"
          >
            {row.original.company_name}
          </Link>
        ),
      },
      {
        accessorKey: 'contact_name',
        header: 'Contact',
      },
      {
        accessorKey: 'contact_phone',
        header: 'Phone',
        cell: ({ getValue }) => getValue() || '—',
      },
      {
        accessorKey: 'total_workers',
        header: 'Workers',
        cell: ({ getValue }) => getValue() ?? '—',
      },
      {
        accessorKey: 'compliance_percent',
        header: 'Compliance',
        cell: ({ getValue }) => {
          const pct = getValue() as number | undefined;
          if (pct === undefined || pct === null) return '—';
          return (
            <Badge variant={pct >= 90 ? 'success' : pct >= 70 ? 'warning' : 'danger'}>
              {pct}%
            </Badge>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => {
          const status = (getValue() as Contractor['status']) || 'active';
          return <Badge variant={statusVariants[status]}>{status}</Badge>;
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Contractors</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total || data?.contractors?.length || 0} contractors registered
          </p>
        </div>
        <Button size="sm">
          <Plus size={16} />
          Add Contractor
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="w-full sm:w-72">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search contractors..."
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
        data={data?.contractors ?? []}
        columns={columns}
        pageSize={15}
        emptyMessage={isLoading ? 'Loading contractors...' : 'No contractors found'}
      />
    </div>
  );
}
