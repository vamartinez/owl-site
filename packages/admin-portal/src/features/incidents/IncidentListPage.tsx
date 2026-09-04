import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { AlertTriangle, FileWarning, Plus } from 'lucide-react';
import { DataTable } from '@/components/data/DataTable';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { PageContainer } from '@/components/layout/PageContainer';
import { useIncidents, type IncidentFilters } from './hooks/useIncidents';
import {
  type Incident,
  IncidentStatus,
  OperationalSeverity,
  RegulatoryFlag,
  ExternalReportStatus,
} from './types';
import {
  STATUS_LABELS,
  SEVERITY_LABELS,
  REGULATORY_FLAG_LABELS,
  EXTERNAL_REPORT_STATUS_LABELS,
} from './constants';
import { LinkedDocsBadge } from './LinkedDocsBadge';

// ─── Badge Variant Mappings ──────────────────────────────────────────────────

const STATUS_BADGE_VARIANTS: Record<IncidentStatus, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple'> = {
  [IncidentStatus.OPEN]: 'info',
  [IncidentStatus.UNDER_REVIEW]: 'warning',
  [IncidentStatus.REGULATORY_REVIEW]: 'purple',
  [IncidentStatus.ACTION_REQUIRED]: 'danger',
  [IncidentStatus.RESOLVED]: 'success',
  [IncidentStatus.CLOSED]: 'default',
};

const SEVERITY_BADGE_VARIANTS: Record<OperationalSeverity, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple'> = {
  [OperationalSeverity.LOW]: 'default',
  [OperationalSeverity.MEDIUM]: 'warning',
  [OperationalSeverity.HIGH]: 'danger',
  [OperationalSeverity.CRITICAL]: 'danger',
};

// ─── Filter Configuration ────────────────────────────────────────────────────

const FILTER_CONFIGS: FilterConfig[] = [
  {
    key: 'status',
    label: 'Status',
    options: Object.values(IncidentStatus).map((status) => ({
      value: status,
      label: STATUS_LABELS[status],
    })),
  },
  {
    key: 'severity',
    label: 'Severity',
    options: Object.values(OperationalSeverity).map((severity) => ({
      value: severity,
      label: SEVERITY_LABELS[severity],
    })),
  },
  {
    key: 'regulatoryFlag',
    label: 'Regulatory Flag',
    options: Object.values(RegulatoryFlag).map((flag) => ({
      value: flag,
      label: REGULATORY_FLAG_LABELS[flag],
    })),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * IncidentListPage displays a filterable, sortable table of incidents.
 * Integrates with the useIncidents hook for data fetching and supports
 * filtering by status, severity, regulatory flag, and site.
 *
 * Requirements: 1.1, 4.1, 4.2, 16.3, 21.5
 */
export function IncidentListPage() {
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const incidentFilters: IncidentFilters = {
    status: (activeFilters.status as IncidentStatus) || undefined,
    severity: (activeFilters.severity as OperationalSeverity) || undefined,
    regulatoryFlag: (activeFilters.regulatoryFlag as RegulatoryFlag) || undefined,
    siteId: activeFilters.siteId || undefined,
  };

  const { data: incidents, isLoading, error, refetch } = useIncidents(incidentFilters);

  const columns = useMemo<ColumnDef<Incident, unknown>[]>(
    () => [
      {
        accessorKey: 'title',
        header: 'Title',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <Link
              to={`/incidents/${row.original.incident_id}`}
              className="font-medium text-primary-600 hover:text-primary-700"
            >
              {row.original.title}
            </Link>
            <LinkedDocsBadge count={row.original.linked_documents_count} />
          </span>
        ),
      },
      {
        accessorKey: 'incident_datetime',
        header: 'Date',
        cell: ({ getValue }) => formatDateTime(getValue<string>()),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => {
          const status = getValue<IncidentStatus>();
          return (
            <Badge variant={STATUS_BADGE_VARIANTS[status]}>
              {STATUS_LABELS[status]}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'severity',
        header: 'Severity',
        cell: ({ getValue }) => {
          const severity = getValue<OperationalSeverity>();
          return (
            <Badge variant={SEVERITY_BADGE_VARIANTS[severity]}>
              {SEVERITY_LABELS[severity]}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'regulatory_flag',
        header: 'Regulatory',
        cell: ({ getValue }) => {
          const flag = getValue<RegulatoryFlag>();
          if (flag === RegulatoryFlag.IMMEDIATELY_REPORTABLE) {
            return (
              <span className="inline-flex items-center gap-1">
                <AlertTriangle size={14} className="text-red-500" />
                <Badge variant="danger">{REGULATORY_FLAG_LABELS[flag]}</Badge>
              </span>
            );
          }
          if (flag === RegulatoryFlag.POTENTIALLY_REPORTABLE) {
            return <Badge variant="warning">{REGULATORY_FLAG_LABELS[flag]}</Badge>;
          }
          return <Badge variant="default">{REGULATORY_FLAG_LABELS[flag]}</Badge>;
        },
      },
      {
        accessorKey: 'external_report_status',
        header: 'Report Status',
        cell: ({ getValue }) => {
          const status = getValue<ExternalReportStatus>();
          if (status === ExternalReportStatus.EXTERNAL_REPORT_PENDING) {
            return (
              <span className="inline-flex items-center gap-1">
                <FileWarning size={14} className="text-yellow-600" />
                <span className="text-xs font-medium text-yellow-700">
                  {EXTERNAL_REPORT_STATUS_LABELS[status]}
                </span>
              </span>
            );
          }
          return (
            <span className="text-xs text-gray-600">
              {EXTERNAL_REPORT_STATUS_LABELS[status]}
            </span>
          );
        },
      },
      {
        accessorKey: 'created_at',
        header: 'Reported',
        cell: ({ getValue }) => formatDate(getValue<string>()),
      },
    ],
    []
  );

  const handleFilterChange = (key: string, value: string) => {
    setActiveFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleFilterClear = () => {
    setActiveFilters({});
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <PageContainer
        title="Incidents"
        description="Safety incident reports"
      >
        <div className="space-y-3 animate-pulse" data-testid="incidents-loading-skeleton">
          <div className="h-10 bg-gray-200 rounded w-full" />
          <div className="h-8 bg-gray-200 rounded w-2/3" />
          <div className="h-8 bg-gray-200 rounded w-full" />
          <div className="h-8 bg-gray-200 rounded w-full" />
          <div className="h-8 bg-gray-200 rounded w-5/6" />
          <div className="h-8 bg-gray-200 rounded w-full" />
        </div>
      </PageContainer>
    );
  }

  // Error state with retry
  if (error) {
    return (
      <PageContainer
        title="Incidents"
        description="Safety incident reports"
      >
        <ErrorDisplay
          error={error}
          title="Failed to load incidents"
          onRetry={() => refetch()}
        />
      </PageContainer>
    );
  }

  const incidentList = incidents ?? [];

  return (
    <PageContainer
      title="Incidents"
      description={`${incidentList.length} incident${incidentList.length !== 1 ? 's' : ''} found`}
      actions={
        <Link to="/incidents/new">
          <Button size="sm">
            <Plus size={16} />
            Report Incident
          </Button>
        </Link>
      }
    >
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Filters
          filters={FILTER_CONFIGS}
          activeFilters={activeFilters}
          onChange={handleFilterChange}
          onClear={handleFilterClear}
        />
      </div>

      {/* Data Table */}
      <DataTable
        data={incidentList}
        columns={columns}
        pageSize={15}
        emptyMessage="No incidents found matching the selected filters"
      />
    </PageContainer>
  );
}
