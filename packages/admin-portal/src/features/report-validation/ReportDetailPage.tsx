import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Calendar, FileText, Hash, Loader2, Send, ShieldCheck, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { PageContainer } from '@/components/layout/PageContainer';
import { useReport, useValidateReport, useSubmitReport, useValidationPolling } from './hooks';
import { ValidationResultsPanel } from './ValidationResultsPanel';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { ComplianceScoreBadge } from './ComplianceScoreBadge';
import { ReportUploadForm } from './ReportUploadForm';
import { getAvailableActions } from './utils';
import type { ReportStatus } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusLabels: Record<ReportStatus, string> = {
  draft: 'Draft',
  validating: 'Validating',
  validated: 'Validated',
  submitted: 'Submitted',
};

const statusVariants: Record<ReportStatus, 'default' | 'success' | 'warning' | 'info' | 'purple'> = {
  draft: 'default',
  validating: 'info',
  validated: 'success',
  submitted: 'purple',
};

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Report detail page showing document info, validation results, version history,
 * and available actions based on the current report status.
 *
 * Validates: Requirements 8.3, 5.1, 5.2, 6.5, 6.6
 */
export function ReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const { data, isLoading, error, refetch } = useReport(reportId ?? '');
  const { validate, isLoading: isValidating, error: validateError, reset: resetValidate } = useValidateReport(reportId ?? '');
  const { submit, isLoading: isSubmitting, error: submitError, reset: resetSubmit } = useSubmitReport(reportId ?? '');

  const report = data?.report;
  const latestValidation = data?.latest_validation;

  // Poll while status is "validating"
  useValidationPolling(reportId ?? '', report?.status ?? 'draft');

  const [showUploadModal, setShowUploadModal] = useState(false);

  // ─── Loading State ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <PageContainer title="Report Details">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
        </div>
      </PageContainer>
    );
  }

  // ─── Error State ──────────────────────────────────────────────────────────

  if (error || !report) {
    return (
      <PageContainer title="Report Details">
        <ErrorDisplay
          error={error ?? 'Report not found'}
          title="Failed to load report"
          onRetry={() => refetch()}
        />
      </PageContainer>
    );
  }

  // ─── Derived State ────────────────────────────────────────────────────────

  const actions = getAvailableActions(report.status);
  const breadcrumbs = [
    { label: 'Reports', path: '/reports' },
    { label: report.title },
  ];

  // ─── Action Handlers ──────────────────────────────────────────────────────

  const handleRequestValidation = async () => {
    resetValidate();
    await validate();
  };

  const handleSubmit = async () => {
    resetSubmit();
    await submit();
  };

  const handleUploadSuccess = () => {
    setShowUploadModal(false);
    refetch();
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <PageContainer
      title={report.title}
      breadcrumbs={breadcrumbs}
      actions={
        <div className="flex items-center gap-2">
          {actions.includes('request_validation') && (
            <Button
              onClick={handleRequestValidation}
              disabled={isValidating}
              variant="outline"
            >
              <ShieldCheck size={16} />
              {isValidating ? 'Requesting...' : 'Request Validation'}
            </Button>
          )}
          {actions.includes('upload_version') && (
            <Button
              onClick={() => setShowUploadModal(true)}
              variant="outline"
            >
              <Upload size={16} />
              Upload New Version
            </Button>
          )}
          {actions.includes('submit') && (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              <Send size={16} />
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* Action errors */}
        {validateError && (
          <ErrorDisplay
            error={validateError}
            title="Validation request failed"
            variant="banner"
            onDismiss={() => resetValidate()}
          />
        )}
        {submitError && (
          <ErrorDisplay
            error={submitError}
            title="Submission failed"
            variant="banner"
            onDismiss={() => resetSubmit()}
          />
        )}

        {/* Document Info Card */}
        <Card>
          <CardHeader title="Document Information" />
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <InfoItem
                icon={<FileText size={16} className="text-gray-400" />}
                label="Status"
                value={
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariants[report.status]}>
                      {statusLabels[report.status]}
                    </Badge>
                    {report.status === 'validating' && (
                      <span
                        className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse"
                        aria-label="Validation in progress"
                      />
                    )}
                  </div>
                }
              />
              <InfoItem
                icon={<Hash size={16} className="text-gray-400" />}
                label="Version"
                value={<span className="text-sm text-gray-900">v{report.current_version}</span>}
              />
              <InfoItem
                icon={<Calendar size={16} className="text-gray-400" />}
                label="Uploaded"
                value={<span className="text-sm text-gray-900">{formatDate(report.created_at)}</span>}
              />
              <InfoItem
                icon={<ShieldCheck size={16} className="text-gray-400" />}
                label="Score"
                value={<ComplianceScoreBadge score={report.latest_score} />}
              />
            </div>
            {report.submitted_at && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  Submitted on {formatDate(report.submitted_at)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Validation Progress (when validating) */}
        {report.status === 'validating' && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 text-primary-500 animate-spin mb-4" />
              <p className="text-sm font-medium text-gray-900 mb-1">Validation in Progress</p>
              <p className="text-xs text-gray-500">
                Your report is being analyzed for compliance. This may take a few moments.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Validation Results */}
        {latestValidation && (
          <ValidationResultsPanel
            validationResult={latestValidation}
            onRetry={handleRequestValidation}
          />
        )}

        {/* Version History */}
        <VersionHistoryPanel reportId={report.report_id} />
      </div>

      {/* Upload New Version Modal */}
      <ReportUploadForm
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        mode="new-version"
        reportId={report.report_id}
        onSuccess={handleUploadSuccess}
      />
    </PageContainer>
  );
}

// ─── Info Item ────────────────────────────────────────────────────────────────

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        {value}
      </div>
    </div>
  );
}

export default ReportDetailPage;
