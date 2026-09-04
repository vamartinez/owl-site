import { useState, useCallback } from 'react';
import { Download, FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { LegalDisclaimer } from './LegalDisclaimer';
import { useAuthStore } from '../../store/auth-store';
import { apiClient } from '../../services/api-client';
import { STATUS_LABELS } from './constants';
import { IncidentStatus } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExportFormat =
  | 'operational_csv'
  | 'osha_form_300_csv'
  | 'worksafebc_pdf_summary'
  | 'regulatory_report_summary';

interface ExportFilters {
  dateFrom: string;
  dateTo: string;
  status: string;
  siteId: string;
}

interface ExportMetadata {
  generatedAt: string;
  generatedBy: string;
  format: ExportFormat;
  filters: ExportFilters;
}

interface ExportResponse {
  download_url: string;
  metadata: {
    generated_at: string;
    generated_by: string;
    period_from: string;
    period_to: string;
    filters_applied: string;
    record_count: number;
  };
}

export interface ExportPanelProps {
  /** Incident ID for single-incident exports (WorkSafeBC PDF) */
  incidentId?: string;
  /** Available sites for filter selection */
  sites?: Array<{ id: string; name: string }>;
  /** Optional additional CSS class */
  className?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EXPORT_FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; description: string; isRegulatory: boolean }> = [
  {
    value: 'operational_csv',
    label: 'Operational CSV',
    description: 'All incidents matching filters in UTF-8 CSV format',
    isRegulatory: false,
  },
  {
    value: 'osha_form_300_csv',
    label: 'OSHA Form 300 CSV',
    description: 'OSHA recordable incidents for the selected calendar period',
    isRegulatory: true,
  },
  {
    value: 'worksafebc_pdf_summary',
    label: 'WorkSafeBC PDF Summary',
    description: 'WorkSafeBC emergency report summary as PDF',
    isRegulatory: true,
  },
  {
    value: 'regulatory_report_summary',
    label: 'Regulatory Report Summary',
    description: 'Consolidated minimum data for manual regulatory report preparation',
    isRegulatory: true,
  },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

/**
 * ExportPanel — provides export options for incident data.
 *
 * Export formats:
 * - Operational CSV: all incidents matching filters
 * - OSHA Form 300 CSV: recordable incidents for a calendar period
 * - WorkSafeBC PDF Summary: emergency report summary
 * - Regulatory Report Summary: consolidated data for manual report preparation
 *
 * Includes filter selection (date range, status, site) and shows generation metadata.
 * Includes LegalDisclaimer as footer in regulatory exports.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 24.2
 */
export function ExportPanel({ incidentId, sites = [], className = '' }: ExportPanelProps) {
  const user = useAuthStore((state) => state.user);

  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('operational_csv');
  const [filters, setFilters] = useState<ExportFilters>({
    dateFrom: '',
    dateTo: '',
    status: '',
    siteId: '',
  });
  const [isExporting, setIsExporting] = useState(false);
  const [lastExport, setLastExport] = useState<ExportMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedFormatInfo = EXPORT_FORMAT_OPTIONS.find((f) => f.value === selectedFormat);
  const isRegulatoryExport = selectedFormatInfo?.isRegulatory ?? false;

  const siteOptions = [
    { value: '', label: 'All sites' },
    ...sites.map((s) => ({ value: s.id, label: s.name })),
  ];

  const handleFilterChange = useCallback(
    (field: keyof ExportFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFilters((prev) => ({ ...prev, [field]: e.target.value }));
      setError(null);
    },
    []
  );

  const handleFormatChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedFormat(e.target.value as ExportFormat);
    setError(null);
  }, []);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setError(null);

    try {
      let response: ExportResponse;

      if (selectedFormat === 'worksafebc_pdf_summary' && incidentId) {
        // Single-incident WorkSafeBC PDF export
        response = await apiClient.post<ExportResponse>(
          `/incidents/${incidentId}/worksafebc-summary/export`,
          {}
        );
      } else {
        // Bulk export via POST /incidents/export
        const exportPayload: Record<string, unknown> = {
          format: selectedFormat,
        };

        if (filters.dateFrom) exportPayload.date_from = filters.dateFrom;
        if (filters.dateTo) exportPayload.date_to = filters.dateTo;
        if (filters.status) exportPayload.status = filters.status;
        if (filters.siteId) exportPayload.site_id = filters.siteId;

        response = await apiClient.post<ExportResponse>('/incidents/export', exportPayload);
      }

      // Record metadata for display
      setLastExport({
        generatedAt: response.metadata.generated_at,
        generatedBy: response.metadata.generated_by || user?.name || 'Unknown',
        format: selectedFormat,
        filters,
      });

      // Trigger download
      if (response.download_url) {
        window.open(response.download_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Export generation failed. Please try again.';
      setError(message);
    } finally {
      setIsExporting(false);
    }
  }, [selectedFormat, filters, incidentId, user?.name]);

  const canExport =
    selectedFormat === 'worksafebc_pdf_summary'
      ? !!incidentId
      : true;

  return (
    <Card className={className}>
      <CardHeader
        title="Export Incidents"
        description="Generate reports in various formats for analysis and regulatory compliance"
      />
      <CardContent>
        <div className="space-y-5">
          {/* Export Format Selection */}
          <Select
            label="Export Format"
            options={EXPORT_FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
            value={selectedFormat}
            onChange={handleFormatChange}
            aria-describedby="format-description"
          />
          {selectedFormatInfo && (
            <p id="format-description" className="text-xs text-gray-500 -mt-3">
              {selectedFormatInfo.description}
            </p>
          )}

          {/* Filters — hidden for single-incident WorkSafeBC PDF */}
          {selectedFormat !== 'worksafebc_pdf_summary' && (
            <fieldset className="space-y-4">
              <legend className="text-sm font-medium text-gray-700">Filters</legend>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Date From"
                  type="date"
                  value={filters.dateFrom}
                  onChange={handleFilterChange('dateFrom')}
                />
                <Input
                  label="Date To"
                  type="date"
                  value={filters.dateTo}
                  onChange={handleFilterChange('dateTo')}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Status"
                  options={STATUS_OPTIONS}
                  value={filters.status}
                  onChange={handleFilterChange('status')}
                />
                <Select
                  label="Site"
                  options={siteOptions}
                  value={filters.siteId}
                  onChange={handleFilterChange('siteId')}
                  placeholder="All sites"
                />
              </div>
            </fieldset>
          )}

          {/* Export Button */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleExport}
              disabled={isExporting || !canExport}
              variant="primary"
              size="md"
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Export
                </>
              )}
            </Button>

            {selectedFormat === 'worksafebc_pdf_summary' && !incidentId && (
              <p className="text-xs text-amber-600">
                WorkSafeBC PDF export requires a specific incident context.
              </p>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3" role="alert">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Generation Metadata */}
          {lastExport && (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                {lastExport.format.includes('csv') ? (
                  <FileSpreadsheet className="h-4 w-4 text-gray-500" />
                ) : (
                  <FileText className="h-4 w-4 text-gray-500" />
                )}
                <span className="text-sm font-medium text-gray-700">Last Export</span>
                <Badge variant="success">Generated</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                <dt className="font-medium">Generated At</dt>
                <dd>{new Date(lastExport.generatedAt).toLocaleString()}</dd>

                <dt className="font-medium">Generated By</dt>
                <dd>{lastExport.generatedBy}</dd>

                <dt className="font-medium">Format</dt>
                <dd>
                  {EXPORT_FORMAT_OPTIONS.find((f) => f.value === lastExport.format)?.label ?? lastExport.format}
                </dd>

                {lastExport.filters.dateFrom && (
                  <>
                    <dt className="font-medium">Period</dt>
                    <dd>
                      {lastExport.filters.dateFrom}
                      {lastExport.filters.dateTo ? ` — ${lastExport.filters.dateTo}` : ' onwards'}
                    </dd>
                  </>
                )}

                {lastExport.filters.status && (
                  <>
                    <dt className="font-medium">Status Filter</dt>
                    <dd>{STATUS_LABELS[lastExport.filters.status as IncidentStatus] ?? lastExport.filters.status}</dd>
                  </>
                )}

                {lastExport.filters.siteId && (
                  <>
                    <dt className="font-medium">Site Filter</dt>
                    <dd>{sites.find((s) => s.id === lastExport.filters.siteId)?.name ?? lastExport.filters.siteId}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {/* Legal Disclaimer — shown as footer for regulatory exports */}
          {isRegulatoryExport && <LegalDisclaimer variant="footer" />}
        </div>
      </CardContent>
    </Card>
  );
}
