// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { CategoryFilter } from '../CategoryFilter';
import type { DocumentCategory } from '../types';

afterEach(() => {
  cleanup();
});

describe('CategoryFilter', () => {
  describe('Rendering', () => {
    it('renders all 6 category checkboxes', () => {
      render(
        createElement(CategoryFilter, {
          selectedCategories: [],
          onChange: vi.fn(),
        })
      );

      expect(screen.getByText('Investigación')).toBeInTheDocument();
      expect(screen.getByText('Acción Correctiva')).toBeInTheDocument();
      expect(screen.getByText('Inspección')).toBeInTheDocument();
      expect(screen.getByText('Declaración de Testigo')).toBeInTheDocument();
      expect(screen.getByText('Reporte de Seguimiento')).toBeInTheDocument();
      expect(screen.getByText('Otro')).toBeInTheDocument();
    });

    it('renders the section label "Categorías"', () => {
      render(
        createElement(CategoryFilter, {
          selectedCategories: [],
          onChange: vi.fn(),
        })
      );

      expect(screen.getByText('Categorías')).toBeInTheDocument();
    });

    it('checks the checkboxes for selected categories', () => {
      render(
        createElement(CategoryFilter, {
          selectedCategories: ['investigacion', 'inspeccion'],
          onChange: vi.fn(),
        })
      );

      const checkboxes = screen.getAllByRole('checkbox');
      // investigacion is index 0, inspeccion is index 2
      expect(checkboxes[0]).toBeChecked();
      expect(checkboxes[1]).not.toBeChecked();
      expect(checkboxes[2]).toBeChecked();
    });

    it('does not show "Limpiar filtros" button when no filters active', () => {
      render(
        createElement(CategoryFilter, {
          selectedCategories: [],
          onChange: vi.fn(),
        })
      );

      expect(screen.queryByText('Limpiar filtros')).not.toBeInTheDocument();
    });

    it('shows "Limpiar filtros" button when filters are active', () => {
      render(
        createElement(CategoryFilter, {
          selectedCategories: ['investigacion'],
          onChange: vi.fn(),
        })
      );

      expect(screen.getByText('Limpiar filtros')).toBeInTheDocument();
    });
  });

  describe('Result count badge', () => {
    it('shows result count badge when filters are active and resultCount is provided', () => {
      render(
        createElement(CategoryFilter, {
          selectedCategories: ['investigacion'],
          onChange: vi.fn(),
          resultCount: 5,
        })
      );

      expect(screen.getByText('5 resultados')).toBeInTheDocument();
    });

    it('does not show result count badge when no filters are active', () => {
      render(
        createElement(CategoryFilter, {
          selectedCategories: [],
          onChange: vi.fn(),
          resultCount: 10,
        })
      );

      expect(screen.queryByText('10 resultados')).not.toBeInTheDocument();
    });

    it('does not show result count badge when resultCount is not provided', () => {
      render(
        createElement(CategoryFilter, {
          selectedCategories: ['investigacion'],
          onChange: vi.fn(),
        })
      );

      // No badge with "resultados" should appear
      expect(screen.queryByText(/resultados/)).not.toBeInTheDocument();
    });
  });

  describe('Interaction', () => {
    it('adds a category when unchecked checkbox is clicked', () => {
      const onChange = vi.fn();
      render(
        createElement(CategoryFilter, {
          selectedCategories: ['investigacion'],
          onChange,
        })
      );

      const checkboxes = screen.getAllByRole('checkbox');
      // Click the "Acción Correctiva" checkbox (index 1)
      fireEvent.click(checkboxes[1]!);

      expect(onChange).toHaveBeenCalledWith(['investigacion', 'accion_correctiva']);
    });

    it('removes a category when checked checkbox is clicked', () => {
      const onChange = vi.fn();
      render(
        createElement(CategoryFilter, {
          selectedCategories: ['investigacion', 'inspeccion'],
          onChange,
        })
      );

      const checkboxes = screen.getAllByRole('checkbox');
      // Click the "Investigación" checkbox (index 0) to uncheck it
      fireEvent.click(checkboxes[0]!);

      expect(onChange).toHaveBeenCalledWith(['inspeccion']);
    });

    it('calls onChange with empty array when "Limpiar filtros" is clicked', () => {
      const onChange = vi.fn();
      render(
        createElement(CategoryFilter, {
          selectedCategories: ['investigacion', 'accion_correctiva'],
          onChange,
        })
      );

      fireEvent.click(screen.getByText('Limpiar filtros'));

      expect(onChange).toHaveBeenCalledWith([]);
    });
  });
});
