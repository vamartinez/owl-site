import { FieldWrapper } from './FieldWrapper';
import type { PublicFieldProps } from './types';

export function NumeroField({
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
        type="number"
        value={value !== undefined && value !== null && value !== '' ? String(value) : ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange('');
          } else {
            const num = Number(raw);
            onChange(isNaN(num) ? raw : num);
          }
        }}
        onBlur={onBlur}
        placeholder={field.placeholder}
        min={field.validation?.min_value as number | undefined}
        max={field.validation?.max_value as number | undefined}
        aria-invalid={!!error}
        aria-describedby={describedBy || undefined}
        aria-required={field.required}
        className={`
          block w-full rounded-md border px-3 py-2 text-sm shadow-sm
          transition-colors focus:outline-none focus:ring-1
          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
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
