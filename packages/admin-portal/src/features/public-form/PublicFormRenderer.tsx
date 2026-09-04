import { useCallback, useRef } from 'react';
import type { PublicFormField, PublicFormData } from './PublicFormPage';
import {
  TextoCortoField,
  TextoLargoField,
  NumeroField,
  FechaField,
  SeleccionSimpleField,
  SeleccionMultipleField,
  CheckboxAceptacionField,
  CargaArchivoField,
} from './fields';

export type FormValues = Record<string, unknown>;
export type FormErrors = Record<string, string>;

interface PublicFormRendererProps {
  form: PublicFormData;
  values: FormValues;
  errors: FormErrors;
  onFieldChange: (fieldId: string, value: unknown) => void;
  onFieldBlur: (fieldId: string) => void;
  onSubmit: () => void;
  isSubmitting?: boolean;
}

/**
 * Returns the current honeypot field value.
 * Used by the submission handler to detect bots.
 */
export function useHoneypot() {
  const honeypotRef = useRef<HTMLInputElement | null>(null);

  const getHoneypotValue = useCallback((): string => {
    return honeypotRef.current?.value ?? '';
  }, []);

  const isBot = useCallback((): boolean => {
    const value = honeypotRef.current?.value ?? '';
    return value.length > 0;
  }, []);

  return { honeypotRef, getHoneypotValue, isBot };
}

const FIELD_COMPONENTS: Record<
  string,
  React.ComponentType<{
    field: PublicFormField;
    value: unknown;
    error?: string;
    onChange: (value: unknown) => void;
    onBlur: () => void;
  }>
> = {
  texto_corto: TextoCortoField,
  texto_largo: TextoLargoField,
  numero: NumeroField,
  fecha: FechaField,
  seleccion_simple: SeleccionSimpleField,
  seleccion_multiple: SeleccionMultipleField,
  checkbox_aceptacion: CheckboxAceptacionField,
  carga_archivo: CargaArchivoField,
};

function renderField(
  field: PublicFormField,
  value: unknown,
  error: string | undefined,
  onChange: (value: unknown) => void,
  onBlur: () => void
) {
  const Component = FIELD_COMPONENTS[field.type];
  if (!Component) {
    return null;
  }

  return (
    <Component
      field={field}
      value={value}
      error={error}
      onChange={onChange}
      onBlur={onBlur}
    />
  );
}

export function PublicFormRenderer({
  form,
  values,
  errors,
  onFieldChange,
  onFieldBlur,
  onSubmit,
  isSubmitting = false,
  honeypotRef,
}: PublicFormRendererProps & { honeypotRef?: React.Ref<HTMLInputElement> }) {
  // Sort fields by configured order
  const sortedFields = [...form.fields].sort((a, b) => a.order - b.order);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-5"
      aria-label={`Formulario: ${form.name}`}
    >
      {/* Honeypot field — hidden from real users, filled by bots */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '-9999px',
          top: '-9999px',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          opacity: 0,
          pointerEvents: 'none',
        }}
      >
        <label htmlFor="website_url">Website</label>
        <input
          ref={honeypotRef}
          type="text"
          id="website_url"
          name="website_url"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      {sortedFields.map((field) => (
        <div key={field.field_id}>
          {renderField(
            field,
            values[field.field_id],
            errors[field.field_id],
            (value) => onFieldChange(field.field_id, value),
            () => onFieldBlur(field.field_id)
          )}
        </div>
      ))}

      <div className="pt-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className={`
            w-full rounded-md px-4 py-3 text-sm font-medium text-white
            transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2
            focus:ring-primary-500
            ${
              isSubmitting
                ? 'bg-primary-400 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-700'
            }
          `}
        >
          {isSubmitting ? (
            <span className="inline-flex items-center gap-2">
              <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              Enviando...
            </span>
          ) : (
            'Enviar'
          )}
        </button>
      </div>
    </form>
  );
}
