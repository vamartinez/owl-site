// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { PublicFormRenderer } from '../PublicFormRenderer';
import { PublicFormProvider } from '../PublicFormContext';
import type { PublicFormData } from '../PublicFormPage';

afterEach(() => {
  cleanup();
});

const baseForm: PublicFormData = {
  name: 'Test Form',
  description: 'A test form',
  fields: [
    {
      field_id: 'f1',
      type: 'texto_corto',
      label: 'Nombre completo',
      required: true,
      order: 1,
      placeholder: 'Ingrese su nombre',
      help_text: 'Nombre y apellido',
    },
    {
      field_id: 'f2',
      type: 'texto_largo',
      label: 'Comentarios',
      required: false,
      order: 2,
      placeholder: 'Escriba aquí...',
    },
    {
      field_id: 'f3',
      type: 'numero',
      label: 'Edad',
      required: true,
      order: 3,
      validation: { min_value: 18, max_value: 99 },
    },
    {
      field_id: 'f4',
      type: 'fecha',
      label: 'Fecha de inicio',
      required: false,
      order: 4,
    },
    {
      field_id: 'f5',
      type: 'seleccion_simple',
      label: 'Turno',
      required: true,
      order: 5,
      options: [
        { option_id: 'opt1', label: 'Mañana' },
        { option_id: 'opt2', label: 'Tarde' },
        { option_id: 'opt3', label: 'Noche' },
      ],
    },
    {
      field_id: 'f6',
      type: 'seleccion_multiple',
      label: 'Habilidades',
      required: false,
      order: 6,
      options: [
        { option_id: 'sk1', label: 'Soldadura' },
        { option_id: 'sk2', label: 'Electricidad' },
        { option_id: 'sk3', label: 'Plomería' },
      ],
    },
    {
      field_id: 'f7',
      type: 'checkbox_aceptacion',
      label: 'Acepto los términos y condiciones',
      required: true,
      order: 7,
    },
    {
      field_id: 'f8',
      type: 'carga_archivo',
      label: 'Documento de identidad',
      required: false,
      order: 8,
    },
  ],
};

function renderForm(overrides: Partial<Parameters<typeof PublicFormRenderer>[0]> = {}) {
  const defaultProps = {
    form: baseForm,
    values: {},
    errors: {},
    onFieldChange: vi.fn(),
    onFieldBlur: vi.fn(),
    onSubmit: vi.fn(),
    isSubmitting: false,
    ...overrides,
  };

  const mockContextValue = {
    token: 'test-token-123',
    setFileKey: vi.fn(),
    getFileKey: vi.fn().mockReturnValue(null),
  };

  return {
    ...render(
      createElement(
        PublicFormProvider,
        { value: mockContextValue } as any,
        createElement(PublicFormRenderer, defaultProps)
      )
    ),
    props: defaultProps,
  };
}

describe('PublicFormRenderer', () => {
  it('renders all 8 field types with labels', () => {
    renderForm();

    expect(screen.getByLabelText(/Nombre completo/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Comentarios/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Edad/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Fecha de inicio/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Turno/)).toBeInTheDocument();
    // seleccion_multiple uses a fieldset with legend (sr-only) + label from FieldWrapper
    expect(screen.getAllByText('Habilidades').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/Acepto los términos y condiciones/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Documento de identidad/)).toBeInTheDocument();
  });

  it('renders fields in configured order', () => {
    const form: PublicFormData = {
      name: 'Order Test',
      fields: [
        { field_id: 'a', type: 'texto_corto', label: 'Campo Z', required: false, order: 3 },
        { field_id: 'b', type: 'texto_corto', label: 'Campo A', required: false, order: 1 },
        { field_id: 'c', type: 'texto_corto', label: 'Campo M', required: false, order: 2 },
      ],
    };
    renderForm({ form });

    const labels = screen.getAllByText(/Campo/);
    expect(labels[0]).toHaveTextContent('Campo A');
    expect(labels[1]).toHaveTextContent('Campo M');
    expect(labels[2]).toHaveTextContent('Campo Z');
  });

  it('shows placeholder text on text inputs', () => {
    renderForm();

    expect(screen.getByPlaceholderText('Ingrese su nombre')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escriba aquí...')).toBeInTheDocument();
  });

  it('shows help text below fields', () => {
    renderForm();

    expect(screen.getByText('Nombre y apellido')).toBeInTheDocument();
  });

  it('shows required indicator (*) on required fields', () => {
    renderForm();

    // The required indicator is rendered as a span with * inside the label
    const requiredMarkers = screen.getAllByText('*');
    // We have 3 required fields: Nombre completo, Edad, Turno, Acepto
    expect(requiredMarkers.length).toBeGreaterThanOrEqual(3);
  });

  it('calls onFieldChange when user types in a text field', () => {
    const { props } = renderForm();

    const input = screen.getByLabelText(/Nombre completo/);
    fireEvent.change(input, { target: { value: 'Juan' } });

    expect(props.onFieldChange).toHaveBeenCalledWith('f1', 'Juan');
  });

  it('calls onFieldBlur when user leaves a field', () => {
    const { props } = renderForm();

    const input = screen.getByLabelText(/Nombre completo/);
    fireEvent.blur(input);

    expect(props.onFieldBlur).toHaveBeenCalledWith('f1');
  });

  it('displays validation errors next to fields', () => {
    renderForm({
      errors: {
        f1: 'Este campo es requerido',
        f3: 'El valor debe estar entre 18 y 99',
      },
    });

    expect(screen.getByText('Este campo es requerido')).toBeInTheDocument();
    expect(screen.getByText('El valor debe estar entre 18 y 99')).toBeInTheDocument();
  });

  it('calls onSubmit when form is submitted', () => {
    const { props } = renderForm();

    const submitButton = screen.getByRole('button', { name: 'Enviar' });
    fireEvent.click(submitButton);

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables submit button and shows spinner when isSubmitting is true', () => {
    renderForm({ isSubmitting: true });

    const submitButton = screen.getByRole('button', { name: /Enviando/ });
    expect(submitButton).toBeDisabled();
  });

  it('renders select options for seleccion_simple', () => {
    renderForm();

    const select = screen.getByLabelText(/Turno/);
    expect(select).toBeInTheDocument();
    // Options are rendered within the select element
    const options = select.querySelectorAll('option');
    const optionTexts = Array.from(options).map((o) => o.textContent);
    expect(optionTexts).toContain('Mañana');
    expect(optionTexts).toContain('Tarde');
    expect(optionTexts).toContain('Noche');
  });

  it('renders checkbox options for seleccion_multiple', () => {
    renderForm();

    const checkboxes = screen.getAllByRole('checkbox');
    // f6 has 3 options + f7 has 1 checkbox = 4 checkboxes total
    expect(checkboxes.length).toBe(4);
    expect(screen.getAllByText('Soldadura')).toHaveLength(1);
    expect(screen.getAllByText('Electricidad')).toHaveLength(1);
    expect(screen.getAllByText('Plomería')).toHaveLength(1);
  });

  it('handles seleccion_multiple toggle correctly', () => {
    const { props } = renderForm({ values: { f6: ['sk1'] } });

    // Find the Electricidad checkbox by its label text within the fieldset
    const electricidadLabel = screen.getByText('Electricidad');
    const checkbox = electricidadLabel.closest('label')?.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);

    expect(props.onFieldChange).toHaveBeenCalledWith('f6', ['sk1', 'sk2']);
  });
});
