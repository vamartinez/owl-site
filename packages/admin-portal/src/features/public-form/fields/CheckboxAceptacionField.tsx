import { FieldWrapper } from './FieldWrapper';
import type { PublicFieldProps } from './types';

export function CheckboxAceptacionField({
  field,
  value,
  error,
  onChange,
  onBlur,
}: PublicFieldProps) {
  const checked = value === true;

  const describedBy = [
    error ? `${field.field_id}-error` : '',
    field.help_text ? `${field.field_id}-help` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <FieldWrapper
      fieldId={field.field_id}
      label=""
      required={field.required}
      helpText={field.help_text}
      error={error}
    >
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          id={field.field_id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          onBlur={onBlur}
          aria-invalid={!!error}
          aria-describedby={describedBy || undefined}
          aria-required={field.required}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <span className="text-sm text-gray-700">
          {field.label}
          {field.required && (
            <span className="text-red-500 ml-0.5" aria-hidden="true">
              *
            </span>
          )}
        </span>
      </label>
    </FieldWrapper>
  );
}
