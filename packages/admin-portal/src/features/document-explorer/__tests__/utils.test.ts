import { describe, expect, it } from 'vitest';

import type {
  DocumentFilters,
  DocumentSummary,
  DownloadProgress,
  FolderNode,
} from '../types';
import {
  applyFilters,
  calculateDownloadProgress,
  canAccessDocumentExplorer,
  computeOrganizationPath,
  formatBreadcrumbSegments,
  isPreviewable,
  isSearchTermValid,
  matchesSearchTerm,
  sortFolderContents,
  validateBatchDownloadSize,
} from '../utils';

describe('isPreviewable', () => {
  it('returns true for application/pdf', () => {
    expect(isPreviewable('application/pdf')).toBe(true);
  });

  it('returns true for image/jpeg', () => {
    expect(isPreviewable('image/jpeg')).toBe(true);
  });

  it('returns true for image/png', () => {
    expect(isPreviewable('image/png')).toBe(true);
  });

  it('returns false for other mime types', () => {
    expect(isPreviewable('application/zip')).toBe(false);
    expect(isPreviewable('text/plain')).toBe(false);
    expect(isPreviewable('image/gif')).toBe(false);
    expect(isPreviewable('application/msword')).toBe(false);
  });
});

describe('isSearchTermValid', () => {
  it('returns true when trimmed length is >= 2', () => {
    expect(isSearchTermValid('ab')).toBe(true);
    expect(isSearchTermValid('abc')).toBe(true);
    expect(isSearchTermValid('  ab  ')).toBe(true);
  });

  it('returns false when trimmed length is < 2', () => {
    expect(isSearchTermValid('')).toBe(false);
    expect(isSearchTermValid('a')).toBe(false);
    expect(isSearchTermValid('   ')).toBe(false);
    expect(isSearchTermValid(' a ')).toBe(false);
  });
});

describe('canAccessDocumentExplorer', () => {
  it('returns true for allowed roles', () => {
    expect(canAccessDocumentExplorer('platform_admin')).toBe(true);
    expect(canAccessDocumentExplorer('tenant_admin')).toBe(true);
    expect(canAccessDocumentExplorer('site_admin')).toBe(true);
    expect(canAccessDocumentExplorer('supervisor')).toBe(true);
    expect(canAccessDocumentExplorer('cso')).toBe(true);
  });

  it('returns false for non-allowed roles', () => {
    expect(canAccessDocumentExplorer('gate_operator')).toBe(false);
    expect(canAccessDocumentExplorer('worker')).toBe(false);
    expect(canAccessDocumentExplorer('admin')).toBe(false);
    expect(canAccessDocumentExplorer('')).toBe(false);
  });
});

describe('computeOrganizationPath', () => {
  const document = {
    category: 'reports' as const,
    siteName: 'Site Alpha',
    createdAt: '2024-03-15T10:30:00Z',
  };

  it('generates [category, siteName, year, month] for category_site_year_month', () => {
    const result = computeOrganizationPath(document, 'category_site_year_month');
    expect(result).toEqual(['reports', 'Site Alpha', '2024', '03']);
  });

  it('generates [category, year, month, siteName] for category_year_month_site', () => {
    const result = computeOrganizationPath(document, 'category_year_month_site');
    expect(result).toEqual(['reports', '2024', '03', 'Site Alpha']);
  });

  it('pads single-digit months with leading zero', () => {
    const janDoc = { ...document, createdAt: '2024-01-05T10:30:00Z' };
    const result = computeOrganizationPath(janDoc, 'category_site_year_month');
    expect(result).toEqual(['reports', 'Site Alpha', '2024', '01']);
  });
});

describe('validateBatchDownloadSize', () => {
  it('returns true when total size is within 500MB', () => {
    const docs = [{ fileSize: 100 * 1024 * 1024 }, { fileSize: 200 * 1024 * 1024 }];
    expect(validateBatchDownloadSize(docs)).toBe(true);
  });

  it('returns true when total size is exactly 500MB', () => {
    const docs = [{ fileSize: 500 * 1024 * 1024 }];
    expect(validateBatchDownloadSize(docs)).toBe(true);
  });

  it('returns false when total size exceeds 500MB', () => {
    const docs = [{ fileSize: 500 * 1024 * 1024 + 1 }];
    expect(validateBatchDownloadSize(docs)).toBe(false);
  });

  it('returns true for empty array', () => {
    expect(validateBatchDownloadSize([])).toBe(true);
  });
});

describe('calculateDownloadProgress', () => {
  it('computes percentage correctly', () => {
    const progress: DownloadProgress = {
      downloadId: 'dl-1',
      status: 'downloading',
      bytesDownloaded: 50,
      totalBytes: 100,
      startedAt: Date.now() - 5000,
      estimatedRemainingMs: null,
    };
    const result = calculateDownloadProgress(progress);
    expect(result.percentage).toBe(50);
  });

  it('returns 0 percentage when totalBytes is 0', () => {
    const progress: DownloadProgress = {
      downloadId: 'dl-1',
      status: 'downloading',
      bytesDownloaded: 0,
      totalBytes: 0,
      startedAt: Date.now() - 1000,
      estimatedRemainingMs: null,
    };
    const result = calculateDownloadProgress(progress);
    expect(result.percentage).toBe(0);
    expect(result.estimatedRemainingMs).toBe(0);
  });

  it('returns non-negative ETA', () => {
    const progress: DownloadProgress = {
      downloadId: 'dl-1',
      status: 'downloading',
      bytesDownloaded: 75,
      totalBytes: 100,
      startedAt: Date.now() - 3000,
      estimatedRemainingMs: null,
    };
    const result = calculateDownloadProgress(progress);
    expect(result.estimatedRemainingMs).toBeGreaterThanOrEqual(0);
  });
});

describe('sortFolderContents', () => {
  it('sorts folders alphabetically', () => {
    const folders = [
      { name: 'Charlie' },
      { name: 'Alpha' },
      { name: 'Bravo' },
    ] as FolderNode[];

    const result = sortFolderContents(folders, []);
    expect(result.folders.map((f) => f.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts documents alphabetically', () => {
    const documents = [
      { name: 'Zebra.pdf' },
      { name: 'apple.pdf' },
      { name: 'Banana.pdf' },
    ] as DocumentSummary[];

    const result = sortFolderContents([], documents);
    expect(result.documents.map((d) => d.name)).toEqual([
      'apple.pdf',
      'Banana.pdf',
      'Zebra.pdf',
    ]);
  });

  it('sorts case-insensitively', () => {
    const folders = [
      { name: 'beta' },
      { name: 'Alpha' },
    ] as FolderNode[];

    const result = sortFolderContents(folders, []);
    expect(result.folders.map((f) => f.name)).toEqual(['Alpha', 'beta']);
  });
});

describe('matchesSearchTerm', () => {
  it('matches case-insensitive substring', () => {
    expect(matchesSearchTerm('Safety Report 2024.pdf', 'safety')).toBe(true);
    expect(matchesSearchTerm('Safety Report 2024.pdf', 'REPORT')).toBe(true);
    expect(matchesSearchTerm('Safety Report 2024.pdf', '2024')).toBe(true);
  });

  it('returns false when term is not a substring', () => {
    expect(matchesSearchTerm('Safety Report 2024.pdf', 'incident')).toBe(false);
    expect(matchesSearchTerm('Safety Report 2024.pdf', '2025')).toBe(false);
  });
});

describe('applyFilters', () => {
  const baseDoc: DocumentSummary = {
    id: '1',
    name: 'Report.pdf',
    category: 'reports',
    mimeType: 'application/pdf',
    fileSize: 1024,
    createdAt: '2024-03-15T10:00:00Z',
    siteName: 'Site A',
    siteId: 'site-a',
    folderPath: ['reports'],
  };

  const documents: DocumentSummary[] = [
    baseDoc,
    { ...baseDoc, id: '2', category: 'forms', siteId: 'site-b', createdAt: '2024-01-10T10:00:00Z' },
    { ...baseDoc, id: '3', category: 'reports', siteId: 'site-a', createdAt: '2024-06-20T10:00:00Z' },
  ];

  it('returns all documents when all filters are null', () => {
    const filters: DocumentFilters = {
      category: null,
      dateFrom: null,
      dateTo: null,
      siteId: null,
    };
    expect(applyFilters(documents, filters)).toHaveLength(3);
  });

  it('filters by category', () => {
    const filters: DocumentFilters = {
      category: 'reports',
      dateFrom: null,
      dateTo: null,
      siteId: null,
    };
    const result = applyFilters(documents, filters);
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.category === 'reports')).toBe(true);
  });

  it('filters by siteId', () => {
    const filters: DocumentFilters = {
      category: null,
      dateFrom: null,
      dateTo: null,
      siteId: 'site-a',
    };
    const result = applyFilters(documents, filters);
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.siteId === 'site-a')).toBe(true);
  });

  it('applies conjunctive (AND) logic for multiple filters', () => {
    const filters: DocumentFilters = {
      category: 'reports',
      dateFrom: null,
      dateTo: null,
      siteId: 'site-a',
    };
    const result = applyFilters(documents, filters);
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.category === 'reports' && d.siteId === 'site-a')).toBe(true);
  });

  it('filters by date range', () => {
    const filters: DocumentFilters = {
      category: null,
      dateFrom: '2024-02-01',
      dateTo: '2024-04-01',
      siteId: null,
    };
    const result = applyFilters(documents, filters);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });
});

describe('formatBreadcrumbSegments', () => {
  it('returns root segment for empty path', () => {
    const result = formatBreadcrumbSegments([]);
    expect(result).toEqual([{ label: 'Documents', path: [] }]);
  });

  it('generates segments including root', () => {
    const result = formatBreadcrumbSegments(['Reports', 'Site A', '2024']);
    expect(result).toEqual([
      { label: 'Documents', path: [] },
      { label: 'Reports', path: ['Reports'] },
      { label: 'Site A', path: ['Reports', 'Site A'] },
      { label: '2024', path: ['Reports', 'Site A', '2024'] },
    ]);
  });

  it('produces array of length path.length + 1', () => {
    const path = ['A', 'B', 'C', 'D'];
    const result = formatBreadcrumbSegments(path);
    expect(result).toHaveLength(path.length + 1);
  });
});
