// @vitest-environment jsdom
/**
 * Property-based tests for Combobox debounce and keyboard navigation.
 *
 * **Validates: Requirements 1.2, 1.3, 1.5**
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import fc from 'fast-check';
import { Combobox, type ComboboxOption } from '../Combobox';

/**
 * Arbitrary for generating non-empty printable strings (search queries).
 */
const arbSearchQuery = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

/**
 * Arbitrary for generating a valid debounce delay in ms.
 */
const arbDebounceMs = fc.integer({ min: 50, max: 2000 });

/**
 * Arbitrary for generating a list of ComboboxOption items with unique values.
 */
const arbOptions: fc.Arbitrary<ComboboxOption[]> = fc
  .array(
    fc.record({
      value: fc.uuid(),
      label: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
      description: fc.option(fc.string({ minLength: 1, maxLength: 60 }), { nil: undefined }),
    }),
    { minLength: 0, maxLength: 20 }
  )
  .map((opts) => {
    const seen = new Set<string>();
    return opts.filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
  });

/**
 * Arbitrary for a non-empty options list (N >= 1).
 */
const arbNonEmptyOptions: fc.Arbitrary<ComboboxOption[]> = fc
  .array(
    fc.record({
      value: fc.uuid(),
      label: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
      description: fc.option(fc.string({ minLength: 1, maxLength: 60 }), { nil: undefined }),
    }),
    { minLength: 1, maxLength: 20 }
  )
  .map((opts) => {
    const seen = new Set<string>();
    return opts.filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
  })
  .filter((opts) => opts.length >= 1);

/**
 * Arbitrary for a sequence of ArrowUp / ArrowDown key presses.
 */
const arbKeySequence = fc.array(fc.constantFrom('ArrowUp', 'ArrowDown'), {
  minLength: 1,
  maxLength: 30,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Combobox Property Tests — Debounce and Keyboard Navigation', () => {
  /**
   * Property 1: Debounce delays emission
   *
   * For any input string and any configured debounce delay, the `onSearchChange`
   * callback SHALL NOT be invoked until the full delay has elapsed without further
   * input changes.
   *
   * **Validates: Requirements 1.2**
   */
  describe('Property 1: Debounce delays emission', () => {
    it('onSearchChange is not called before the debounce delay elapses', () => {
      fc.assert(
        fc.property(arbSearchQuery, arbDebounceMs, (query, debounceMs) => {
          cleanup();
          const onSearchChange = vi.fn();
          const onChange = vi.fn();

          render(
            createElement(Combobox, {
              value: undefined,
              onChange,
              options: [],
              onSearchChange,
              debounceMs,
            })
          );

          const input = screen.getByRole('combobox');
          fireEvent.change(input, { target: { value: query } });

          // Advance time to 1ms BEFORE the debounce should fire
          act(() => {
            vi.advanceTimersByTime(debounceMs - 1);
          });

          // Callback must NOT have been called yet
          expect(onSearchChange).not.toHaveBeenCalled();

          // Now advance the remaining 1ms so the timer fires
          act(() => {
            vi.advanceTimersByTime(1);
          });

          // Now the callback SHOULD have been called with the query
          expect(onSearchChange).toHaveBeenCalledWith(query);
          expect(onSearchChange).toHaveBeenCalledTimes(1);
        }),
        { numRuns: 50 }
      );
    });

    it('subsequent input resets the debounce timer (only final value emitted)', () => {
      fc.assert(
        fc.property(
          fc.array(arbSearchQuery, { minLength: 2, maxLength: 5 }),
          arbDebounceMs,
          (queries, debounceMs) => {
            cleanup();
            const onSearchChange = vi.fn();
            const onChange = vi.fn();

            render(
              createElement(Combobox, {
                value: undefined,
                onChange,
                options: [],
                onSearchChange,
                debounceMs,
              })
            );

            const input = screen.getByRole('combobox');

            // Type each query with partial delay between them (less than full debounce)
            for (let i = 0; i < queries.length; i++) {
              fireEvent.change(input, { target: { value: queries[i] } });

              if (i < queries.length - 1) {
                // Advance less than the debounce delay between inputs
                act(() => {
                  vi.advanceTimersByTime(Math.floor(debounceMs / 2));
                });
              }
            }

            // At this point, no call should have happened (timer keeps resetting)
            expect(onSearchChange).not.toHaveBeenCalled();

            // Now let the full debounce elapse after the last input
            act(() => {
              vi.advanceTimersByTime(debounceMs);
            });

            // Only the last query should be emitted
            expect(onSearchChange).toHaveBeenCalledTimes(1);
            expect(onSearchChange).toHaveBeenCalledWith(queries[queries.length - 1]);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  /**
   * Property 2: Keyboard navigation stays within bounds
   *
   * For any list of N options (N ≥ 0) and any sequence of ArrowUp/ArrowDown key
   * presses, the highlighted index SHALL always remain in the range [0, N-1]
   * (or no highlight when N = 0).
   *
   * **Validates: Requirements 1.3**
   */
  describe('Property 2: Keyboard navigation stays within bounds', () => {
    it('highlighted index never goes out of bounds for non-empty option lists', () => {
      fc.assert(
        fc.property(arbNonEmptyOptions, arbKeySequence, (options, keys) => {
          cleanup();
          const onChange = vi.fn();
          const onSearchChange = vi.fn();

          render(
            createElement(Combobox, {
              value: undefined,
              onChange,
              options,
              onSearchChange,
            })
          );

          const input = screen.getByRole('combobox');
          fireEvent.focus(input);

          // Execute each key press and verify bounds after each one
          for (const key of keys) {
            fireEvent.keyDown(input, { key });

            const activedescendant = input.getAttribute('aria-activedescendant');
            if (activedescendant) {
              // Extract the index from the id pattern: {instanceId}-option-{index}
              const match = activedescendant.match(/-option-(\d+)$/);
              expect(match).not.toBeNull();
              const index = parseInt(match![1], 10);
              expect(index).toBeGreaterThanOrEqual(0);
              expect(index).toBeLessThan(options.length);
            }
          }
        }),
        { numRuns: 50 }
      );
    });

    it('no highlight is set when options list is empty', () => {
      fc.assert(
        fc.property(arbKeySequence, (keys) => {
          cleanup();
          const onChange = vi.fn();
          const onSearchChange = vi.fn();

          render(
            createElement(Combobox, {
              value: undefined,
              onChange,
              options: [],
              onSearchChange,
            })
          );

          const input = screen.getByRole('combobox');
          fireEvent.focus(input);

          // Execute each key press
          for (const key of keys) {
            fireEvent.keyDown(input, { key });
          }

          // aria-activedescendant should be absent or empty (no valid option to highlight)
          const activedescendant = input.getAttribute('aria-activedescendant');
          expect(
            activedescendant === null ||
              activedescendant === '' ||
              activedescendant === undefined
          ).toBe(true);
        }),
        { numRuns: 30 }
      );
    });
  });

  /**
   * Property 4: Dismiss preserves current selection
   *
   * For any current selection state (selected or empty), pressing Escape or clicking
   * outside the Combobox SHALL close the dropdown and the selected value SHALL remain
   * unchanged.
   *
   * **Validates: Requirements 1.5**
   */
  describe('Property 4: Dismiss preserves current selection', () => {
    it('pressing Escape preserves selection and closes dropdown', () => {
      fc.assert(
        fc.property(arbNonEmptyOptions, fc.boolean(), (options, hasSelection) => {
          cleanup();
          const selectedValue = hasSelection ? options[0].value : undefined;
          const onChange = vi.fn();
          const onSearchChange = vi.fn();

          render(
            createElement(Combobox, {
              value: selectedValue,
              onChange,
              options,
              onSearchChange,
            })
          );

          const input = screen.getByRole('combobox');

          // Open the dropdown
          fireEvent.focus(input);
          expect(screen.getByRole('listbox')).toBeInTheDocument();

          // Press Escape
          fireEvent.keyDown(input, { key: 'Escape' });

          // Dropdown should be closed
          expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

          // onChange should NOT have been called (selection preserved)
          expect(onChange).not.toHaveBeenCalled();

          // If there was a selection, input should still show that label
          if (hasSelection) {
            const inputEl = input as HTMLInputElement;
            expect(inputEl.value).toBe(options[0].label);
          }
        }),
        { numRuns: 50 }
      );
    });

    it('clicking outside preserves selection and closes dropdown', () => {
      fc.assert(
        fc.property(arbNonEmptyOptions, fc.boolean(), (options, hasSelection) => {
          cleanup();
          const selectedValue = hasSelection ? options[0].value : undefined;
          const onChange = vi.fn();
          const onSearchChange = vi.fn();

          render(
            createElement(Combobox, {
              value: selectedValue,
              onChange,
              options,
              onSearchChange,
            })
          );

          const input = screen.getByRole('combobox');

          // Open the dropdown
          fireEvent.focus(input);
          expect(screen.getByRole('listbox')).toBeInTheDocument();

          // Click outside
          fireEvent.mouseDown(document.body);

          // Dropdown should be closed
          expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

          // onChange should NOT have been called (selection preserved)
          expect(onChange).not.toHaveBeenCalled();

          // If there was a selection, input should still show that label
          if (hasSelection) {
            const inputEl = input as HTMLInputElement;
            expect(inputEl.value).toBe(options[0].label);
          }
        }),
        { numRuns: 50 }
      );
    });
  });
});
