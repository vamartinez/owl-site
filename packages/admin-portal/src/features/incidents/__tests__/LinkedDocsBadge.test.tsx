// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { LinkedDocsBadge } from '../LinkedDocsBadge';

afterEach(() => {
  cleanup();
});

describe('LinkedDocsBadge', () => {
  it('renders nothing when count is undefined', () => {
    const { container } = render(createElement(LinkedDocsBadge));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when count is 0', () => {
    const { container } = render(createElement(LinkedDocsBadge, { count: 0 }));
    expect(container.innerHTML).toBe('');
  });

  it('renders the count when count is greater than 0', () => {
    render(createElement(LinkedDocsBadge, { count: 5 }));
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders count of 1 with singular tooltip', () => {
    render(createElement(LinkedDocsBadge, { count: 1 }));
    const badge = screen.getByText('1');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', '1 documento vinculado');
  });

  it('renders count greater than 1 with plural tooltip', () => {
    render(createElement(LinkedDocsBadge, { count: 3 }));
    const badge = screen.getByText('3');
    expect(badge).toHaveAttribute('title', '3 documentos vinculados');
  });

  it('applies pill-style badge classes', () => {
    render(createElement(LinkedDocsBadge, { count: 2 }));
    const badge = screen.getByText('2');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('text-xs');
    expect(badge.className).toContain('font-medium');
  });
});
