import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Unlink, ChevronDown, ChevronUp, FileText, User, Calendar, LinkIcon } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  type LinkedDocument,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_CATEGORY_COLORS,
} from './types';

interface LinkedDocumentCardProps {
  document: LinkedDocument;
  onUnlink?: (linkId: string) => void;
  canUnlink: boolean;
}

/**
 * Card displaying a linked document (form response) associated with an incident.
 * Shows form name, folio, category badge, submission date, submitter, linker info,
 * an expandable context note, a navigation button, and an unlink button (role-gated).
 *
 * Requirements: 3.2, 3.3, 5.1, 8.2
 */
export function LinkedDocumentCard({ document, onUnlink, canUnlink }: LinkedDocumentCardProps) {
  const [noteExpanded, setNoteExpanded] = useState(false);

  const categoryLabel = DOCUMENT_CATEGORY_LABELS[document.document_category];
  const categoryColor = DOCUMENT_CATEGORY_COLORS[document.document_category] as
    | 'default'
    | 'success'
    | 'warning'
    | 'danger'
    | 'info'
    | 'purple';

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      {/* Header: Form name + Folio + Category Badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={16} className="text-gray-400 shrink-0" />
          <h4 className="text-sm font-semibold text-gray-900 truncate">
            {document.form_name}
          </h4>
          <span className="text-xs text-gray-500 shrink-0">#{document.folio}</span>
        </div>
        <Badge variant={categoryColor}>{categoryLabel}</Badge>
      </div>

      {/* Metadata rows */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Calendar size={12} className="text-gray-400 shrink-0" />
          <span>Enviado: {formatDate(document.response_submitted_at)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <User size={12} className="text-gray-400 shrink-0" />
          <span>Completó: {document.response_submitted_by}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <LinkIcon size={12} className="text-gray-400 shrink-0" />
          <span>
            Vinculado por {document.linked_by_name} el {formatDate(document.linked_at)}
          </span>
        </div>
      </div>

      {/* Expandable context note */}
      {document.context_note && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <button
            type="button"
            onClick={() => setNoteExpanded((prev) => !prev)}
            className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
            aria-expanded={noteExpanded}
          >
            {noteExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Nota de contexto
          </button>
          {noteExpanded && (
            <p className="mt-1 text-xs text-gray-600 whitespace-pre-wrap">
              {document.context_note}
            </p>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-4 flex items-center gap-2">
        <Link to={`/forms/responses/${document.response_id}`}>
          <Button variant="outline" size="sm">
            <ExternalLink size={14} />
            Ver detalle
          </Button>
        </Link>

        {canUnlink && onUnlink && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onUnlink(document.link_id)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Unlink size={14} />
            Desvincular
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Formats an ISO 8601 timestamp to a short localized date string.
 */
function formatDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (isNaN(date.getTime())) return isoTimestamp;
  return date.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
