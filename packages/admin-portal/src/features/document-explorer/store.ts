import { create } from 'zustand';
import type { DocumentFilters, DownloadProgress, OrganizationMode } from './types';

interface DocExplorerState {
  // Navigation
  currentPath: string[];
  navigateTo: (path: string[]) => void;
  navigateUp: () => void;

  // Selection
  selectedDocumentIds: Set<string>;
  toggleDocumentSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;

  // Preview
  previewDocumentId: string | null;
  openPreview: (id: string) => void;
  closePreview: () => void;

  // Search & Filters
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filters: DocumentFilters;
  setFilters: (filters: Partial<DocumentFilters>) => void;
  clearFilters: () => void;
  isSearchActive: boolean;

  // Download
  activeDownload: DownloadProgress | null;
  setDownloadProgress: (progress: DownloadProgress | null) => void;

  // Organization
  organizationMode: OrganizationMode;
  setOrganizationMode: (mode: OrganizationMode) => void;
}

const DEFAULT_FILTERS: DocumentFilters = {
  category: null,
  dateFrom: null,
  dateTo: null,
  siteId: null,
};

export const useDocExplorerStore = create<DocExplorerState>((set, get) => ({
  // Navigation
  currentPath: [],
  navigateTo: (path: string[]) => {
    set({ currentPath: path, selectedDocumentIds: new Set() });
  },
  navigateUp: () => {
    const { currentPath } = get();
    if (currentPath.length === 0) return;
    set({
      currentPath: currentPath.slice(0, -1),
      selectedDocumentIds: new Set(),
    });
  },

  // Selection
  selectedDocumentIds: new Set(),
  toggleDocumentSelection: (id: string) => {
    const { selectedDocumentIds } = get();
    const next = new Set(selectedDocumentIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    set({ selectedDocumentIds: next });
  },
  selectAll: (ids: string[]) => {
    set({ selectedDocumentIds: new Set(ids) });
  },
  clearSelection: () => {
    set({ selectedDocumentIds: new Set() });
  },

  // Preview
  previewDocumentId: null,
  openPreview: (id: string) => {
    set({ previewDocumentId: id });
  },
  closePreview: () => {
    set({ previewDocumentId: null });
  },

  // Search & Filters
  searchTerm: '',
  setSearchTerm: (term: string) => {
    const isSearchActive = term.trim().length >= 2;
    set({ searchTerm: term, isSearchActive });
  },
  filters: { ...DEFAULT_FILTERS },
  setFilters: (filters: Partial<DocumentFilters>) => {
    const current = get().filters;
    const updated = { ...current, ...filters };
    const hasActiveFilter = Object.values(updated).some((v) => v !== null);
    const isSearchActive = get().searchTerm.trim().length >= 2 || hasActiveFilter;
    set({ filters: updated, isSearchActive });
  },
  clearFilters: () => {
    const isSearchActive = get().searchTerm.trim().length >= 2;
    set({ filters: { ...DEFAULT_FILTERS }, isSearchActive });
  },
  isSearchActive: false,

  // Download
  activeDownload: null,
  setDownloadProgress: (progress: DownloadProgress | null) => {
    set({ activeDownload: progress });
  },

  // Organization
  organizationMode: 'category_site_year_month',
  setOrganizationMode: (mode: OrganizationMode) => {
    set({ organizationMode: mode });
  },
}));
