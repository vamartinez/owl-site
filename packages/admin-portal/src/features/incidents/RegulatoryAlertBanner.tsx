import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiClientError } from '@/services/api-client';
import { useAuthStore } from '@/store/auth-store';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { Incident } from './types';
import { RegulatoryFlag, ExternalReportStatus } from './types';
import { EXTERNAL_REPORT_STATUS_LABELS } from './constants';

/**
 * RegulatoryAlertBanner — fixed-position warning banner displayed when an incident
 * has regulatory_flag = "immediately_reportable".
 *
 * Displays:
 * - Reason for alert (based on active regulatory indicators)
 * - Jurisdiction (OSHA or WorkSafeBC)
 * - Detection time (when the regulatory evaluation occurred)
 * - Viewing confirmation user (who confirmed viewing)
 * - External report follow-up status
 *
 * Records first-view confirmation via API when user clicks "Confirm Viewed".
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

interface RegulatoryAlertBannerProps {
  incident: Incident;
  /** Timestamp when the regulatory evaluation detected the immediate notification requirement */
  detectionTime?: string;
  /** User who confirmed viewing the alert (null if not yet confirmed) */
  confirmedByUser?: string | null;
  /** Timestamp of the viewing confirmation */
  confirmedAt?: string | null;
}

interface ConfirmViewResponse {
  confirmed_by: string;
  confirmed_at: string;
}

/**
 * Derives the reason for the alert from the incident's active regulatory indicators.
 */
function getAlertReasons(incident: Incident): string[] {
  const reasons: string[] = [];
  const indicators = incident.regulatory_indicators;

  if (indicators.fatality) reasons.push('Fatality reported');
  if (indicators.hospitalization) reasons.push('Hospitalization');
  if (indicators.amputation) reasons.push('Amputation');
  if (indicators.loss_of_eye) reasons.push('Loss of eye');
  if (indicators.structural_collapse) reasons.push('Structural collapse');
  if (indicators.hazardous_substance_release) reasons.push('Hazardous substance release');
  if (indicators.fire_or_explosion) reasons.push('Fire or explosion');

  if (reasons.length === 0) {
    reasons.push('Immediate regulatory notification required');
  }

  return reasons;
}

/**
 * Determines the jurisdiction label from the incident's jurisdiction field.
 */
function getJurisdictionLabel(jurisdiction: string): string {
  if (jurisdiction === 'british_columbia' || jurisdiction === 'BC') {
    return 'WorkSafeBC';
  }
  // US states or any us_ prefix
  if (jurisdiction.startsWith('us_') || jurisdiction === 'US') {
    return 'OSHA';
  }
  return jurisdiction;
}

/**
 * Formats an ISO 8601 timestamp for display.
 */
function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return isoString;
  }
}

export function RegulatoryAlertBanner({
  incident,
  detectionTime,
  confirmedByUser,
  confirmedAt,
}: RegulatoryAlertBannerProps) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [localConfirmedBy, setLocalConfirmedBy] = useState<string | null>(
    confirmedByUser ?? null
  );
  const [localConfirmedAt, setLocalConfirmedAt] = useState<string | null>(
    confirmedAt ?? null
  );

  // Only show banner for immediately reportable incidents
  if (incident.regulatory_flag !== RegulatoryFlag.IMMEDIATELY_REPORTABLE) {
    return null;
  }

  const alertReasons = getAlertReasons(incident);
  const jurisdictionLabel = getJurisdictionLabel(incident.jurisdiction);
  const isConfirmed = !!localConfirmedBy;

  // Mutation to record first-view confirmation
  const confirmMutation = useMutation<ConfirmViewResponse, ApiClientError, void>({
    mutationFn: async () => {
      return apiClient.post<ConfirmViewResponse>(
        `/incidents/${incident.incident_id}/regulatory-review-confirmation`
      );
    },
    onSuccess: (data) => {
      setLocalConfirmedBy(data.confirmed_by);
      setLocalConfirmedAt(data.confirmed_at);
      // Invalidate timeline to show the new confirmation event
      queryClient.invalidateQueries({
        queryKey: ['incidents', incident.incident_id, 'timeline'],
      });
      queryClient.invalidateQueries({
        queryKey: ['incidents', incident.incident_id],
      });
    },
  });

  const handleConfirm = useCallback(() => {
    if (!isConfirmed && !confirmMutation.isPending) {
      confirmMutation.mutate();
    }
  }, [isConfirmed, confirmMutation]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-50 w-full border-b border-amber-300 bg-amber-50 px-4 py-3 shadow-md"
    >
      <div className="mx-auto max-w-7xl">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5 flex-shrink-0 text-amber-600"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 8a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            <h2 className="text-sm font-semibold text-amber-800">
              Immediate Regulatory Notification Required
            </h2>
            <Badge variant="warning">{jurisdictionLabel}</Badge>
          </div>

          {/* Confirm button */}
          {!isConfirmed && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleConfirm}
              disabled={confirmMutation.isPending}
              className="flex-shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100"
            >
              {confirmMutation.isPending ? 'Confirming...' : 'Confirm Viewed'}
            </Button>
          )}
        </div>

        {/* Details grid */}
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-amber-800 sm:grid-cols-2 lg:grid-cols-4">
          {/* Reason */}
          <div>
            <span className="font-medium">Reason: </span>
            <span>{alertReasons.join(', ')}</span>
          </div>

          {/* Jurisdiction */}
          <div>
            <span className="font-medium">Jurisdiction: </span>
            <span>{jurisdictionLabel}</span>
          </div>

          {/* Detection time */}
          <div>
            <span className="font-medium">Detected: </span>
            <span>
              {detectionTime
                ? formatTimestamp(detectionTime)
                : formatTimestamp(incident.created_at)}
            </span>
          </div>

          {/* External report status */}
          <div>
            <span className="font-medium">Report Status: </span>
            <Badge
              variant={
                incident.external_report_status === ExternalReportStatus.EXTERNAL_REPORT_PENDING
                  ? 'warning'
                  : incident.external_report_status === ExternalReportStatus.REPORTED_OSHA ||
                      incident.external_report_status === ExternalReportStatus.REPORTED_WORKSAFEBC
                    ? 'success'
                    : 'default'
              }
            >
              {EXTERNAL_REPORT_STATUS_LABELS[incident.external_report_status]}
            </Badge>
          </div>
        </div>

        {/* Confirmation status */}
        <div className="mt-2 text-xs text-amber-700">
          {isConfirmed ? (
            <span>
              ✓ Viewed by <span className="font-medium">{localConfirmedBy}</span>
              {localConfirmedAt && ` on ${formatTimestamp(localConfirmedAt)}`}
            </span>
          ) : (
            <span className="italic">
              Not yet confirmed — please review and confirm viewing this alert.
            </span>
          )}
        </div>

        {/* Error display */}
        {confirmMutation.isError && (
          <div className="mt-2 text-xs text-red-700">
            Failed to record confirmation. Please try again.
          </div>
        )}
      </div>
    </div>
  );
}
