// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EmptyState } from '../EmptyState';

afterEach(() => {
  cleanup();
});

describe('EmptyState', () => {
  describe('empty-folder variant', () => {
    it('displays the empty folder message', () => {
      render(<EmptyState variant="empty-folder" />);

      expect(
        screen.getByText('No documents are available in this location'),
      ).toBeInTheDocument();
    });

    it('has a status role for accessibility', () => {
      render(<EmptyState variant="empty-folder" />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('does not render the clear filters button', () => {
      render(<EmptyState variant="empty-folder" onClearFilters={() => {}} />);

      expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
    });
  });

  describe('no-results variant', () => {
    it('displays the no results message', () => {
      render(<EmptyState variant="no-results" />);

      expect(
        screen.getByText('No documents match the current criteria'),
      ).toBeInTheDocument();
    });

    it('renders the clear filters button when onClearFilters is provided', () => {
      render(<EmptyState variant="no-results" onClearFilters={() => {}} />);

      expect(
        screen.getByRole('button', { name: /clear filters/i }),
      ).toBeInTheDocument();
    });

    it('does not render the clear filters button when onClearFilters is not provided', () => {
      render(<EmptyState variant="no-results" />);

      expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
    });

    it('calls onClearFilters when the button is clicked', () => {
      const handleClearFilters = vi.fn();

      render(<EmptyState variant="no-results" onClearFilters={handleClearFilters} />);

      fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));

      expect(handleClearFilters).toHaveBeenCalledTimes(1);
    });
  });
});
