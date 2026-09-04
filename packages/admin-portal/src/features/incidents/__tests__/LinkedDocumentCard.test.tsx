// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { LinkedDocumentCard } from '../LinkedDocumentCard';
import type { LinkedDocument } from '../types';

const mockDocument: LinkedDocument = {
  link_id: 'link-001',
  incident_id: 'inc-001',
  response_id: 'resp-001',
  form_id: 'form-001',
  document_category: 'investigacion',
  context_note: 'Este documento describe la investigación inicial del evento.',
  linked_by: 'user-001',
  linked_by_name: 'Juan Pérez',
  linked_at: '2024-03-15T10:30:00Z',
  form_name: 'Investigación de Incidente',
  folio: 'INV-2024-042',
  response_submitted_at: '2024-03-14T08:00:00Z',
  response_submitted_by: 'María López',
};

function renderCard(props: Partial<React.ComponentProps<typeof LinkedDocumentCard>> = {}) {
  const defaultProps = {
    document: mockDocument,
    canUnlink: false,
    ...props,
  };
  return render(
    createElement(
      MemoryRouter,
      null,
      createElement(LinkedDocumentCard, defaultProps)
    )
  );
}

afterEach(() => {
  cleanup();
});

describe('LinkedDocumentCard', () => {
  it('renders form name and folio', () => {
    renderCard();
    expect(screen.getByText('Investigación de Incidente')).toBeInTheDocument();
    expect(screen.getByText('#INV-2024-042')).toBeInTheDocument();
  });

  it('renders category badge with correct label', () => {
    renderCard();
    expect(screen.getByText('Investigación')).toBeInTheDocument();
  });

  it('renders submission date', () => {
    renderCard();
    expect(screen.getByText(/Enviado:/)).toBeInTheDocument();
  });

  it('renders who submitted the form response', () => {
    renderCard();
    expect(screen.getByText(/María López/)).toBeInTheDocument();
  });

  it('renders who linked the document and when', () => {
    renderCard();
    expect(screen.getByText(/Juan Pérez/)).toBeInTheDocument();
  });

  it('renders "Ver detalle" link pointing to the form response', () => {
    renderCard();
    const link = screen.getByText('Ver detalle').closest('a');
    expect(link).toHaveAttribute('href', '/forms/responses/resp-001');
  });

  it('does not render unlink button when canUnlink is false', () => {
    renderCard({ canUnlink: false });
    expect(screen.queryByText('Desvincular')).not.toBeInTheDocument();
  });

  it('renders unlink button when canUnlink is true and onUnlink is provided', () => {
    const onUnlink = vi.fn();
    renderCard({ canUnlink: true, onUnlink });
    expect(screen.getByText('Desvincular')).toBeInTheDocument();
  });

  it('calls onUnlink with link_id when unlink button is clicked', () => {
    const onUnlink = vi.fn();
    renderCard({ canUnlink: true, onUnlink });
    fireEvent.click(screen.getByText('Desvincular'));
    expect(onUnlink).toHaveBeenCalledWith('link-001');
  });

  it('does not render context note toggle when context_note is absent', () => {
    const docWithoutNote: LinkedDocument = { ...mockDocument, context_note: undefined };
    renderCard({ document: docWithoutNote });
    expect(screen.queryByText('Nota de contexto')).not.toBeInTheDocument();
  });

  it('renders collapsed context note toggle when context_note is present', () => {
    renderCard();
    expect(screen.getByText('Nota de contexto')).toBeInTheDocument();
    // Note content is hidden by default
    expect(screen.queryByText(mockDocument.context_note!)).not.toBeInTheDocument();
  });

  it('expands context note when toggle is clicked', () => {
    renderCard();
    fireEvent.click(screen.getByText('Nota de contexto'));
    expect(screen.getByText(mockDocument.context_note!)).toBeInTheDocument();
  });

  it('collapses context note when toggle is clicked again', () => {
    renderCard();
    const toggle = screen.getByText('Nota de contexto');
    fireEvent.click(toggle);
    expect(screen.getByText(mockDocument.context_note!)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText(mockDocument.context_note!)).not.toBeInTheDocument();
  });

  it('renders different category badges correctly', () => {
    const docAccion: LinkedDocument = { ...mockDocument, document_category: 'accion_correctiva' };
    renderCard({ document: docAccion });
    expect(screen.getByText('Acción Correctiva')).toBeInTheDocument();
  });
});
