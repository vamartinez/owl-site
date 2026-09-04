// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { SearchFilters } from '../SearchFilters';
import { useDocExplorerStore } from '../store';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useDocExplorerStore.setState({
    searchTerm: '',
    filters: { category: null, dateFrom: null, dateTo: null, siteId: null },
    isSearchActive: false,
  });
});

describe('SearchFilters', () => {
  it('renders the search input', () => {
    render(<SearchFilters />);
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });

  it('renders category filter dropdown', () => {
    render(<SearchFilters />);
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
  });

  it('renders site filter dropdown', () => {
    render(<SearchFilters siteOptions={[{ value: 'site-1', label: 'Site A' }]} />);
    expect(screen.getByLabelText('Site')).toBeInTheDocument();
  });

  it('renders date range inputs', () => {
    render(<SearchFilters />);
    expect(screen.getByLabelText('Date from')).toBeInTheDocument();
    expect(screen.getByLabelText('Date to')).toBeInTheDocument();
  });

  it('does not show clear all button when nothing is active', () => {
    render(<SearchFilters />);
    expect(screen.queryByLabelText('Clear all filters')).not.toBeInTheDocument();
  });

  it('shows clear all button when a filter is active', () => {
    useDocExplorerStore.setState({
      filters: { category: 'reports', dateFrom: null, dateTo: null, siteId: null },
      isSearchActive: true,
    });

    render(<SearchFilters />);
    expect(screen.getByLabelText('Clear all filters')).toBeInTheDocument();
  });

  it('shows clear all button when search term is entered', () => {
    useDocExplorerStore.setState({
      searchTerm: 'test',
      isSearchActive: true,
    });

    render(<SearchFilters />);
    expect(screen.getByLabelText('Clear all filters')).toBeInTheDocument();
  });

  it('updates category filter in store when changed', () => {
    render(<SearchFilters />);

    const categorySelect = screen.getByLabelText('Category');
    fireEvent.change(categorySelect, { target: { value: 'reports' } });

    const state = useDocExplorerStore.getState();
    expect(state.filters.category).toBe('reports');
  });

  it('updates site filter in store when changed', () => {
    render(<SearchFilters siteOptions={[{ value: 'site-1', label: 'Site A' }]} />);

    const siteSelect = screen.getByLabelText('Site');
    fireEvent.change(siteSelect, { target: { value: 'site-1' } });

    const state = useDocExplorerStore.getState();
    expect(state.filters.siteId).toBe('site-1');
  });

  it('updates dateFrom filter in store when changed', () => {
    render(<SearchFilters />);

    const dateFromInput = screen.getByLabelText('Date from');
    fireEvent.change(dateFromInput, { target: { value: '2024-01-01' } });

    const state = useDocExplorerStore.getState();
    expect(state.filters.dateFrom).toBe('2024-01-01');
  });

  it('updates dateTo filter in store when changed', () => {
    render(<SearchFilters />);

    const dateToInput = screen.getByLabelText('Date to');
    fireEvent.change(dateToInput, { target: { value: '2024-12-31' } });

    const state = useDocExplorerStore.getState();
    expect(state.filters.dateTo).toBe('2024-12-31');
  });

  it('clears all filters and search term when clear all is clicked', () => {
    useDocExplorerStore.setState({
      searchTerm: 'test',
      filters: { category: 'reports', dateFrom: '2024-01-01', dateTo: null, siteId: 'site-1' },
      isSearchActive: true,
    });

    render(<SearchFilters />);

    fireEvent.click(screen.getByLabelText('Clear all filters'));

    const state = useDocExplorerStore.getState();
    expect(state.searchTerm).toBe('');
    expect(state.filters.category).toBeNull();
    expect(state.filters.dateFrom).toBeNull();
    expect(state.filters.dateTo).toBeNull();
    expect(state.filters.siteId).toBeNull();
  });

  it('shows minimum character hint when search term is 1 character', () => {
    useDocExplorerStore.setState({ searchTerm: 'r' });

    render(<SearchFilters />);
    expect(screen.getByText('Type at least 2 characters to search')).toBeInTheDocument();
  });

  it('does not show minimum character hint when search term is empty', () => {
    render(<SearchFilters />);
    expect(screen.queryByText('Type at least 2 characters to search')).not.toBeInTheDocument();
  });

  it('does not show minimum character hint when search term is 2+ characters', () => {
    useDocExplorerStore.setState({ searchTerm: 'te', isSearchActive: true });

    render(<SearchFilters />);
    expect(screen.queryByText('Type at least 2 characters to search')).not.toBeInTheDocument();
  });

  it('displays all category options in dropdown', () => {
    render(<SearchFilters />);
    const categorySelect = screen.getByLabelText('Category');
    expect(categorySelect).toContainHTML('Reports');
    expect(categorySelect).toContainHTML('Forms');
    expect(categorySelect).toContainHTML('Certifications');
    expect(categorySelect).toContainHTML('Incidents');
    expect(categorySelect).toContainHTML('Safety Evidence');
  });
});
