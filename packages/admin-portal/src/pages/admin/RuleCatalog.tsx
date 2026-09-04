import { useState, useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Scale } from 'lucide-react';

interface SafetyRule {
  id: string;
  code: string;
  name: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  isActive: boolean;
  description: string;
  createdAt: string;
}

interface RuleCatalogResponse {
  rules: SafetyRule[];
  total: number;
}

const severityVariants = {
  critical: 'danger' as const,
  high: 'warning' as const,
  medium: 'info' as const,
  low: 'default' as const,
};

const filterConfigs: FilterConfig[] = [
  {
    key: 'category',
    label: 'Category',
    options: [
      { value: 'ppe', label: 'PPE' },
      { value: 'fall_protection', label: 'Fall Protection' },
      { value: 'electrical', label: 'Electrical' },
      { value: 'scaffolding', label: 'Scaffolding' },
      { value: 'excavation', label: 'Excavation' },
      { value: 'general', label: 'General' },
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

export default function RuleCatalog() {
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useApiQuery<RuleCatalogResponse>(
    ['admin', 'rules', search, JSON.stringify(activeFilters)],
    '/admin/rules',
    { search, ...activeFilters }
  );

  const columns: ColumnDef<SafetyRule, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'code',
        header: 'Code',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-gray-600">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'name',
        header: 'Rule Name',
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
        accessorKey: 'severity',
        header: 'Severity',
        cell: ({ getValue }) => {
          const sev = getValue() as SafetyRule['severity'];
          return <Badge variant={severityVariants[sev]}>{sev}</Badge>;
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
          <h1 className="text-2xl font-semibold text-gray-900">Rule Catalog</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} safety rules configured
          </p>
        </div>
        <Button size="sm">
          <Plus size={16} />
          Add Rule
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="w-full sm:w-72">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search rules..."
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
        data={data?.rules ?? []}
        columns={columns}
        pageSize={20}
        emptyMessage={isLoading ? 'Loading...' : 'No rules found'}
      />
    </div>
  );
}
