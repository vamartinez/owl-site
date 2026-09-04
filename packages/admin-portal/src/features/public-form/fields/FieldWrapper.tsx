import type { ReactNode } from 'react';

interface FieldWrapperProps {
  fieldId: string;
  label: string;
  required: boolean;
  helpText?: string;
  error?: string;
  children: ReactNode;
}

export function FieldWrapper({
  fieldId,
  label,
  required,
  helpText,
  error,
  children,
}: FieldWrapperProps) {
  const errorId = `${fieldId}-error`;
  const helpId = `${fieldId}-help`;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={fieldId}
        className="block text-sm font-medium text-gray-700"
      >
        {label}
        {required && (
          <span className="text-red-500 ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error && (
        <p id={errorId} className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {helpText && !error && (
        <p id={helpId} className="text-xs text-gray-500">
          {helpText}
        </p>
      )}
    </div>
  );
}
