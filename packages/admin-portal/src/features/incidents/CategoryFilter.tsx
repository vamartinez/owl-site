import { X } from 'lucide-react';
import {
  DocumentCategory,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_CATEGORY_COLORS,
} from './types';
import { Badge } from '../../components/ui/Badge';

const ALL_CATEGORIES: DocumentCategory[] = [
  'investigacion',
  'accion_correctiva',
  'inspeccion',
  'declaracion_testigo',
  'reporte_seguimiento',
  'otro',
];

interface CategoryFilterProps {
  selectedCategories: DocumentCategory[];
  onChange: (categories: DocumentCategory[]) => void;
  resultCount?: number;
}

export function CategoryFilter({
  selectedCategories,
  onChange,
  resultCount,
}: CategoryFilterProps) {
  const hasActiveFilters = selectedCategories.length > 0;

  const handleToggle = (category: DocumentCategory) => {
    if (selectedCategories.includes(category)) {
      onChange(selectedCategories.filter((c) => c !== category));
    } else {
      onChange([...selectedCategories, category]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Categorías</span>
        {hasActiveFilters && resultCount !== undefined && (
          <Badge variant="info">{resultCount} resultados</Badge>
        )}
      </div>

      <div className="space-y-1">
        {ALL_CATEGORIES.map((category) => (
          <label
            key={category}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedCategories.includes(category)}
              onChange={() => handleToggle(category)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span
              className={`w-2 h-2 rounded-full`}
              style={getCategoryDotStyle(DOCUMENT_CATEGORY_COLORS[category])}
              aria-hidden="true"
            />
            <span className="text-sm text-gray-700">
              {DOCUMENT_CATEGORY_LABELS[category]}
            </span>
          </label>
        ))}
      </div>

      {hasActiveFilters && (
        <button
          onClick={() => onChange([])}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mt-1"
        >
          <X size={12} />
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

/**
 * Maps color token names to Tailwind-compatible dot colors.
 */
function getCategoryDotStyle(colorToken: string): React.CSSProperties {
  const colorMap: Record<string, string> = {
    purple: '#9333ea',
    danger: '#dc2626',
    info: '#2563eb',
    warning: '#d97706',
    success: '#16a34a',
    default: '#6b7280',
  };

  return { backgroundColor: colorMap[colorToken] || colorMap.default };
}
