import { useState, useRef, useEffect, useCallback, useId, type KeyboardEvent } from 'react';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary text shown below the label */
  description?: string;
}

export interface ComboboxProps {
  /** Currently selected value (controlled) */
  value: string | undefined;
  /** Callback when selection changes */
  onChange: (value: string | undefined) => void;
  /** Options to display in the dropdown */
  options: ComboboxOption[];
  /** Callback with debounced search text */
  onSearchChange: (query: string) => void;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Label text above the input */
  label?: string;
  /** Validation error message */
  error?: string;
  /** Whether options are currently loading */
  isLoading?: boolean;
  /** Whether the fetch errored */
  isError?: boolean;
  /** Error message to display in dropdown */
  errorMessage?: string;
  /** Message when no results match */
  emptyMessage?: string;
  /** Debounce delay in milliseconds (default 300) */
  debounceMs?: number;
  /** Whether the field is disabled */
  disabled?: boolean;
}

export function Combobox({
  value,
  onChange,
  options,
  onSearchChange,
  placeholder = 'Search...',
  label,
  error,
  isLoading = false,
  isError = false,
  errorMessage = 'Unable to load results. Please try again.',
  emptyMessage = 'No results found',
  debounceMs = 300,
  disabled = false,
}: ComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [inputText, setInputText] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const instanceId = useId();
  const listboxId = `${instanceId}-listbox`;
  const inputId = label?.toLowerCase().replace(/\s+/g, '-') || `${instanceId}-input`;

  // Sync input text with selected value's label
  useEffect(() => {
    if (value) {
      const selectedOption = options.find((opt) => opt.value === value);
      if (selectedOption) {
        setInputText(selectedOption.label);
      }
    } else {
      setInputText('');
    }
  }, [value, options]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
        // Restore the selected option's label if user typed something else
        if (value) {
          const selectedOption = options.find((opt) => opt.value === value);
          if (selectedOption) {
            setInputText(selectedOption.label);
          }
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value, options]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const debouncedSearch = useCallback(
    (query: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        onSearchChange(query);
      }, debounceMs);
    },
    [onSearchChange, debounceMs]
  );

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value;
    setInputText(text);
    setIsOpen(true);
    setHighlightedIndex(-1);

    if (text === '') {
      // User cleared input — reset selection
      onChange(undefined);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      onSearchChange('');
    } else {
      debouncedSearch(text);
    }
  }

  function handleInputFocus() {
    if (!disabled) {
      setIsOpen(true);
    }
  }

  function selectOption(option: ComboboxOption) {
    onChange(option.value);
    setInputText(option.label);
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          const option = options[highlightedIndex];
          if (option) {
            selectOption(option);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
        // Restore selected option label
        if (value) {
          const selectedOption = options.find((opt) => opt.value === value);
          if (selectedOption) {
            setInputText(selectedOption.label);
          }
        }
        break;
    }
  }

  const highlightedOptionId =
    highlightedIndex >= 0 && highlightedIndex < options.length
      ? `${instanceId}-option-${highlightedIndex}`
      : undefined;

  return (
    <div className="space-y-1" ref={containerRef}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={highlightedOptionId}
          aria-autocomplete="list"
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          value={inputText}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={`
            block w-full rounded-md border px-3 py-2 text-sm shadow-sm
            transition-colors
            focus:outline-none focus:ring-1
            ${error
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
            }
            disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
          `}
        />
        {/* Dropdown chevron indicator */}
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <svg
            className="h-4 w-4 text-gray-400"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>

        {/* Dropdown */}
        {isOpen && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
          >
            {isLoading && (
              <li className="flex items-center justify-center px-3 py-2 text-gray-500">
                <svg
                  className="mr-2 h-4 w-4 animate-spin text-primary-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Loading...
              </li>
            )}
            {isError && !isLoading && (
              <li className="px-3 py-2 text-sm text-red-600">{errorMessage}</li>
            )}
            {!isLoading && !isError && options.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-500">{emptyMessage}</li>
            )}
            {!isLoading &&
              !isError &&
              options.map((option, index) => (
                <li
                  key={option.value}
                  id={`${instanceId}-option-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  className={`
                    cursor-pointer px-3 py-2
                    ${highlightedIndex === index ? 'bg-primary-50 text-primary-900' : 'text-gray-900'}
                    ${option.value === value ? 'font-medium' : ''}
                    hover:bg-gray-50
                  `}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent input blur
                    selectOption(option);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <div className="text-sm">{option.label}</div>
                  {option.description && (
                    <div className="text-xs text-gray-500">{option.description}</div>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
