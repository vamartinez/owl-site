import type {
  DocumentFilters,
  DocumentSummary,
  DownloadProgress,
  FolderNode,
  OrganizationMode,
} from './types';

const PREVIEWABLE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const ALLOWED_ROLES = new Set([
  'platform_admin',
  'tenant_admin',
  'site_admin',
  'supervisor',
  'cso',
]);

const MAX_BATCH_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

/**
 * Returns true if the mime type supports inline preview (PDF, JPEG, PNG).
 */
export function isPreviewable(mimeType: string): boolean {
  return PREVIEWABLE_MIME_TYPES.has(mimeType);
}

/**
 * Returns true if the search term (after trimming) is at least 2 characters.
 */
export function isSearchTermValid(term: string): boolean {
  return term.trim().length >= 2;
}

/**
 * Returns true if the user role is allowed to access the Document Explorer.
 */
export function canAccessDocumentExplorer(role: string): boolean {
  return ALLOWED_ROLES.has(role);
}

/**
 * Computes the folder path array for a document based on the selected organization mode.
 * - 'category_site_year_month' → [category, siteName, year, month]
 * - 'category_year_month_site' → [category, year, month, siteName]
 */
export function computeOrganizationPath(
  document: Pick<DocumentSummary, 'category' | 'siteName' | 'createdAt'>,
  mode: OrganizationMode,
): string[] {
  const date = new Date(document.createdAt);
  const year = date.getUTCFullYear().toString();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  if (mode === 'category_site_year_month') {
    return [document.category, document.siteName, year, month];
  }

  // category_year_month_site
  return [document.category, year, month, document.siteName];
}

/**
 * Returns true if the total size of the documents is within the batch download limit (500 MB).
 */
export function validateBatchDownloadSize(
  documents: Pick<DocumentSummary, 'fileSize'>[],
): boolean {
  const totalSize = documents.reduce((sum, doc) => sum + doc.fileSize, 0);
  return totalSize <= MAX_BATCH_DOWNLOAD_BYTES;
}

/**
 * Computes download percentage and estimated time remaining.
 * Returns { percentage, estimatedRemainingMs }.
 */
export function calculateDownloadProgress(progress: DownloadProgress): {
  percentage: number;
  estimatedRemainingMs: number;
} {
  if (progress.totalBytes === 0) {
    return { percentage: 0, estimatedRemainingMs: 0 };
  }

  const percentage = (progress.bytesDownloaded / progress.totalBytes) * 100;

  const elapsedMs = Date.now() - progress.startedAt;

  if (progress.bytesDownloaded === 0 || elapsedMs <= 0) {
    return { percentage, estimatedRemainingMs: 0 };
  }

  const bytesPerMs = progress.bytesDownloaded / elapsedMs;
  const remainingBytes = progress.totalBytes - progress.bytesDownloaded;
  const estimatedRemainingMs = Math.max(0, remainingBytes / bytesPerMs);

  return { percentage, estimatedRemainingMs };
}

/**
 * Sorts folder contents alphabetically (case-insensitive) with folders listed before documents.
 */
export function sortFolderContents(
  folders: FolderNode[],
  documents: DocumentSummary[],
): { folders: FolderNode[]; documents: DocumentSummary[] } {
  const sortedFolders = [...folders].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );

  const sortedDocuments = [...documents].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );

  return { folders: sortedFolders, documents: sortedDocuments };
}

/**
 * Returns true if the document name contains the search term (case-insensitive partial match).
 */
export function matchesSearchTerm(
  documentName: string,
  searchTerm: string,
): boolean {
  return documentName.toLowerCase().includes(searchTerm.toLowerCase());
}

/**
 * Applies conjunctive (AND) filter logic to a list of documents.
 * Null filter values mean that criterion is not applied.
 */
export function applyFilters(
  documents: DocumentSummary[],
  filters: DocumentFilters,
): DocumentSummary[] {
  return documents.filter((doc) => {
    if (filters.category !== null && doc.category !== filters.category) {
      return false;
    }

    if (filters.dateFrom !== null && doc.createdAt < filters.dateFrom) {
      return false;
    }

    if (filters.dateTo !== null && doc.createdAt > filters.dateTo) {
      return false;
    }

    if (filters.siteId !== null && doc.siteId !== filters.siteId) {
      return false;
    }

    return true;
  });
}

export interface BreadcrumbSegment {
  label: string;
  path: string[];
}

/**
 * Generates an array of breadcrumb segments from a path array.
 * Includes a root segment at the beginning.
 */
export function formatBreadcrumbSegments(path: string[]): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [{ label: 'Documents', path: [] }];

  for (let i = 0; i < path.length; i++) {
    segments.push({
      label: path[i],
      path: path.slice(0, i + 1),
    });
  }

  return segments;
}
