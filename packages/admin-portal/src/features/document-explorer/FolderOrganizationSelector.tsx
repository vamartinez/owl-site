import { type ChangeEvent } from 'react';
import { Select } from '@/components/ui/Select';
import { useOrganizationMode } from './hooks/useOrganizationMode';
import type { OrganizationMode } from './types';

const ORGANIZATION_OPTIONS = [
  { value: 'category_site_year_month', label: 'Category / Site / Year / Month' },
  { value: 'category_year_month_site', label: 'Category / Year / Month / Site' },
];

/**
 * Dropdown that allows switching between folder organization modes.
 * Persists the preference via the useOrganizationMode hook on change.
 */
export function FolderOrganizationSelector() {
  const { mode, isLoading, isUpdating, updateMode } = useOrganizationMode();

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const selectedMode = e.target.value as OrganizationMode;
    updateMode(selectedMode);
  };

  return (
    <Select
      label="Organize by:"
      options={ORGANIZATION_OPTIONS}
      value={mode ?? 'category_site_year_month'}
      onChange={handleChange}
      disabled={isLoading || isUpdating}
      aria-label="Folder organization mode"
    />
  );
}
