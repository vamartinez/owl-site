// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FolderOrganizationSelector } from '../FolderOrganizationSelector';

const mockUpdateMode = vi.fn();

let mockMode: string | undefined = 'category_site_year_month';
let mockIsLoading = false;
let mockIsUpdating = false;

vi.mock('../hooks/useOrganizationMode', () => ({
  useOrganizationMode: () => ({
    mode: mockMode,
    isLoading: mockIsLoading,
    isUpdating: mockIsUpdating,
    updateMode: mockUpdateMode,
    error: null,
    updateError: null,
  }),
}));

describe('FolderOrganizationSelector', () => {
  beforeEach(() => {
    mockMode = 'category_site_year_month';
    mockIsLoading = false;
    mockIsUpdating = false;
    mockUpdateMode.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the label and select with correct options', () => {
    render(<FolderOrganizationSelector />);

    expect(screen.getByText('Organize by:')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Category / Site / Year / Month')).toBeInTheDocument();
    expect(screen.getByText('Category / Year / Month / Site')).toBeInTheDocument();
  });

  it('shows the current mode as selected value', () => {
    mockMode = 'category_year_month_site';
    render(<FolderOrganizationSelector />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('category_year_month_site');
  });

  it('calls updateMode when selection changes', () => {
    render(<FolderOrganizationSelector />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'category_year_month_site' } });

    expect(mockUpdateMode).toHaveBeenCalledWith('category_year_month_site');
  });

  it('disables the select while loading', () => {
    mockIsLoading = true;
    render(<FolderOrganizationSelector />);

    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('disables the select while updating', () => {
    mockIsUpdating = true;
    render(<FolderOrganizationSelector />);

    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('defaults to category_site_year_month when mode is undefined', () => {
    mockMode = undefined;
    render(<FolderOrganizationSelector />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('category_site_year_month');
  });
});
