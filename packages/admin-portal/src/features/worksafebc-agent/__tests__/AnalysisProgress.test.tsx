// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock the api hooks the component uses.
const useSessionMock = vi.fn();
vi.mock('../api', () => ({
  useSession: (...a: unknown[]) => useSessionMock(...a),
  useSessionPolling: vi.fn(),
}));

import { AnalysisProgress } from '../AnalysisProgress';

afterEach(cleanup);

describe('AnalysisProgress', () => {
  it('renders the four pipeline stages', () => {
    useSessionMock.mockReturnValue({ data: { session: { status: 'analizando' } } });
    render(<AnalysisProgress sessionId="s1" />);
    expect(screen.getByText('Carga')).toBeInTheDocument();
    expect(screen.getByText('Extracción de texto')).toBeInTheDocument();
    expect(screen.getByText('Análisis de cumplimiento')).toBeInTheDocument();
    expect(screen.getByText('Reporte')).toBeInTheDocument();
  });

  it('shows completion message when done', () => {
    useSessionMock.mockReturnValue({ data: { session: { status: 'analisis_completado' } } });
    render(<AnalysisProgress sessionId="s1" />);
    expect(screen.getByText('Análisis completado.')).toBeInTheDocument();
  });

  it('shows the failure reason on a failed session', () => {
    useSessionMock.mockReturnValue({
      data: { session: { status: 'extraccion_fallida', failure_reason: 'documento protegido por contraseña' } },
    });
    render(<AnalysisProgress sessionId="s1" />);
    expect(screen.getByText('documento protegido por contraseña')).toBeInTheDocument();
  });
});
