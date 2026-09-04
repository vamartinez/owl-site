import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { type ColumnDef } from '@tanstack/react-table';

interface CertType {
  id: string;
  name: string;
  category: string;
  issuingAuthority: string;
  validityMonths: number;
  isRequired: boolean;
  activeCount: number;
}

interface CertCatalogResponse {
  certTypes: CertType[];
  total: number;
}

const filterConfigs: FilterConfig[] = [
  {
    key: 'category',
    label: 'Category',
    options: [
      { value: 'safety', label: 'Safety' },
      { value: 'trade', label: 'Trade' },
      { value: 'equipment', label: 'Equipment' },
      { value: 'environmental', label: 'Environmental' },
    ],
  },
  {
    key: 'required',
    label: 'Requirement',
    options: [
      { value: 'true', label: 'Required' },
      { value: 'false', label: 'Optional' },
    ],
  },
];

export default function CertCatalog() {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<CertCatalogResponse>(
    ['certifications', 'catalog', search, JSON.stringify(activeFilters)],
    '/certifications/catalog',
    { search, ...activeFilters }
  );

  const columns: ColumnDef<CertType, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Certification',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: ({ getValue }) => (
          <Badge variant="info">{getValue() as string}</Badge>
        ),
      },
      {
        accessorKey: 'issuingAuthority',
        header: 'Issuing Authority',
      },
      {
        accessorKey: 'validityMonths',
        header: 'Validity',
        cell: ({ getValue }) => `${getValue()} months`,
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
      {
        accessorKey: 'activeCount',
        header: 'Active Workers',
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Certification Catalog</h1>
        <p className="mt-1 text-sm text-gray-500">
          {data?.total ?? 0} certification types configured
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="w-full sm:w-72">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search certifications..."
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
        data={data?.certTypes ?? []}
        columns={columns}
        pageSize={15}
        emptyMessage={isLoading ? 'Loading catalog...' : 'No certifications found'}
      />
    </div>
  );
}
