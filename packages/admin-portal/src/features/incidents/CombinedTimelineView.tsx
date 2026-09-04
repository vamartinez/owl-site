import { useMemo } from 'react';
import { FileText, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { LinkedDocumentCard } from './LinkedDocumentCard';
import { useLinkedDocuments } from './hooks/useLinkedDocuments';
import { useIncidentTimeline } from './hooks/useIncidentTimeline';
import type { DocumentCategory, LinkedDocument, TimelineEvent } from './types';
import { TimelineEventType } from './types';

interface CombinedTimelineViewProps {
  incidentId: string;
  canUnlink: boolean;
  onUnlink: (linkId: string) => void;
  selectedCategories?: DocumentCategory[];
}

/**
 * Unified timeline that merges audit trail events with linked documents
 * into a single chronological (descending) view.
 *
 * Requirements: 7.1, 7.2, 7.3
 */
export function CombinedTimelineView({
  incidentId,
  canUnlink,
  onUnlink,
  selectedCategories,
}: CombinedTimelineViewProps) {
  const categories = selectedCategories && selectedCategories.length > 0 ? selectedCategories : undefined;
  const {
    data: docsData,
    isLoading: isLoadingDocs,
    isError: isDocsError,
    error: docsError,
    refetch: refetchDocs,
  } = useLinkedDocuments(incidentId, categories);

  const {
    data: timelineEvents,
    isLoading: isLoadingTimeline,
    isError: isTimelineError,
    error: timelineError,
    refetch: refetchTimeline,
  } = useIncidentTimeline(incidentId);

  const isLoading = isLoadingDocs || isLoadingTimeline;
  const isError = isDocsError || isTimelineError;

  // Merge and sort both streams chronologically (descending)
  const mergedItems = useMemo(() => {
    const items: Array<
      | { type: 'document'; data: LinkedDocument; timestamp: string }
      | { type: 'event'; data: TimelineEvent; timestamp: string }
    > = [];

    if (docsData?.linked_documents) {
      for (const doc of docsData.linked_documents) {
        items.push({
          type: 'document',
          data: doc,
          timestamp: doc.response_submitted_at,
        });
      }
    }

    if (timelineEvents) {
      for (const event of timelineEvents) {
        items.push({
          type: 'event',
          data: event,
          timestamp: event.timestamp,
        });
      }
    }

    // Sort descending by timestamp
    items.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return items;
  }, [docsData?.linked_documents, timelineEvents]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader
          title="Vista Combinada"
          description="Línea de tiempo unificada: documentos y eventos del incidente"
        />
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse rounded-lg border border-gray-200 p-4 space-y-2">
                <div className="h-4 bg-gray-100 rounded w-2/3" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader
          title="Vista Combinada"
          description="Línea de tiempo unificada: documentos y eventos del incidente"
        />
        <CardContent>
          <ErrorDisplay
            error={docsError || timelineError}
            title="Error al cargar la línea de tiempo combinada"
            onRetry={() => {
              refetchDocs();
              refetchTimeline();
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Vista Combinada"
        description="Línea de tiempo unificada: documentos y eventos del incidente"
        action={<Badge variant="info">{mergedItems.length} entradas</Badge>}
      />
      <CardContent>
        {mergedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
              <Clock className="text-gray-400" size={24} />
            </div>
            <h4 className="text-sm font-medium text-gray-900 mb-1">Sin actividad</h4>
            <p className="text-sm text-gray-500">
              No hay eventos ni documentos vinculados para este incidente.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {mergedItems.map((item) => {
              if (item.type === 'document') {
                return (
                  <LinkedDocumentCard
                    key={`doc-${item.data.link_id}`}
                    document={item.data}
                    canUnlink={canUnlink}
                    onUnlink={onUnlink}
                  />
                );
              }

              // Audit trail event
              const event = item.data;
              return (
                <AuditEventEntry key={`event-${event.event_id}`} event={event} />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Audit Event Entry ────────────────────────────────────────────────────────

const EVENT_TYPE_LABELS: Partial<Record<TimelineEventType, string>> = {
  [TimelineEventType.CREATION]: 'Incidente creado',
  [TimelineEventType.STATE_CHANGE]: 'Cambio de estado',
  [TimelineEventType.SEVERITY_CHANGE]: 'Cambio de severidad',
  [TimelineEventType.REGULATORY_EVALUATION]: 'Evaluación regulatoria',
  [TimelineEventType.REGULATORY_REVIEW_CONFIRMATION]: 'Revisión regulatoria confirmada',
  [TimelineEventType.EXTERNAL_STATUS_CHANGE]: 'Cambio de estatus externo',
  [TimelineEventType.ATTACHMENT_ADDED]: 'Evidencia adjuntada',
  [TimelineEventType.COMMENT_ADDED]: 'Comentario añadido',
  [TimelineEventType.PERSON_ADDED]: 'Persona involucrada agregada',
  [TimelineEventType.PERSON_REMOVED]: 'Persona involucrada removida',
  [TimelineEventType.CLOSURE]: 'Incidente cerrado',
  [TimelineEventType.REOPENING]: 'Incidente reabierto',
  [TimelineEventType.NOTIFICATION_SENT]: 'Notificación enviada',
  [TimelineEventType.FIELD_UPDATED]: 'Campo actualizado',
  [TimelineEventType.REGULATORY_FLAG_CHANGE]: 'Cambio de bandera regulatoria',
  [TimelineEventType.RECORDABILITY_CHANGE]: 'Cambio de recordabilidad',
};

function AuditEventEntry({ event }: { event: TimelineEvent }) {
  const label = EVENT_TYPE_LABELS[event.event_type] || event.event_type;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gray-200 shrink-0">
        <Clock size={14} className="text-gray-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {event.actor_name} • {formatTimestamp(event.timestamp)}
        </p>
      </div>
      <Badge variant="default" className="shrink-0 text-xs">
        Evento
      </Badge>
    </div>
  );
}

function formatTimestamp(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}
