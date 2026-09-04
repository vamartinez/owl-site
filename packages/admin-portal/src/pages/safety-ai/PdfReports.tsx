import { useMemo } from 'react';
import { useApiQuery, useApiMutation } from '@/hooks/useApi';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { type ColumnDef } from '@tanstack/react-table';
import { FileText, Download, Plus, Loader2 } from 'lucide-react';

interface PdfReport {
  id: string;
  title: string;
  type: 'safety_summary' | 'site_inspection' | 'incident_report' | 'compliance_audit';
  site: string;
  generatedAt: string;
  pageCount: number;
  downloadUrl: string;
}

interface PdfReportsResponse {
  reports: PdfReport[];
  total: number;
}

const typeLabels = {
  safety_summary: 'Safety Summary',
  site_inspection: 'Site Inspection',
  incident_report: 'Incident Report',
  compliance_audit: 'Compliance Audit',
};

const typeVariants = {
  safety_summary: 'info' as const,
  site_inspection: 'purple' as const,
  incident_report: 'danger' as const,
  compliance_audit: 'success' as const,
};

export default function PdfReports() {
  const { data, isLoading } = useApiQuery<PdfReportsResponse>(
    ['safety-ai', 'pdf-reports'],
    '/safety-ai/pdf-reports'
  );

  const { mutate: generate, isPending: isGenerating } = useApiMutation<{ id: string }, { type: string }>(
    'post',
    '/safety-ai/pdf-reports/generate'
  );

  const columns: ColumnDef<PdfReport, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'title',
        header: 'Report',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-gray-400" />
            <span className="font-medium text-gray-900">{row.original.title}</span>
          </div>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ getValue }) => {
          const type = getValue() as PdfReport['type'];
          return <Badge variant={typeVariants[type]}>{typeLabels[type]}</Badge>;
        },
      },
      {
        accessorKey: 'site',
        header: 'Site',
      },
      {
        accessorKey: 'generatedAt',
        header: 'Generated',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleDateString(),
      },
      {
        accessorKey: 'pageCount',
        header: 'Pages',
      },
      {
        id: 'download',
        header: '',
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" title="Download PDF">
            <Download size={14} />
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">PDF Reports</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data?.total ?? 0} reports generated
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => generate({ type: 'safety_summary' })}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Plus size={16} />
          )}
          Generate Report
        </Button>
      </div>

      <DataTable
        data={data?.reports ?? []}
        columns={columns}
        pageSize={15}
        emptyMessage={isLoading ? 'Loading...' : 'No reports generated yet'}
      />
    </div>
  );
}
