import {
  PlusCircle,
  ArrowRightLeft,
  Shield,
  Paperclip,
  MessageSquare,
  UserPlus,
  UserMinus,
  Lock,
  Unlock,
  Bell,
  Edit,
  Flag,
  ClipboardCheck,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useIncidentTimeline } from './hooks/useIncidentTimeline';
import { TimelineEventType, type TimelineEvent } from './types';

/**
 * Maps each timeline event type to a lucide icon and Badge variant.
 */
const EVENT_CONFIG: Record<
  TimelineEventType,
  { icon: LucideIcon; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple'; label: string }
> = {
  [TimelineEventType.CREATION]: { icon: PlusCircle, variant: 'success', label: 'Created' },
  [TimelineEventType.SEVERITY_CHANGE]: { icon: AlertTriangle, variant: 'warning', label: 'Severity Change' },
  [TimelineEventType.STATE_CHANGE]: { icon: ArrowRightLeft, variant: 'info', label: 'State Change' },
  [TimelineEventType.REGULATORY_EVALUATION]: { icon: Shield, variant: 'purple', label: 'Regulatory Evaluation' },
  [TimelineEventType.REGULATORY_REVIEW_CONFIRMATION]: { icon: ClipboardCheck, variant: 'purple', label: 'Review Confirmed' },
  [TimelineEventType.EXTERNAL_STATUS_CHANGE]: { icon: Flag, variant: 'warning', label: 'External Status' },
  [TimelineEventType.ATTACHMENT_ADDED]: { icon: Paperclip, variant: 'default', label: 'Attachment' },
  [TimelineEventType.COMMENT_ADDED]: { icon: MessageSquare, variant: 'info', label: 'Comment' },
  [TimelineEventType.PERSON_ADDED]: { icon: UserPlus, variant: 'success', label: 'Person Added' },
  [TimelineEventType.PERSON_REMOVED]: { icon: UserMinus, variant: 'danger', label: 'Person Removed' },
  [TimelineEventType.CLOSURE]: { icon: Lock, variant: 'default', label: 'Closed' },
  [TimelineEventType.REOPENING]: { icon: Unlock, variant: 'warning', label: 'Reopened' },
  [TimelineEventType.NOTIFICATION_SENT]: { icon: Bell, variant: 'info', label: 'Notification' },
  [TimelineEventType.FIELD_UPDATED]: { icon: Edit, variant: 'default', label: 'Field Updated' },
  [TimelineEventType.REGULATORY_FLAG_CHANGE]: { icon: Flag, variant: 'danger', label: 'Regulatory Flag' },
  [TimelineEventType.RECORDABILITY_CHANGE]: { icon: ClipboardCheck, variant: 'warning', label: 'Recordability' },
};

interface TimelineViewProps {
  incidentId: string | undefined;
}

/**
 * Chronological display of all audit events for an incident.
 * Renders event type icon, actor name, change data, and UTC timestamp.
 *
 * Requirements: 15.1, 15.2
 */
export function TimelineView({ incidentId }: TimelineViewProps) {
  const { data: events, isLoading, isError, error, refetch } = useIncidentTimeline(incidentId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Timeline" description="Audit trail of all incident events" />
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="h-8 w-8 rounded-full bg-gray-100 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-100 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                </div>
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
        <CardHeader title="Timeline" description="Audit trail of all incident events" />
        <CardContent>
          <ErrorDisplay
            error={error}
            title="Failed to load timeline"
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Timeline" description="Audit trail of all incident events" />
      <CardContent>
        {!events || events.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">No timeline events yet.</p>
        ) : (
          <ol className="relative border-l border-gray-200 ml-4 space-y-6">
            {events.map((event) => (
              <TimelineEntry key={event.event_id} event={event} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function TimelineEntry({ event }: { event: TimelineEvent }) {
  const config = EVENT_CONFIG[event.event_type] ?? EVENT_CONFIG[TimelineEventType.FIELD_UPDATED];
  const Icon = config.icon;

  return (
    <li className="ml-6">
      <span className="absolute -left-4 flex items-center justify-center w-8 h-8 rounded-full bg-white border border-gray-200 shadow-sm">
        <Icon size={16} className="text-gray-600" />
      </span>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={config.variant}>{config.label}</Badge>
          <span className="text-sm font-medium text-gray-900">{event.actor_name}</span>
          <span className="text-xs text-gray-400">{formatUtcTimestamp(event.timestamp)}</span>
        </div>
        <ChangeDataDisplay eventType={event.event_type} data={event.data} />
      </div>
    </li>
  );
}

/**
 * Formats change data based on event type for human-readable display.
 */
function ChangeDataDisplay({
  eventType,
  data,
}: {
  eventType: TimelineEventType;
  data: Record<string, unknown>;
}) {
  if (!data || Object.keys(data).length === 0) {
    return null;
  }

  const description = formatChangeData(eventType, data);
  if (!description) return null;

  return <p className="text-sm text-gray-600">{description}</p>;
}

function formatChangeData(eventType: TimelineEventType, data: Record<string, unknown>): string {
  switch (eventType) {
    case TimelineEventType.STATE_CHANGE:
      return `${formatValue(data.previous_state)} → ${formatValue(data.new_state)}`;

    case TimelineEventType.SEVERITY_CHANGE:
      return `Severity: ${formatValue(data.previous_severity)} → ${formatValue(data.new_severity)}`;

    case TimelineEventType.REGULATORY_FLAG_CHANGE:
      return `Flag: ${formatValue(data.previous_flag)} → ${formatValue(data.new_flag)}`;

    case TimelineEventType.EXTERNAL_STATUS_CHANGE:
      return `External status: ${formatValue(data.previous_status)} → ${formatValue(data.new_status)}`;

    case TimelineEventType.RECORDABILITY_CHANGE:
      return `Recordability: ${formatValue(data.previous_classification)} → ${formatValue(data.new_classification)}`;

    case TimelineEventType.ATTACHMENT_ADDED:
      return `File: ${data.file_name ? String(data.file_name) : '—'}${data.mime_type ? ` (${data.mime_type})` : ''}`;

    case TimelineEventType.COMMENT_ADDED:
      return data.content ? truncate(String(data.content), 120) : 'Comment added';

    case TimelineEventType.PERSON_ADDED:
      return `${formatValue(data.full_name)} — ${formatValue(data.involvement_type)}`;

    case TimelineEventType.PERSON_REMOVED:
      return `Removed: ${formatValue(data.full_name)}`;

    case TimelineEventType.CLOSURE:
      return data.resolution_notes ? truncate(String(data.resolution_notes), 120) : 'Incident closed';

    case TimelineEventType.REOPENING:
      return data.justification ? truncate(String(data.justification), 120) : 'Incident reopened';

    case TimelineEventType.NOTIFICATION_SENT:
      return `${formatValue(data.notification_type)} → ${formatValue(data.recipient)}`;

    case TimelineEventType.REGULATORY_EVALUATION: {
      const rules = Array.isArray(data.applied_rules) ? data.applied_rules.join(', ') : '';
      return rules ? `Rules applied: ${rules}` : `Flag: ${formatValue(data.regulatory_flag)}`;
    }

    case TimelineEventType.FIELD_UPDATED:
      return `${formatValue(data.field)}: ${formatValue(data.previous_value)} → ${formatValue(data.new_value)}`;

    case TimelineEventType.CREATION:
      return data.title ? String(data.title) : 'Incident created';

    default:
      return summarizeData(data);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value).replace(/_/g, ' ');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '…';
}

function summarizeData(data: Record<string, unknown>): string {
  const entries = Object.entries(data).slice(0, 3);
  return entries.map(([key, val]) => `${key.replace(/_/g, ' ')}: ${formatValue(val)}`).join(', ');
}

/**
 * Formats an ISO 8601 timestamp to a human-readable UTC string.
 */
function formatUtcTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return timestamp;
  return date.toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' UTC';
}
