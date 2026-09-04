import { useMemo } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/charts/StatusBadge';
import { type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, TrendingDown } from 'lucide-react';

interface ComplianceRisk {
  id: string;
  contractorName: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  nonCompliantWorkers: number;
  totalWorkers: number;
  topIssues: string[];
  lastIncident: string;
}

interface ComplianceRisksResponse {
  risks: ComplianceRisk[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export default function ComplianceRisks() {
  const { data, isLoading } = useApiQuery<ComplianceRisksResponse>(
    ['contractors', 'compliance-risks'],
    '/contractors/compliance-risks'
  );

  const columns: ColumnDef<ComplianceRisk, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'contractorName',
        header: 'Contractor',
        cell: ({ getValue }) => (
          <span className="font-medium text-gray-900">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'riskLevel',
        header: 'Risk Level',
        cell: ({ getValue }) => (
          <StatusBadge status={getValue() as 'critical' | 'high' | 'medium' | 'low'} />
        ),
      },
      {
        id: 'compliance',
        header: 'Non-Compliant',
        cell: ({ row }) => (
          <span className="text-sm">
            <span className="font-medium text-red-600">{row.original.nonCompliantWorkers}</span>
            <span className="text-gray-400"> / {row.original.totalWorkers}</span>
          </span>
        ),
      },
      {
        accessorKey: 'topIssues',
        header: 'Top Issues',
        cell: ({ getValue }) => {
          const issues = getValue() as string[];
          return (
            <div className="flex flex-wrap gap-1">
              {issues.slice(0, 2).map((issue) => (
                <Badge key={issue} variant="warning">{issue}</Badge>
              ))}
              {issues.length > 2 && <Badge variant="default">+{issues.length - 2}</Badge>}
            </div>
          );
        },
      },
      {
        accessorKey: 'lastIncident',
        header: 'Last Incident',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Compliance Risks</h1>
          <p className="mt-1 text-sm text-gray-500">
            Contractor compliance risk assessment
          </p>
        </div>
        <AlertTriangle size={24} className="text-orange-500" />
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-3 text-center">
              <p className="text-2xl font-bold text-red-600">{data.summary.critical}</p>
              <p className="text-xs text-gray-500">Critical</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <p className="text-2xl font-bold text-orange-600">{data.summary.high}</p>
              <p className="text-xs text-gray-500">High</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <p className="text-2xl font-bold text-yellow-600">{data.summary.medium}</p>
              <p className="text-xs text-gray-500">Medium</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{data.summary.low}</p>
              <p className="text-xs text-gray-500">Low</p>
            </CardContent>
          </Card>
        </div>
      )}

      <DataTable
        data={data?.risks ?? []}
        columns={columns}
        pageSize={15}
        emptyMessage={isLoading ? 'Loading...' : 'No compliance risks found'}
      />
    </div>
  );
}
