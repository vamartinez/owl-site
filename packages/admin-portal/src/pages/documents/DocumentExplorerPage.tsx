import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useDocExplorerStore } from '@/features/document-explorer/store';
import { useDocuments } from '@/features/document-explorer/hooks/useDocuments';
import { useFolders } from '@/features/document-explorer/hooks/useFolders';
import { formatBreadcrumbSegments } from '@/features/document-explorer/utils';
import { FolderTree } from '@/features/document-explorer/FolderTree';
import { DocumentList } from '@/features/document-explorer/DocumentList';
import { DocumentPreview } from '@/features/document-explorer/DocumentPreview';
import { DocumentMetadata } from '@/features/document-explorer/DocumentMetadata';
import { IntegrityVerification } from '@/features/document-explorer/IntegrityVerification';
import { SearchFilters } from '@/features/document-explorer/SearchFilters';
import { FolderOrganizationSelector } from '@/features/document-explorer/FolderOrganizationSelector';
import { DownloadActions } from '@/features/document-explorer/DownloadActions';
import type { BreadcrumbItem } from '@/components/layout/Breadcrumbs';

/**
 * DocumentExplorerPage is the entry-point page component for the Document Explorer feature.
 *
 * Layout:
 * - Top: Breadcrumbs with navigation
 * - Toolbar: SearchFilters (left) + FolderOrganizationSelector (right)
 * - Main body (flex row):
 *   - Left sidebar (hidden on mobile, w-64 on desktop): FolderTree
 *   - Center: DocumentList + DownloadActions
 *   - Right side panel (conditional): DocumentPreview, DocumentMetadata, IntegrityVerification
 *
 * Requirements: 1.1, 1.3, 1.4, 2.1, 2.3
 */
export default function DocumentExplorerPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const currentPath = useDocExplorerStore((s) => s.currentPath);
  const navigateTo = useDocExplorerStore((s) => s.navigateTo);
  const previewDocumentId = useDocExplorerStore((s) => s.previewDocumentId);

  const { documents } = useDocuments();
  const { isLoading: isFoldersLoading, isError: isFoldersError, error: foldersError, refetch: refetchFolders } = useFolders();

  // Sync URL path param → store when searchParams change (handles initial load + breadcrumb link clicks)
  useEffect(() => {
    const pathParam = searchParams.get('path');
    const urlSegments = pathParam ? pathParam.split('/').filter(Boolean) : [];
    const storePathString = currentPath.join('/');
    const urlPathString = urlSegments.join('/');

    if (storePathString !== urlPathString) {
      navigateTo(urlSegments);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Sync store path → URL when navigateTo is called programmatically (e.g., folder click)
  useEffect(() => {
    const pathString = currentPath.length > 0 ? currentPath.join('/') : '';
    const currentUrlPath = searchParams.get('path') ?? '';

    if (pathString !== currentUrlPath) {
      setSearchParams(
        pathString ? { path: pathString } : {},
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  // Build breadcrumb items from current path
  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    const segments = formatBreadcrumbSegments(currentPath);
    return segments.map((segment, index) => {
      const isLast = index === segments.length - 1;
      return {
        label: segment.label,
        path: isLast ? undefined : `/documents${segment.path.length > 0 ? `?path=${segment.path.join('/')}` : ''}`,
      };
    });
  }, [currentPath]);

  // Get the mime type of the currently previewed document for the DocumentPreview
  const previewedDocument = useMemo(
    () => documents.find((doc) => doc.id === previewDocumentId),
    [documents, previewDocumentId],
  );

  return (
    <div className="space-y-4" data-testid="document-explorer-page">
      {/* Breadcrumbs */}
      <Breadcrumbs items={breadcrumbItems} />

      {/* Toolbar: SearchFilters + FolderOrganizationSelector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SearchFilters />
        <div className="flex-shrink-0">
          <FolderOrganizationSelector />
        </div>
      </div>

      {/* Page-level error state */}
      {isFoldersError && (
        <ErrorDisplay
          error={foldersError}
          title="Failed to load folder contents"
          onRetry={() => refetchFolders()}
          variant="banner"
        />
      )}

      {/* Page-level loading state */}
      {isFoldersLoading && !isFoldersError && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      )}

      {/* Main body */}
      {!isFoldersLoading && !isFoldersError && (
        <div className="flex flex-row gap-0 min-h-[500px]">
          {/* Left sidebar - FolderTree (hidden on mobile) */}
          <aside className="hidden lg:block w-64 flex-shrink-0 border-r border-gray-200 pr-4 overflow-y-auto">
            <FolderTree />
          </aside>

          {/* Center content - DocumentList + DownloadActions */}
          <div className="flex-1 min-w-0 px-4">
            <div className="mb-4">
              <DownloadActions documents={documents} />
            </div>
            <DocumentList />
          </div>

          {/* Right side panel - shown when a document is selected for preview */}
          {previewDocumentId && (
            <div className="hidden md:flex md:flex-col md:gap-4 flex-shrink-0">
              <DocumentPreview mimeType={previewedDocument?.mimeType} />
              <div className="border-l border-gray-200 pl-4 space-y-4 overflow-y-auto max-h-[600px]">
                <DocumentMetadata documentId={previewDocumentId} />
                <IntegrityVerification documentId={previewDocumentId} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
