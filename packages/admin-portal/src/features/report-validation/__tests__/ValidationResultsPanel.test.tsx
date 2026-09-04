// @vitest-environment jsdom
import { render, screen, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ValidationResultsPanel } from '../ValidationResultsPanel';
import type { ValidationResult, ComplianceFinding } from '../types';

afterEach(() => {
  cleanup();
});

function makeFinding(overrides: Partial<ComplianceFinding> = {}): ComplianceFinding {
  return {
    finding_id: `finding-${Math.random().toString(36).slice(2)}`,
    severity: 'major',
    description: 'A test finding description',
    report_section: 'Section 3.1',
    suggested_correction: 'Fix the issue',
    regulation_references: [{ title: 'WorkSafeBC OHS', section: '11.2(1)', url: 'https://example.com' }],
    ...overrides,
  };
}

function makeValidationResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    validation_id: 'val-001',
    report_id: 'report-001',
    version: 1,
    status: 'completed',
    score: 72,
    summary: 'The report has several compliance gaps.',
    findings: [
      makeFinding({ severity: 'critical', description: 'Critical issue found' }),
      makeFinding({ severity: 'major', description: 'Major issue found' }),
      makeFinding({ severity: 'minor', description: 'Minor issue found' }),
    ],
    requested_at: '2024-01-15T10:00:00Z',
    completed_at: '2024-01-15T10:01:00Z',
    ...overrides,
  };
}

describe('ValidationResultsPanel', () => {
  describe('renders findings grouped by severity', () => {
    it('shows findings grouped by severity with correct headers', () => {
      const result = makeValidationResult();
      render(<ValidationResultsPanel validationResult={result} />);

      expect(screen.getByText(/Critical \(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/Major \(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/Minor \(1\)/)).toBeInTheDocument();
    });

    it('displays severity count badges', () => {
      const result = makeValidationResult();
      render(<ValidationResultsPanel validationResult={result} />);

      expect(screen.getByText('Critical: 1')).toBeInTheDocument();
      expect(screen.getByText('Major: 1')).toBeInTheDocument();
      expect(screen.getByText('Minor: 1')).toBeInTheDocument();
    });

    it('displays finding descriptions within groups', () => {
      const result = makeValidationResult();
      render(<ValidationResultsPanel validationResult={result} />);

      expect(screen.getByText('Critical issue found')).toBeInTheDocument();
      expect(screen.getByText('Major issue found')).toBeInTheDocument();
      expect(screen.getByText('Minor issue found')).toBeInTheDocument();
    });

    it('does not display empty severity groups', () => {
      const result = makeValidationResult({
        findings: [makeFinding({ severity: 'critical', description: 'Only critical' })],
      });
      render(<ValidationResultsPanel validationResult={result} />);

      expect(screen.getByText(/Critical \(1\)/)).toBeInTheDocument();
      expect(screen.queryByText(/Major/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Minor/)).not.toBeInTheDocument();
    });
  });

  describe('shows disclaimer', () => {
    it('displays the AI disclaimer text', () => {
      const result = makeValidationResult();
      render(<ValidationResultsPanel validationResult={result} />);

      expect(
        screen.getByText(/This AI-generated compliance analysis is provided as advisory support only/)
      ).toBeInTheDocument();
    });

    it('shows disclaimer even when there are zero findings', () => {
      const result = makeValidationResult({ findings: [], score: 100 });
      render(<ValidationResultsPanel validationResult={result} />);

      expect(
        screen.getByText(/This AI-generated compliance analysis is provided as advisory support only/)
      ).toBeInTheDocument();
    });
  });

  describe('zero findings state', () => {
    it('shows score 100 and no issues message when no findings exist', () => {
      const result = makeValidationResult({ findings: [], score: 100 });
      render(<ValidationResultsPanel validationResult={result} />);

      expect(screen.getByText('100/100')).toBeInTheDocument();
      expect(
        screen.getByText(/No compliance issues were identified/)
      ).toBeInTheDocument();
    });
  });

  describe('compliance score display', () => {
    it('displays the compliance score', () => {
      const result = makeValidationResult({ score: 72 });
      render(<ValidationResultsPanel validationResult={result} />);

      expect(screen.getByText('72/100')).toBeInTheDocument();
    });
  });

  describe('summary display', () => {
    it('displays validation summary text', () => {
      const result = makeValidationResult({ summary: 'Several compliance gaps.' });
      render(<ValidationResultsPanel validationResult={result} />);

      expect(screen.getByText('Several compliance gaps.')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading spinner when isLoading is true', () => {
      render(<ValidationResultsPanel validationResult={undefined} isLoading={true} />);

      expect(screen.getByText('Loading validation results...')).toBeInTheDocument();
    });

    it('shows timeout error after 10 seconds', () => {
      vi.useFakeTimers();
      render(<ValidationResultsPanel validationResult={undefined} isLoading={true} onRetry={vi.fn()} />);

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(screen.getByText(/Results could not be loaded/)).toBeInTheDocument();
      vi.useRealTimers();
    });

    it('shows retry button on timeout when onRetry is provided', () => {
      vi.useFakeTimers();
      const onRetry = vi.fn();
      render(<ValidationResultsPanel validationResult={undefined} isLoading={true} onRetry={onRetry} />);

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
      vi.useRealTimers();
    });
  });

  describe('null result', () => {
    it('renders nothing when validationResult is undefined and not loading', () => {
      const { container } = render(<ValidationResultsPanel validationResult={undefined} />);
      expect(container.innerHTML).toBe('');
    });
  });
});
