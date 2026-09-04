import { X } from 'lucide-react';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  key: string;
  label: string;
  options: FilterOption[];
}

interface FiltersProps {
  filters: FilterConfig[];
  activeFilters: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
}

export function Filters({ filters, activeFilters, onChange, onClear }: FiltersProps) {
  const hasActiveFilters = Object.values(activeFilters).some((v) => v !== '');

  return (
    <div className="flex flex-wrap items-center gap-3">
      {filters.map((filter) => (
        <select
          key={filter.key}
          value={activeFilters[filter.key] || ''}
          onChange={(e) => onChange(filter.key, e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5
            focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
          aria-label={filter.label}
        >
          <option value="">{filter.label}</option>
          {filter.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ))}

      {hasActiveFilters && (
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <X size={12} />
          Clear filters
        </button>
      )}
    </div>
  );
}
