import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data/DataTable';
import { Button } from '@/components/ui/Button';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useCertifications } from './hooks/useCertifications';
import { ValidationPanel } from './ValidationPanel';
import { CertificationSummary } from './CertificationSummary';
import { ExpiryBadge } from './ExpiryBadge';
import { DocumentViewerModal } from './DocumentViewerModal';
import { CertificationStatus, type Certification } from './types';

interface CertificationListProps {
  workerId: string;
  onReupload?: (certification: Certification) => void;
}

/**
 * Formats a certification_type enum value into a human-readable label.
 * e.g. 'whmis_2015' → 'WHMIS 2015', 'fall_protection' → 'Fall Protection'
 */
function formatCertificationType(type: string): string {
  const specialCases: Record<string, string> = {
    whmis_2015: 'WHMIS 2015',
    site_ready_bc: 'SiteReadyBC',
  };

  if (specialCases[type]) {
    return specialCases[type];
  }

  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Formats an ISO date string into a readable locale date.
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats a validation status enum value into a readable label.
 */
function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function CertificationList({ workerId, onReupload }: CertificationListProps) {
  const { data: certifications, isLoading, error, refetch } = useCertifications(workerId);
  const [viewerCert, setViewerCert] = useState<Certification | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const openViewer = (cert: Certification) => {
    setViewerCert(cert);
    setIsViewerOpen(true);
  };

  const closeViewer = () => {
    setIsViewerOpen(false);
    setViewerCert(null);
  };

  const columns = useMemo<ColumnDef<Certification, unknown>[]>(
    () => [
      {
        accessorKey: 'certification_type',
        header: 'Type',
        cell: ({ getValue }) => formatCertificationType(getValue<string>()),
      },
      {
        accessorKey: 'issuer',
        header: 'Issuer',
      },
      {
        accessorKey: 'issue_date',
        header: 'Issue Date',
        cell: ({ getValue }) => formatDate(getValue<string>()),
      },
      {
        accessorKey: 'expiry_date',
        header: 'Expiry Date',
        cell: ({ getValue }) => formatDate(getValue<string>()),
      },
      {
        accessorKey: 'validation_status',
        header: 'Status',
        cell: ({ getValue }) => formatStatus(getValue<string>()),
      },
      {
        id: 'expiry_badge',
        header: 'Expiry',
        cell: ({ row }) => <ExpiryBadge expiryDate={row.original.expiry_date} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const cert = row.original;

          return (
            <div className="flex gap-2">
              {cert.document_key && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openViewer(cert)}
                >
                  View
                </Button>
              )}
              {cert.validation_status === CertificationStatus.PENDING && (
                <ValidationPanel certification={cert} workerId={workerId} />
              )}
              {cert.validation_status === CertificationStatus.REJECTED && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReupload?.(cert)}
                >
                  Re-upload
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [workerId, onReupload]
  );

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse" data-testid="certification-list-loading">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-10 bg-gray-200 rounded" />
        <div className="h-10 bg-gray-200 rounded" />
        <div className="h-10 bg-gray-200 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorDisplay
        error={error}
        title="Failed to load certifications"
        onRetry={() => refetch()}
      />
    );
  }

  const certList = certifications ?? [];

  return (
    <div>
      {certList.length > 0 && <CertificationSummary certifications={certList} />}
      <DataTable
        data={certList}
        columns={columns}
        emptyMessage="No certifications found"
      />
      {viewerCert && (
        <DocumentViewerModal
          open={isViewerOpen}
          onClose={closeViewer}
          certification={viewerCert}
          workerId={workerId}
        />
      )}
    </div>
  );
}
