import { useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { SearchBar } from '@/components/data/SearchBar';
import { Filters, type FilterConfig } from '@/components/data/Filters';
import { useDocExplorerStore } from './store';
import type { DocumentCategory } from './types';

// ─── Category Filter Options ─────────────────────────────────────────────────

const CATEGORY_OPTIONS: { value: DocumentCategory; label: string }[] = [
  { value: 'reports', label: 'Reports' },
  { value: 'forms', label: 'Forms' },
  { value: 'certifications', label: 'Certifications' },
  { value: 'incidents', label: 'Incidents' },
  { value: 'safety_evidence', label: 'Safety Evidence' },
];

// ─── Filter Configurations ───────────────────────────────────────────────────

const FILTER_CONFIGS: FilterConfig[] = [
  {
    key: 'category',
    label: 'Category',
    options: CATEGORY_OPTIONS,
  },
  {
    key: 'siteId',
    label: 'Site',
    options: [], // Populated dynamically via props
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface SearchFiltersProps {
  /** Available site options for the site filter dropdown */
  siteOptions?: { value: string; label: string }[];
}

/**
 * SearchFilters composes the shared SearchBar and Filters components
 * to provide search and filtering for the Document Explorer.
 *
 * - Wires search input to the store's setSearchTerm
 * - Wires filter dropdowns (category, date range, site) to the store's setFilters
 * - Includes a clear-all button when any filter or search is active
 * - The 2-character minimum for search triggering is enforced by the store/hook
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7
 */
export function SearchFilters({ siteOptions = [] }: SearchFiltersProps) {
  const searchTerm = useDocExplorerStore((s) => s.searchTerm);
  const setSearchTerm = useDocExplorerStore((s) => s.setSearchTerm);
  const filters = useDocExplorerStore((s) => s.filters);
  const setFilters = useDocExplorerStore((s) => s.setFilters);
  const clearFilters = useDocExplorerStore((s) => s.clearFilters);
  const isSearchActive = useDocExplorerStore((s) => s.isSearchActive);

  // Build filter configs with dynamic site options
  const filterConfigs = useMemo<FilterConfig[]>(() => {
    return [
      {
        key: 'category',
        label: 'Category',
        options: CATEGORY_OPTIONS,
      },
      {
        key: 'siteId',
        label: 'Site',
        options: siteOptions,
      },
    ];
  }, [siteOptions]);

  // Map store filters to the flat Record<string, string> the Filters component expects
  const activeFilters = useMemo<Record<string, string>>(() => {
    return {
      category: filters.category ?? '',
      siteId: filters.siteId ?? '',
    };
  }, [filters.category, filters.siteId]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchTerm(value);
    },
    [setSearchTerm],
  );

  const handleFilterChange = useCallback(
    (key: string, value: string) => {
      if (key === 'category') {
        setFilters({ category: (value || null) as DocumentCategory | null });
      } else if (key === 'siteId') {
        setFilters({ siteId: value || null });
      }
    },
    [setFilters],
  );

  const handleFilterClear = useCallback(() => {
    clearFilters();
  }, [clearFilters]);

  const handleClearAll = useCallback(() => {
    setSearchTerm('');
    clearFilters();
    setFilters({ dateFrom: null, dateTo: null });
  }, [setSearchTerm, clearFilters, setFilters]);

  const handleDateFromChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilters({ dateFrom: e.target.value || null });
    },
    [setFilters],
  );

  const handleDateToChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilters({ dateTo: e.target.value || null });
    },
    [setFilters],
  );

  const hasAnyActive =
    isSearchActive ||
    searchTerm.length > 0 ||
    filters.category !== null ||
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.siteId !== null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center" data-testid="search-filters">
      {/* Search input */}
      <div className="w-full sm:w-64">
        <SearchBar
          value={searchTerm}
          onChange={handleSearchChange}
          placeholder="Search documents..."
          debounceMs={500}
        />
        {searchTerm.length > 0 && searchTerm.trim().length < 2 && (
          <p className="mt-1 text-xs text-gray-400">
            Type at least 2 characters to search
          </p>
        )}
      </div>

      {/* Dropdown filters (category, site) */}
      <Filters
        filters={filterConfigs}
        activeFilters={activeFilters}
        onChange={handleFilterChange}
        onClear={handleFilterClear}
      />

      {/* Date range inputs */}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={handleDateFromChange}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5
            focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
          aria-label="Date from"
        />
        <span className="text-sm text-gray-400">to</span>
        <input
          type="date"
          value={filters.dateTo ?? ''}
          onChange={handleDateToChange}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5
            focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
          aria-label="Date to"
        />
      </div>

      {/* Clear all button */}
      {hasAnyActive && (
        <button
          onClick={handleClearAll}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 whitespace-nowrap"
          aria-label="Clear all filters"
        >
          <X size={12} />
          Clear all
        </button>
      )}
    </div>
  );
}
