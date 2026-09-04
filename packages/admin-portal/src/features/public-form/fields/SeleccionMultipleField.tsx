import { FieldWrapper } from './FieldWrapper';
import type { PublicFieldProps } from './types';

export function SeleccionMultipleField({
  field,
  value,
  error,
  onChange,
  onBlur,
}: PublicFieldProps) {
  const selectedValues = Array.isArray(value) ? (value as string[]) : [];

  const handleToggle = (optionId: string) => {
    const updated = selectedValues.includes(optionId)
      ? selectedValues.filter((v) => v !== optionId)
      : [...selectedValues, optionId];
    onChange(updated);
  };

  const groupDescribedBy = [
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
      <fieldset
        aria-describedby={groupDescribedBy || undefined}
        aria-invalid={!!error}
        onBlur={onBlur}
        className="space-y-2"
      >
        <legend className="sr-only">{field.label}</legend>
        {field.options?.map((opt) => (
          <label
            key={opt.option_id}
            className="flex items-start gap-2.5 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedValues.includes(opt.option_id)}
              onChange={() => handleToggle(opt.option_id)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">{opt.label}</span>
          </label>
        ))}
      </fieldset>
    </FieldWrapper>
  );
}
