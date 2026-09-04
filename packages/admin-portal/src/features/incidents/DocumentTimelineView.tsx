import { useState, useMemo } from 'react';
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { CategoryFilter } from './CategoryFilter';
import { LinkedDocumentCard } from './LinkedDocumentCard';
import { useLinkedDocuments } from './hooks/useLinkedDocuments';
import type { DocumentCategory, LinkedDocument } from './types';

interface DocumentTimelineViewProps {
  incidentId: string;
  canUnlink: boolean;
  onUnlink: (linkId: string) => void;
}

/**
 * Timeline view of linked documents for an incident, with multi-select category filtering.
 * Documents are displayed in reverse chronological order (newest first) by response_submitted_at.
 *
 * Requirements: 3.1, 3.4, 4.1
 */
export function DocumentTimelineView({
  incidentId,
  canUnlink,
  onUnlink,
}: DocumentTimelineViewProps) {
  const [selectedCategories, setSelectedCategories] = useState<DocumentCategory[]>([]);

  const categories = selectedCategories.length > 0 ? selectedCategories : undefined;
  const { data, isLoading, isError, error, refetch } = useLinkedDocuments(incidentId, categories);

  const sortedDocuments = useMemo(() => {
    if (!data?.linked_documents) return [];
    return [...data.linked_documents].sort(
      (a, b) =>
        new Date(b.response_submitted_at).getTime() -
        new Date(a.response_submitted_at).getTime()
    );
  }, [data?.linked_documents]);

  const totalCount = data?.total_count ?? 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader
          title="Documentos Vinculados"
          description="Línea de tiempo de documentos asociados al incidente"
        />
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="h-4 bg-gray-100 rounded w-2/3" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
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
          title="Documentos Vinculados"
          description="Línea de tiempo de documentos asociados al incidente"
        />
        <CardContent>
          <ErrorDisplay
            error={error}
            title="Error al cargar documentos"
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Documentos Vinculados"
        description="Línea de tiempo de documentos asociados al incidente"
        action={<Badge variant="info">{totalCount} documentos</Badge>}
      />
      <CardContent>
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar: Category filter */}
          <aside className="lg:w-56 shrink-0">
            <CategoryFilter
              selectedCategories={selectedCategories}
              onChange={setSelectedCategories}
              resultCount={selectedCategories.length > 0 ? sortedDocuments.length : undefined}
            />
          </aside>

          {/* Main: Document list */}
          <div className="flex-1 min-w-0">
            {sortedDocuments.length === 0 ? (
              <EmptyState hasFilters={selectedCategories.length > 0} />
            ) : (
              <div className="space-y-4">
                {sortedDocuments.map((doc) => (
                  <LinkedDocumentCard
                    key={doc.link_id}
                    document={doc}
                    canUnlink={canUnlink}
                    onUnlink={onUnlink}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Empty state displayed when no linked documents are found.
 */
function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
        <FileText className="text-gray-400" size={24} />
      </div>
      <h4 className="text-sm font-medium text-gray-900 mb-1">
        {hasFilters ? 'Sin resultados' : 'Sin documentos vinculados'}
      </h4>
      <p className="text-sm text-gray-500 max-w-sm">
        {hasFilters
          ? 'No se encontraron documentos que coincidan con los filtros seleccionados.'
          : 'Este incidente aún no tiene documentos vinculados. Vincula formularios completados para construir la línea de tiempo del caso.'}
      </p>
    </div>
  );
}
