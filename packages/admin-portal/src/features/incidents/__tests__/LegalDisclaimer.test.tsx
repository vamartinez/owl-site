// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { LegalDisclaimer } from '../LegalDisclaimer';

const DISCLAIMER_TEXT =
  'The regulatory suggestions provided by this system are operational support and do not constitute legal advice. Consult with a qualified legal professional to determine your specific regulatory obligations.';

const SESSION_STORAGE_KEY = 'incident_legal_disclaimer_acknowledged';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LegalDisclaimer', () => {
  describe('inline variant (default)', () => {
    it('renders the disclaimer text in a styled container', () => {
      render(createElement(LegalDisclaimer));

      expect(screen.getByText(DISCLAIMER_TEXT)).toBeInTheDocument();
      const container = screen.getByRole('note', { name: /legal disclaimer/i });
      expect(container).toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(createElement(LegalDisclaimer, { className: 'mt-4' }));

      const container = screen.getByRole('note', { name: /legal disclaimer/i });
      expect(container.className).toContain('mt-4');
    });
  });

  describe('footer variant', () => {
    it('renders compact disclaimer text for exports', () => {
      render(createElement(LegalDisclaimer, { variant: 'footer' }));

      expect(screen.getByText(DISCLAIMER_TEXT)).toBeInTheDocument();
      const container = screen.getByRole('contentinfo', { name: /legal disclaimer/i });
      expect(container).toBeInTheDocument();
    });

    it('uses italic and smaller text styling', () => {
      render(createElement(LegalDisclaimer, { variant: 'footer' }));

      const text = screen.getByText(DISCLAIMER_TEXT);
      expect(text.className).toContain('text-xs');
      expect(text.className).toContain('italic');
    });
  });

  describe('acknowledgment flow', () => {
    it('shows blocking overlay when requireAcknowledgment is true and not yet acknowledged', () => {
      render(createElement(LegalDisclaimer, { requireAcknowledgment: true }));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText('Legal Disclaimer')).toBeInTheDocument();
      expect(screen.getByText(DISCLAIMER_TEXT)).toBeInTheDocument();
      expect(screen.getByText('I understand and acknowledge')).toBeInTheDocument();
    });

    it('stores acknowledgment in sessionStorage when button is clicked', () => {
      render(createElement(LegalDisclaimer, { requireAcknowledgment: true }));

      fireEvent.click(screen.getByText('I understand and acknowledge'));

      expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe('true');
    });

    it('shows inline disclaimer after acknowledgment', () => {
      render(createElement(LegalDisclaimer, { requireAcknowledgment: true }));

      fireEvent.click(screen.getByText('I understand and acknowledge'));

      // Overlay should be gone, inline disclaimer should show
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('note', { name: /legal disclaimer/i })).toBeInTheDocument();
    });

    it('skips overlay if already acknowledged in session', () => {
      sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');

      render(createElement(LegalDisclaimer, { requireAcknowledgment: true }));

      // Should not show overlay
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // Should show inline disclaimer
      expect(screen.getByRole('note', { name: /legal disclaimer/i })).toBeInTheDocument();
    });

    it('does not show overlay when requireAcknowledgment is false', () => {
      render(createElement(LegalDisclaimer, { requireAcknowledgment: false }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('note', { name: /legal disclaimer/i })).toBeInTheDocument();
    });
  });
});
