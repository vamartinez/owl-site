// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { PublicFormSuccess } from '../PublicFormSuccess';

afterEach(() => {
  cleanup();
});

describe('PublicFormSuccess', () => {
  it('renders success message with form name', () => {
    render(createElement(PublicFormSuccess, { formName: 'Registro de Ingreso', folio: 'A3K9M2X7' }));

    expect(screen.getByText('¡Formulario enviado exitosamente!')).toBeInTheDocument();
    expect(screen.getByText(/Registro de Ingreso/)).toBeInTheDocument();
  });

  it('displays the 8-character folio reference', () => {
    render(createElement(PublicFormSuccess, { formName: 'Test Form', folio: 'B4L0N3Y8' }));

    expect(screen.getByText('B4L0N3Y8')).toBeInTheDocument();
  });

  it('has accessible folio label', () => {
    render(createElement(PublicFormSuccess, { formName: 'Test Form', folio: 'C5M1P4Q9' }));

    expect(screen.getByLabelText(/Folio de referencia: C5M1P4Q9/)).toBeInTheDocument();
  });

  it('shows folio section header', () => {
    render(createElement(PublicFormSuccess, { formName: 'Test Form', folio: 'D6N2R5S0' }));

    expect(screen.getByText('Folio de referencia')).toBeInTheDocument();
  });

  it('shows save folio reminder', () => {
    render(createElement(PublicFormSuccess, { formName: 'Test Form', folio: 'E7O3T6U1' }));

    expect(screen.getByText(/Guarda este folio/)).toBeInTheDocument();
  });
});
