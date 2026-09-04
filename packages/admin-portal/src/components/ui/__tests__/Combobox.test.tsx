// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { Combobox, type ComboboxOption } from '../Combobox';

const mockOptions: ComboboxOption[] = [
  { value: 'site-1', label: 'Main Office', description: '123 Main St' },
  { value: 'site-2', label: 'Warehouse', description: '456 Industrial Ave' },
  { value: 'site-3', label: 'Remote Site' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Combobox', () => {
  describe('Rendering', () => {
    it('renders with label and placeholder', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
          label: 'Select Site',
          placeholder: 'Search sites...',
        })
      );

      expect(screen.getByText('Select Site')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Search sites...')).toBeInTheDocument();
    });

    it('renders error message when error prop is set', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
          error: 'Site is required',
        })
      );

      expect(screen.getByText('Site is required')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('shows selected option label in input when value is set', () => {
      render(
        createElement(Combobox, {
          value: 'site-1',
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox') as HTMLInputElement;
      expect(input.value).toBe('Main Office');
    });

    it('renders disabled state', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
          disabled: true,
        })
      );

      const input = screen.getByRole('combobox');
      expect(input).toBeDisabled();
    });
  });

  describe('ARIA attributes', () => {
    it('has role="combobox" on the input', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('sets aria-expanded=false when closed', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('aria-expanded', 'false');
    });

    it('sets aria-expanded=true when open', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      expect(input).toHaveAttribute('aria-expanded', 'true');
    });

    it('sets aria-controls pointing to the listbox', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      const listbox = screen.getByRole('listbox');
      const controlsId = input.getAttribute('aria-controls');
      expect(controlsId).toBe(listbox.id);
    });

    it('sets aria-activedescendant when an option is highlighted', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });

      const activedescendant = input.getAttribute('aria-activedescendant');
      expect(activedescendant).toBeTruthy();
      // The highlighted option should exist in the DOM
      const highlightedEl = document.getElementById(activedescendant!);
      expect(highlightedEl).toBeInTheDocument();
    });
  });

  describe('Dropdown behavior', () => {
    it('opens dropdown on focus', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('displays option descriptions', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      expect(screen.getByText('123 Main St')).toBeInTheDocument();
      expect(screen.getByText('456 Industrial Ave')).toBeInTheDocument();
    });

    it('shows loading state', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: [],
          onSearchChange: vi.fn(),
          isLoading: true,
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('shows error state', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: [],
          onSearchChange: vi.fn(),
          isError: true,
          errorMessage: 'Failed to load',
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });

    it('shows empty state when no options', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: [],
          onSearchChange: vi.fn(),
          emptyMessage: 'No sites found',
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      expect(screen.getByText('No sites found')).toBeInTheDocument();
    });

    it('closes on click outside without changing selection', () => {
      const onChange = vi.fn();
      render(
        createElement(Combobox, {
          value: 'site-1',
          onChange,
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // Click outside
      fireEvent.mouseDown(document.body);

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard navigation', () => {
    it('ArrowDown moves highlight down', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input.getAttribute('aria-activedescendant')).toBeTruthy();

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      // Should now point to second option
      const options = screen.getAllByRole('option');
      const activedescendant = input.getAttribute('aria-activedescendant');
      expect(activedescendant).toBe(options[1]?.id);
    });

    it('ArrowUp moves highlight up', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      // Move down twice, then up once
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });

      const options = screen.getAllByRole('option');
      const activedescendant = input.getAttribute('aria-activedescendant');
      expect(activedescendant).toBe(options[0]?.id);
    });

    it('ArrowDown clamps at end of list', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      // Press down more times than options
      for (let i = 0; i < 10; i++) {
        fireEvent.keyDown(input, { key: 'ArrowDown' });
      }

      const options = screen.getAllByRole('option');
      const activedescendant = input.getAttribute('aria-activedescendant');
      expect(activedescendant).toBe(options[2]?.id); // last option
    });

    it('ArrowUp clamps at start of list', () => {
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      // Try going up more than possible
      for (let i = 0; i < 10; i++) {
        fireEvent.keyDown(input, { key: 'ArrowUp' });
      }

      const options = screen.getAllByRole('option');
      const activedescendant = input.getAttribute('aria-activedescendant');
      expect(activedescendant).toBe(options[0]?.id); // first option
    });

    it('Enter selects highlighted option', () => {
      const onChange = vi.fn();
      render(
        createElement(Combobox, {
          value: undefined,
          onChange,
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onChange).toHaveBeenCalledWith('site-1');
    });

    it('Escape closes dropdown without changing selection', () => {
      const onChange = vi.fn();
      render(
        createElement(Combobox, {
          value: 'site-1',
          onChange,
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Selection', () => {
    it('clicking an option selects it', () => {
      const onChange = vi.fn();
      render(
        createElement(Combobox, {
          value: undefined,
          onChange,
          options: mockOptions,
          onSearchChange: vi.fn(),
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      const option = screen.getByText('Warehouse');
      fireEvent.mouseDown(option);

      expect(onChange).toHaveBeenCalledWith('site-2');
    });

    it('clearing input resets selection', () => {
      const onChange = vi.fn();
      const onSearchChange = vi.fn();
      render(
        createElement(Combobox, {
          value: 'site-1',
          onChange,
          options: mockOptions,
          onSearchChange,
        })
      );

      const input = screen.getByRole('combobox') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '' } });

      expect(onChange).toHaveBeenCalledWith(undefined);
      expect(onSearchChange).toHaveBeenCalledWith('');
    });
  });

  describe('Debounced search', () => {
    it('debounces onSearchChange callback', () => {
      const onSearchChange = vi.fn();
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange,
          debounceMs: 300,
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'war' } });

      // Should not fire immediately
      expect(onSearchChange).not.toHaveBeenCalled();

      // Advance timer
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(onSearchChange).toHaveBeenCalledWith('war');
    });

    it('uses custom debounce delay', () => {
      const onSearchChange = vi.fn();
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange,
          debounceMs: 500,
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'test' } });

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(onSearchChange).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onSearchChange).toHaveBeenCalledWith('test');
    });

    it('resets debounce timer on subsequent input', () => {
      const onSearchChange = vi.fn();
      render(
        createElement(Combobox, {
          value: undefined,
          onChange: vi.fn(),
          options: mockOptions,
          onSearchChange,
          debounceMs: 300,
        })
      );

      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'w' } });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      fireEvent.change(input, { target: { value: 'wa' } });

      act(() => {
        vi.advanceTimersByTime(200);
      });
      // Still not fired because timer reset
      expect(onSearchChange).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(100);
      });
      // Now it fires with latest value
      expect(onSearchChange).toHaveBeenCalledWith('wa');
      expect(onSearchChange).toHaveBeenCalledTimes(1);
    });
  });
});
