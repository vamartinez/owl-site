import { FieldWrapper } from './FieldWrapper';
import type { PublicFieldProps } from './types';

export function FechaField({
  field,
  value,
  error,
  onChange,
  onBlur,
}: PublicFieldProps) {
  const describedBy = [
    error ? `${field.field_id}-error` : '',
    field.help_text ? `${field.field_id}-help` : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Extract date-only portion from ISO strings for min/max
  const minDate = field.validation?.min_date
    ? String(field.validation.min_date).split('T')[0]
    : undefined;
  const maxDate = field.validation?.max_date
    ? String(field.validation.max_date).split('T')[0]
    : undefined;

  return (
    <FieldWrapper
      fieldId={field.field_id}
      label={field.label}
      required={field.required}
      helpText={field.help_text}
      error={error}
    >
      <input
        id={field.field_id}
        type="date"
        value={(value as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        min={minDate}
        max={maxDate}
        aria-invalid={!!error}
        aria-describedby={describedBy || undefined}
        aria-required={field.required}
        className={`
          block w-full rounded-md border px-3 py-2 text-sm shadow-sm
          transition-colors focus:outline-none focus:ring-1
          ${
            error
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
          }
        `}
      />
    </FieldWrapper>
  );
}
