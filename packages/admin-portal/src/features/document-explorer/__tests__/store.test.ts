import { describe, it, expect, beforeEach } from 'vitest';
import { useDocExplorerStore } from '../store';

describe('useDocExplorerStore', () => {
  beforeEach(() => {
    // Reset store between tests
    useDocExplorerStore.setState({
      currentPath: [],
      selectedDocumentIds: new Set(),
      previewDocumentId: null,
      searchTerm: '',
      filters: { category: null, dateFrom: null, dateTo: null, siteId: null },
      isSearchActive: false,
      activeDownload: null,
      organizationMode: 'category_site_year_month',
    });
  });

  describe('Navigation', () => {
    it('initializes with empty path', () => {
      const { currentPath } = useDocExplorerStore.getState();
      expect(currentPath).toEqual([]);
    });

    it('navigateTo sets current path and clears selection', () => {
      useDocExplorerStore.getState().toggleDocumentSelection('doc-1');
      useDocExplorerStore.getState().navigateTo(['Reports', 'SiteA']);

      const state = useDocExplorerStore.getState();
      expect(state.currentPath).toEqual(['Reports', 'SiteA']);
      expect(state.selectedDocumentIds.size).toBe(0);
    });

    it('navigateUp removes last path segment', () => {
      useDocExplorerStore.getState().navigateTo(['Reports', 'SiteA', '2024']);
      useDocExplorerStore.getState().navigateUp();

      expect(useDocExplorerStore.getState().currentPath).toEqual(['Reports', 'SiteA']);
    });

    it('navigateUp does nothing at root', () => {
      useDocExplorerStore.getState().navigateUp();
      expect(useDocExplorerStore.getState().currentPath).toEqual([]);
    });
  });

  describe('Selection', () => {
    it('toggleDocumentSelection adds an id', () => {
      useDocExplorerStore.getState().toggleDocumentSelection('doc-1');
      expect(useDocExplorerStore.getState().selectedDocumentIds.has('doc-1')).toBe(true);
    });

    it('toggleDocumentSelection removes an already selected id', () => {
      useDocExplorerStore.getState().toggleDocumentSelection('doc-1');
      useDocExplorerStore.getState().toggleDocumentSelection('doc-1');
      expect(useDocExplorerStore.getState().selectedDocumentIds.has('doc-1')).toBe(false);
    });

    it('selectAll sets all provided ids', () => {
      useDocExplorerStore.getState().selectAll(['doc-1', 'doc-2', 'doc-3']);
      const ids = useDocExplorerStore.getState().selectedDocumentIds;
      expect(ids.size).toBe(3);
      expect(ids.has('doc-1')).toBe(true);
      expect(ids.has('doc-2')).toBe(true);
      expect(ids.has('doc-3')).toBe(true);
    });

    it('clearSelection empties selected ids', () => {
      useDocExplorerStore.getState().selectAll(['doc-1', 'doc-2']);
      useDocExplorerStore.getState().clearSelection();
      expect(useDocExplorerStore.getState().selectedDocumentIds.size).toBe(0);
    });
  });

  describe('Preview', () => {
    it('openPreview sets previewDocumentId', () => {
      useDocExplorerStore.getState().openPreview('doc-5');
      expect(useDocExplorerStore.getState().previewDocumentId).toBe('doc-5');
    });

    it('closePreview clears previewDocumentId', () => {
      useDocExplorerStore.getState().openPreview('doc-5');
      useDocExplorerStore.getState().closePreview();
      expect(useDocExplorerStore.getState().previewDocumentId).toBeNull();
    });
  });

  describe('Search & Filters', () => {
    it('setSearchTerm updates searchTerm and isSearchActive', () => {
      useDocExplorerStore.getState().setSearchTerm('re');
      const state = useDocExplorerStore.getState();
      expect(state.searchTerm).toBe('re');
      expect(state.isSearchActive).toBe(true);
    });

    it('setSearchTerm with less than 2 chars does not activate search', () => {
      useDocExplorerStore.getState().setSearchTerm('r');
      expect(useDocExplorerStore.getState().isSearchActive).toBe(false);
    });

    it('setSearchTerm with whitespace-only does not activate search', () => {
      useDocExplorerStore.getState().setSearchTerm('  ');
      expect(useDocExplorerStore.getState().isSearchActive).toBe(false);
    });

    it('setFilters merges partial filters', () => {
      useDocExplorerStore.getState().setFilters({ category: 'reports' });
      const state = useDocExplorerStore.getState();
      expect(state.filters.category).toBe('reports');
      expect(state.filters.dateFrom).toBeNull();
    });

    it('setFilters activates search when a filter is set', () => {
      useDocExplorerStore.getState().setFilters({ siteId: 'site-1' });
      expect(useDocExplorerStore.getState().isSearchActive).toBe(true);
    });

    it('clearFilters resets all filters to null', () => {
      useDocExplorerStore.getState().setFilters({ category: 'reports', siteId: 'site-1' });
      useDocExplorerStore.getState().clearFilters();
      const state = useDocExplorerStore.getState();
      expect(state.filters).toEqual({
        category: null,
        dateFrom: null,
        dateTo: null,
        siteId: null,
      });
    });

    it('clearFilters deactivates search when searchTerm is short', () => {
      useDocExplorerStore.getState().setFilters({ category: 'reports' });
      useDocExplorerStore.getState().clearFilters();
      expect(useDocExplorerStore.getState().isSearchActive).toBe(false);
    });

    it('clearFilters keeps search active when searchTerm is valid', () => {
      useDocExplorerStore.getState().setSearchTerm('test');
      useDocExplorerStore.getState().setFilters({ category: 'reports' });
      useDocExplorerStore.getState().clearFilters();
      expect(useDocExplorerStore.getState().isSearchActive).toBe(true);
    });
  });

  describe('Download Progress', () => {
    it('setDownloadProgress sets active download', () => {
      const progress = {
        downloadId: 'dl-1',
        status: 'downloading' as const,
        bytesDownloaded: 1024,
        totalBytes: 4096,
        startedAt: Date.now(),
        estimatedRemainingMs: 3000,
      };
      useDocExplorerStore.getState().setDownloadProgress(progress);
      expect(useDocExplorerStore.getState().activeDownload).toEqual(progress);
    });

    it('setDownloadProgress with null clears active download', () => {
      useDocExplorerStore.getState().setDownloadProgress({
        downloadId: 'dl-1',
        status: 'downloading',
        bytesDownloaded: 1024,
        totalBytes: 4096,
        startedAt: Date.now(),
        estimatedRemainingMs: 3000,
      });
      useDocExplorerStore.getState().setDownloadProgress(null);
      expect(useDocExplorerStore.getState().activeDownload).toBeNull();
    });
  });

  describe('Organization Mode', () => {
    it('initializes with category_site_year_month', () => {
      expect(useDocExplorerStore.getState().organizationMode).toBe('category_site_year_month');
    });

    it('setOrganizationMode changes the mode', () => {
      useDocExplorerStore.getState().setOrganizationMode('category_year_month_site');
      expect(useDocExplorerStore.getState().organizationMode).toBe('category_year_month_site');
    });
  });
});
