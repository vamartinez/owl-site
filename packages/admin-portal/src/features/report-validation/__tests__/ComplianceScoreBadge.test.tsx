// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ComplianceScoreBadge } from '../ComplianceScoreBadge';

describe('ComplianceScoreBadge', () => {
  describe('undefined score (not yet validated)', () => {
    it('displays "Not validated" when score is undefined', () => {
      render(<ComplianceScoreBadge score={undefined} />);
      expect(screen.getByText('Not validated')).toBeInTheDocument();
    });

    it('uses gray styling for undefined score', () => {
      const { container } = render(<ComplianceScoreBadge score={undefined} />);
      const badge = container.firstElementChild as HTMLElement;
      expect(badge.className).toContain('bg-gray-50');
      expect(badge.className).toContain('text-gray-500');
    });
  });

  describe('green score (80-100)', () => {
    it('displays score 100 with green styling', () => {
      const { container } = render(<ComplianceScoreBadge score={100} />);
      expect(screen.getByText('100/100')).toBeInTheDocument();
      const badge = container.firstElementChild as HTMLElement;
      expect(badge.className).toContain('bg-green-50');
      expect(badge.className).toContain('text-green-700');
    });

    it('displays score 80 with green styling', () => {
      const { container } = render(<ComplianceScoreBadge score={80} />);
      expect(screen.getByText('80/100')).toBeInTheDocument();
      const badge = container.firstElementChild as HTMLElement;
      expect(badge.className).toContain('bg-green-50');
    });
  });

  describe('yellow score (50-79)', () => {
    it('displays score 79 with yellow styling', () => {
      const { container } = render(<ComplianceScoreBadge score={79} />);
      expect(screen.getByText('79/100')).toBeInTheDocument();
      const badge = container.firstElementChild as HTMLElement;
      expect(badge.className).toContain('bg-yellow-50');
      expect(badge.className).toContain('text-yellow-700');
    });

    it('displays score 50 with yellow styling', () => {
      const { container } = render(<ComplianceScoreBadge score={50} />);
      expect(screen.getByText('50/100')).toBeInTheDocument();
      const badge = container.firstElementChild as HTMLElement;
      expect(badge.className).toContain('bg-yellow-50');
    });
  });

  describe('red score (0-49)', () => {
    it('displays score 49 with red styling', () => {
      const { container } = render(<ComplianceScoreBadge score={49} />);
      expect(screen.getByText('49/100')).toBeInTheDocument();
      const badge = container.firstElementChild as HTMLElement;
      expect(badge.className).toContain('bg-red-50');
      expect(badge.className).toContain('text-red-700');
    });

    it('displays score 0 with red styling', () => {
      const { container } = render(<ComplianceScoreBadge score={0} />);
      expect(screen.getByText('0/100')).toBeInTheDocument();
      const badge = container.firstElementChild as HTMLElement;
      expect(badge.className).toContain('bg-red-50');
    });
  });

  describe('className prop', () => {
    it('applies custom className', () => {
      const { container } = render(<ComplianceScoreBadge score={85} className="mt-2" />);
      const badge = container.firstElementChild as HTMLElement;
      expect(badge.className).toContain('mt-2');
    });
  });
});
