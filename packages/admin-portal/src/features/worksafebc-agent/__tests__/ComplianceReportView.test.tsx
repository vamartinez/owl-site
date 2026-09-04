// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ComplianceReportView } from '../ComplianceReportView';
import type { ReporteCumplimiento } from '../types';

vi.mock('@/store/auth-store', () => ({
  useAuthStore: vi.fn((s) => s({ role: 'site_admin', isAuthenticated: true })),
}));
vi.mock('@/services/api-client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiClientError: class extends Error {},
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const reportWith = (findings: ReporteCumplimiento['findings']): ReporteCumplimiento => ({
  compliance_level: findings.length ? 'no_conforme' : 'conforme',
  executive_summary: 'Resumen ejecutivo de prueba',
  findings,
  recommendations: ['Corregir X'],
  category: 'plan_seguridad',
  ai_model_version: 'gpt-oss:120b-cloud',
  regulatory_kb_version_id: '000001',
  generated_at: new Date().toISOString(),
});

afterEach(cleanup);

describe('ComplianceReportView', () => {
  it('renders the executive summary and findings', () => {
    const report = reportWith([
      { finding_id: 'f1', type: 'brecha', severity: 'critica', description: 'Falta protección contra caídas', regulatory_basis: 'OHSR 11.2', regulation_part: 'Part 11', evidence_excerpt: null },
      { finding_id: 'f2', type: 'brecha', severity: 'baja', description: 'Housekeeping menor', regulatory_basis: 'OHSR 4.43', regulation_part: 'Part 4', evidence_excerpt: null },
    ]);
    wrap(<ComplianceReportView sessionId="s1" report={report} />);
    expect(screen.getByText('Resumen ejecutivo de prueba')).toBeInTheDocument();
    expect(screen.getByText('Falta protección contra caídas')).toBeInTheDocument();
    expect(screen.getByText('Housekeeping menor')).toBeInTheDocument();
  });

  it('filters findings by severity', () => {
    const report = reportWith([
      { finding_id: 'f1', type: 'brecha', severity: 'critica', description: 'Crítica visible', regulatory_basis: 'OHSR 11.2', regulation_part: 'Part 11', evidence_excerpt: null },
      { finding_id: 'f2', type: 'brecha', severity: 'baja', description: 'Baja oculta', regulatory_basis: 'OHSR 4.43', regulation_part: 'Part 4', evidence_excerpt: null },
    ]);
    wrap(<ComplianceReportView sessionId="s1" report={report} />);
    const sevSelect = screen.getByLabelText('Severidad');
    fireEvent.change(sevSelect, { target: { value: 'critica' } });
    expect(screen.getByText('Crítica visible')).toBeInTheDocument();
    expect(screen.queryByText('Baja oculta')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no findings', () => {
    wrap(<ComplianceReportView sessionId="s1" report={reportWith([])} />);
    expect(screen.getByText('No se identificaron brechas.')).toBeInTheDocument();
  });
});
