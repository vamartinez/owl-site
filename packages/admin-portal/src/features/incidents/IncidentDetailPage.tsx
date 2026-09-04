import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Link as LinkIcon } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { apiClient, type ApiClientError } from '@/services/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useIncident } from './hooks/useIncident';
import { useLinkedDocuments } from './hooks/useLinkedDocuments';
import { StateTransitionButton } from './StateTransitionButton';
import { RegulatoryAlertBanner } from './RegulatoryAlertBanner';
import { TimelineView } from './TimelineView';
import { DocumentTimelineView } from './DocumentTimelineView';
import { CombinedTimelineView } from './CombinedTimelineView';
import { LinkFormModal } from './LinkFormModal';
import { UnlinkConfirmModal } from './UnlinkConfirmModal';
import { LinkedDocsBadge } from './LinkedDocsBadge';
import { EvidenceUpload } from './EvidenceUpload';
import { PersonsInvolvedPanel } from './PersonsInvolvedPanel';
import { CommentsSection } from './CommentsSection';
import { RegulatoryDataForm } from './RegulatoryDataForm';
import { ExportPanel } from './ExportPanel';
import { closureSchema, reopenSchema, type ClosureFormData, type ReopenFormData } from './schemas';
import {
  IncidentStatus,
  ExternalReportStatus,
  RegulatoryFlag,
  type Incident,
  type LinkedDocument,
} from './types';
import {
  STATUS_LABELS,
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  REGULATORY_FLAG_LABELS,
  EXTERNAL_REPORT_STATUS_LABELS,
} from './constants';

// ─── Types ───────────────────────────────────────────────────────────────────

type DetailTab = 'details' | 'timeline' | 'documents' | 'regulatory' | 'evidence' | 'comments';

type DocumentsViewMode = 'documents' | 'combined';

/** Roles allowed to link documents — Requirement 8.1 */
const LINK_ROLES = ['tenant_admin', 'site_admin', 'supervisor', 'cso'] as const;

/** Roles allowed to unlink documents — Requirement 8.2 */
const UNLINK_ROLES = ['tenant_admin', 'cso'] as const;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * IncidentDetailPage — full incident view with tabbed layout.
 * Tabs: Details, Timeline, Regulatory, Evidence, Comments.
 *
 * Integrates: StateTransitionButton, RegulatoryAlertBanner, TimelineView,
 * EvidenceUpload, PersonsInvolvedPanel, CommentsSection, RegulatoryDataForm, ExportPanel.
 *
 * Includes closure dialog (resolution notes >= 20 chars) and reopen dialog
 * (justification >= 20 chars). Shows external report status warning indicator
 * in header when status is "external report pending".
 *
 * Requirements: 5.2, 7.1, 15.2, 16.3, 19.1, 19.2, 20.1, 20.3
 */
export function IncidentDetailPage() {
  const { id: incidentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: incident, isLoading, isError, error, refetch } = useIncident(incidentId);

  const [activeTab, setActiveTab] = useState<DetailTab>('details');
  const [showClosureDialog, setShowClosureDialog] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);

  // ─── Documents Tab State ─────────────────────────────────────────────────
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [unlinkDocument, setUnlinkDocument] = useState<LinkedDocument | null>(null);
  const [viewMode, setViewMode] = useState<DocumentsViewMode>('documents');

  // ─── Role-based permissions for documents ────────────────────────────────
  const role = useAuthStore((state) => state.role);
  const canLink = !!role && (LINK_ROLES as readonly string[]).includes(role);
  const canUnlink = !!role && (UNLINK_ROLES as readonly string[]).includes(role);

  // ─── Linked Documents (for finding doc by link_id on unlink) ─────────────
  const { data: linkedDocsData } = useLinkedDocuments(incidentId);

  // ─── Closure Mutation ────────────────────────────────────────────────────

  const closeMutation = useMutation<Incident, ApiClientError, ClosureFormData>({
    mutationFn: async (data) => {
      return apiClient.post<Incident>(
        `/incidents/${incidentId}/close`,
        { resolution_notes: data.resolution_notes }
      );
    },
    onSuccess: () => {
      setShowClosureDialog(false);
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId] });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'timeline'] });
    },
  });

  // ─── Reopen Mutation ─────────────────────────────────────────────────────

  const reopenMutation = useMutation<Incident, ApiClientError, ReopenFormData>({
    mutationFn: async (data) => {
      return apiClient.post<Incident>(
        `/incidents/${incidentId}/reopen`,
        { justification: data.justification }
      );
    },
    onSuccess: () => {
      setShowReopenDialog(false);
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId] });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'timeline'] });
    },
  });

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleClosureSubmit = useCallback(
    (data: ClosureFormData) => {
      closeMutation.mutate(data);
    },
    [closeMutation]
  );

  const handleReopenSubmit = useCallback(
    (data: ReopenFormData) => {
      reopenMutation.mutate(data);
    },
    [reopenMutation]
  );

  // ─── Documents Tab Handlers ──────────────────────────────────────────────

  const handleUnlink = useCallback(
    (linkId: string) => {
      const doc = linkedDocsData?.linked_documents.find((d) => d.link_id === linkId) ?? null;
      setUnlinkDocument(doc);
    },
    [linkedDocsData]
  );

  // ─── Loading State ───────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <PageContainer title="Loading Incident...">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </PageContainer>
    );
  }

  // ─── Error State ─────────────────────────────────────────────────────────

  if (isError || !incident) {
    return (
      <PageContainer title="Incident">
        <ErrorDisplay
          error={error}
          title="Failed to load incident"
          onRetry={() => refetch()}
        />
      </PageContainer>
    );
  }

  // ─── Derived State ───────────────────────────────────────────────────────

  const isClosed = incident.status === IncidentStatus.CLOSED;
  const isResolved = incident.status === IncidentStatus.RESOLVED;
  const isExternalReportPending =
    incident.external_report_status === ExternalReportStatus.EXTERNAL_REPORT_PENDING;
  const isImmediatelyReportable =
    incident.regulatory_flag === RegulatoryFlag.IMMEDIATELY_REPORTABLE;

  const breadcrumbs = [
    { label: 'Incidents', href: '/incidents' },
    { label: incident.title },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <PageContainer
      title={incident.title}
      breadcrumbs={breadcrumbs}
      actions={
        <div className="flex items-center gap-2">
          {/* External Report Pending Warning — Requirement 16.3 */}
          {isExternalReportPending && (
            <Badge variant="warning" className="flex items-center gap-1">
              <AlertTriangle size={12} />
              External Report Pending
            </Badge>
          )}

          {/* Close button — only from Resolved state — Requirement 19.1 */}
          {isResolved && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowClosureDialog(true)}
            >
              Close Incident
            </Button>
          )}

          {/* Reopen button — only from Closed state — Requirement 20.1 */}
          {isClosed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowReopenDialog(true)}
            >
              Reopen Incident
            </Button>
          )}
        </div>
      }
    >
      {/* Regulatory Alert Banner — Requirement 7.1 */}
      {isImmediatelyReportable && (
        <RegulatoryAlertBanner incident={incident} />
      )}

      {/* Incident Header Summary */}
      <Card>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Status</p>
              <Badge
                variant={
                  incident.status === IncidentStatus.CLOSED
                    ? 'default'
                    : incident.status === IncidentStatus.RESOLVED
                      ? 'success'
                      : incident.status === IncidentStatus.ACTION_REQUIRED
                        ? 'danger'
                        : 'info'
                }
              >
                {STATUS_LABELS[incident.status]}
              </Badge>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Type</p>
              <p className="text-sm text-gray-900">
                {INCIDENT_TYPE_LABELS[incident.incident_type]}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Severity</p>
              <Badge
                variant={
                  incident.severity === 'critical'
                    ? 'danger'
                    : incident.severity === 'high'
                      ? 'warning'
                      : 'default'
                }
              >
                {SEVERITY_LABELS[incident.severity]}
              </Badge>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase">Regulatory Flag</p>
              <Badge
                variant={
                  incident.regulatory_flag === RegulatoryFlag.IMMEDIATELY_REPORTABLE
                    ? 'danger'
                    : incident.regulatory_flag === RegulatoryFlag.POTENTIALLY_REPORTABLE
                      ? 'warning'
                      : 'default'
                }
              >
                {REGULATORY_FLAG_LABELS[incident.regulatory_flag]}
              </Badge>
            </div>
          </div>

          {/* State Transition — Requirement 5.2 */}
          {!isClosed && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <StateTransitionButton
                incidentId={incident.incident_id}
                currentStatus={incident.status}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200" role="tablist" aria-label="Incident detail tabs">
        <nav className="flex -mb-px space-x-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              {tab.id === 'documents' && (
                <LinkedDocsBadge count={incident.linked_documents_count} />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Panels */}
      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'details' && (
          <DetailsPanel incident={incident} />
        )}
        {activeTab === 'timeline' && (
          <TimelineView incidentId={incidentId} />
        )}
        {activeTab === 'documents' && (
          <div className="space-y-4">
            {/* Toolbar: View mode toggle + Link button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('documents')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === 'documents'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  aria-pressed={viewMode === 'documents'}
                >
                  Solo Documentos
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('combined')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === 'combined'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  aria-pressed={viewMode === 'combined'}
                >
                  Vista Combinada
                </button>
              </div>

              {canLink && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setLinkModalOpen(true)}
                >
                  <LinkIcon size={14} />
                  Vincular Documento
                </Button>
              )}
            </div>

            {/* View content based on viewMode */}
            {viewMode === 'documents' ? (
              <DocumentTimelineView
                incidentId={incident.incident_id}
                canUnlink={canUnlink}
                onUnlink={handleUnlink}
              />
            ) : (
              <CombinedTimelineView
                incidentId={incident.incident_id}
                canUnlink={canUnlink}
                onUnlink={handleUnlink}
              />
            )}
          </div>
        )}
        {activeTab === 'regulatory' && (
          <div className="space-y-6">
            <RegulatoryDataForm incident={incident} />
            <ExportPanel incidentId={incident.incident_id} />
          </div>
        )}
        {activeTab === 'evidence' && (
          <EvidenceUpload incidentId={incident.incident_id} disabled={isClosed} />
        )}
        {activeTab === 'comments' && (
          <div className="space-y-6">
            <CommentsSection incidentId={incidentId} />
            <PersonsInvolvedPanel incidentId={incident.incident_id} readOnly={isClosed} />
          </div>
        )}
      </div>

      {/* Link Form Modal — Requirement 3.4, 8.1 */}
      <LinkFormModal
        incidentId={incident.incident_id}
        isOpen={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
      />

      {/* Unlink Confirm Modal — Requirement 8.3 */}
      <UnlinkConfirmModal
        incidentId={incident.incident_id}
        document={unlinkDocument}
        isOpen={!!unlinkDocument}
        onClose={() => setUnlinkDocument(null)}
      />

      {/* Closure Dialog — Requirements 19.1, 19.2 */}
      <ClosureDialog
        open={showClosureDialog}
        onClose={() => setShowClosureDialog(false)}
        onSubmit={handleClosureSubmit}
        isPending={closeMutation.isPending}
        error={closeMutation.error?.message}
      />

      {/* Reopen Dialog — Requirements 20.1, 20.3 */}
      <ReopenDialog
        open={showReopenDialog}
        onClose={() => setShowReopenDialog(false)}
        onSubmit={handleReopenSubmit}
        isPending={reopenMutation.isPending}
        error={reopenMutation.error?.message}
      />
    </PageContainer>
  );
}

// ─── Tab Configuration ─────────────────────────────────────────────────────

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'details', label: 'Details' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'documents', label: 'Documentos' },
  { id: 'regulatory', label: 'Regulatory' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'comments', label: 'Comments' },
];

// ─── Details Panel ─────────────────────────────────────────────────────────

function DetailsPanel({ incident }: { incident: Incident }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Incident Information" />
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Title</dt>
              <dd className="mt-1 text-sm text-gray-900">{incident.title}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Incident Date/Time</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {formatDateTime(incident.incident_datetime)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-medium text-gray-500">Description</dt>
              <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                {incident.description}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Location</dt>
              <dd className="mt-1 text-sm text-gray-900">{incident.location}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Persons Involved</dt>
              <dd className="mt-1 text-sm text-gray-900">{incident.persons_involved_count}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Reported By</dt>
              <dd className="mt-1 text-sm text-gray-900">{incident.reporting_user_name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Report Date/Time</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {formatDateTime(incident.report_datetime)}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Jurisdiction</dt>
              <dd className="mt-1 text-sm text-gray-900">{incident.jurisdiction}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">External Report Status</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {EXTERNAL_REPORT_STATUS_LABELS[incident.external_report_status]}
              </dd>
            </div>
            {incident.resolution_notes && (
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-gray-500">Resolution Notes</dt>
                <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                  {incident.resolution_notes}
                </dd>
              </div>
            )}
            {incident.reopen_justification && (
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-gray-500">Reopen Justification</dt>
                <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
                  {incident.reopen_justification}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <PersonsInvolvedPanel
        incidentId={incident.incident_id}
        readOnly={incident.status === IncidentStatus.CLOSED}
      />
    </div>
  );
}

// ─── Closure Dialog ────────────────────────────────────────────────────────

interface ClosureDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ClosureFormData) => void;
  isPending: boolean;
  error?: string | null;
}

function ClosureDialog({ open, onClose, onSubmit, isPending, error }: ClosureDialogProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ClosureFormData>({
    resolver: zodResolver(closureSchema),
    defaultValues: { resolution_notes: '' },
  });

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  return (
    <Modal open={open} onClose={handleClose} title="Close Incident" size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-gray-600">
          Document the resolution and actions taken to formally close this incident.
          Resolution notes must be at least 20 characters.
        </p>

        <div>
          <label htmlFor="resolution-notes" className="block text-sm font-medium text-gray-700">
            Resolution Notes
          </label>
          <textarea
            id="resolution-notes"
            rows={4}
            placeholder="Describe the resolution and actions taken..."
            className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 resize-y ${
              errors.resolution_notes ? 'border-red-300' : 'border-gray-300'
            }`}
            aria-invalid={!!errors.resolution_notes}
            aria-describedby={errors.resolution_notes ? 'closure-error' : undefined}
            {...register('resolution_notes')}
          />
          {errors.resolution_notes && (
            <p id="closure-error" className="mt-1 text-xs text-red-600" role="alert">
              {errors.resolution_notes.message}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2" role="alert">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? 'Closing...' : 'Close Incident'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Reopen Dialog ─────────────────────────────────────────────────────────

interface ReopenDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ReopenFormData) => void;
  isPending: boolean;
  error?: string | null;
}

function ReopenDialog({ open, onClose, onSubmit, isPending, error }: ReopenDialogProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ReopenFormData>({
    resolver: zodResolver(reopenSchema),
    defaultValues: { justification: '' },
  });

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  return (
    <Modal open={open} onClose={handleClose} title="Reopen Incident" size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-gray-600">
          Provide a justification for reopening this incident. The justification must be
          at least 20 characters.
        </p>

        <div>
          <label htmlFor="reopen-justification" className="block text-sm font-medium text-gray-700">
            Justification
          </label>
          <textarea
            id="reopen-justification"
            rows={4}
            placeholder="Explain why this incident needs to be reopened..."
            className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 resize-y ${
              errors.justification ? 'border-red-300' : 'border-gray-300'
            }`}
            aria-invalid={!!errors.justification}
            aria-describedby={errors.justification ? 'reopen-error' : undefined}
            {...register('justification')}
          />
          {errors.justification && (
            <p id="reopen-error" className="mt-1 text-xs text-red-600" role="alert">
              {errors.justification.message}
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2" role="alert">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? 'Reopening...' : 'Reopen Incident'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDateTime(isoString: string): string {
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
