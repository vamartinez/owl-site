import { useState } from 'react';
import { useApiMutation } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Download, FileText, CheckCircle, Loader2 } from 'lucide-react';

interface ExportResult {
  downloadUrl: string;
  fileName: string;
  recordCount: number;
  generatedAt: string;
}

interface ExportRequest {
  reportType: string;
  format: string;
  dateFrom: string;
  dateTo: string;
  site: string;
}

export default function AuditExport() {
  const [reportType, setReportType] = useState('');
  const [format, setFormat] = useState('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [site, setSite] = useState('');

  const { mutate, isPending, data: result } = useApiMutation<ExportResult, ExportRequest>(
    'post',
    '/reports/audit-export'
  );

  const handleExport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportType) return;
    mutate({ reportType, format, dateFrom, dateTo, site });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Audit Export</h1>
        <p className="mt-1 text-sm text-gray-500">
          Generate and download audit-ready compliance reports
        </p>
      </div>

      <Card>
        <CardHeader title="Export Configuration" description="Select report parameters" />
        <CardContent>
          <form onSubmit={handleExport} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Report Type"
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                options={[
                  { value: 'compliance_full', label: 'Full Compliance Report' },
                  { value: 'worker_certs', label: 'Worker Certifications' },
                  { value: 'access_history', label: 'Access History' },
                  { value: 'safety_findings', label: 'Safety Findings' },
                  { value: 'corrective_actions', label: 'Corrective Actions' },
                  { value: 'contractor_compliance', label: 'Contractor Compliance' },
                ]}
                placeholder="Select report type"
              />
              <Select
                label="Format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                options={[
                  { value: 'csv', label: 'CSV' },
                  { value: 'xlsx', label: 'Excel (XLSX)' },
                  { value: 'pdf', label: 'PDF' },
                  { value: 'json', label: 'JSON' },
                ]}
              />
              <Input
                label="Date From"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <Input
                label="Date To"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
              <Input
                label="Site (optional)"
                value={site}
                onChange={(e) => setSite(e.target.value)}
                placeholder="All sites"
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={isPending || !reportType}>
                {isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Generate Export
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle size={24} className="text-green-600" />
                <div>
                  <p className="font-medium text-gray-900">Export Ready</p>
                  <p className="text-sm text-gray-500">
                    {result.recordCount} records • Generated {new Date(result.generatedAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm">
                <FileText size={16} />
                {result.fileName}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
