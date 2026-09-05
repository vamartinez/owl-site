// @vitest-environment jsdom
/**
 * Tests for the worker-facing public check-in page.
 *
 * Covers the three branches the page routes on:
 *  - QR flow: resolve (requires_identity) → identity challenge → decision
 *  - SMS flow: resolve (no identity) → auto-verify → decision
 *  - Uniform invalid-token state
 * Plus the honeypot field and that only worker-scoped decision fields render.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock router useParams to feed a token.
vi.mock('react-router-dom', () => ({
  useParams: () => ({ token: 'tok-abc' }),
}));

// Mock the api module.
vi.mock('../api', () => ({
  resolveCheckinToken: vi.fn(),
  verifyCheckin: vi.fn(),
  PublicCheckinError: class PublicCheckinError extends Error {
    constructor(public status: number, public code: string) {
      super(code);
      this.name = 'PublicCheckinError';
    }
  },
}));

import PublicCheckinPage from '../PublicCheckinPage';
import { resolveCheckinToken, verifyCheckin } from '../api';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(QueryClientProvider, { client }, createElement(PublicCheckinPage))
  );
}

beforeEach(() => {
  vi.mocked(resolveCheckinToken).mockReset();
  vi.mocked(verifyCheckin).mockReset();
});

afterEach(() => cleanup());

describe('PublicCheckinPage — QR identity flow', () => {
  it('shows the identity challenge when the token requires identity', async () => {
    vi.mocked(resolveCheckinToken).mockResolvedValue({
      site_name: 'Downtown Tower',
      requires_identity: true,
    });

    renderPage();

    expect(await screen.findByText('Verify your identity')).toBeInTheDocument();
    expect(screen.getByLabelText('Full legal name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Last 4 digits/)).toBeInTheDocument();
    // Site name surfaced.
    expect(screen.getByText('Downtown Tower')).toBeInTheDocument();
  });

  it('renders a hidden honeypot field', async () => {
    vi.mocked(resolveCheckinToken).mockResolvedValue({
      site_name: 'Site A',
      requires_identity: true,
    });

    const { container } = renderPage();
    await screen.findByText('Verify your identity');

    const honeypot = container.querySelector('input[name="company_website"]');
    expect(honeypot).toBeTruthy();
    expect(honeypot).toHaveAttribute('aria-hidden', 'true');
    expect(honeypot).toHaveAttribute('tabindex', '-1');
  });

  it('disables submit until name (≥2) and 4-digit phone are valid', async () => {
    vi.mocked(resolveCheckinToken).mockResolvedValue({
      site_name: 'Site A',
      requires_identity: true,
    });

    renderPage();
    await screen.findByText('Verify your identity');

    const submit = screen.getByRole('button', { name: /Check in/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Full legal name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/Last 4 digits/), { target: { value: '1234' } });
    expect(submit).not.toBeDisabled();
  });

  it('strips non-digits from the phone field and caps at 4', async () => {
    vi.mocked(resolveCheckinToken).mockResolvedValue({ site_name: 'S', requires_identity: true });
    renderPage();
    await screen.findByText('Verify your identity');

    const phone = screen.getByLabelText(/Last 4 digits/) as HTMLInputElement;
    fireEvent.change(phone, { target: { value: 'ab12cd345' } });
    expect(phone.value).toBe('1234');
  });

  it('submits the challenge and renders the decision (worker-scoped fields only)', async () => {
    vi.mocked(resolveCheckinToken).mockResolvedValue({ site_name: 'Site A', requires_identity: true });
    vi.mocked(verifyCheckin).mockResolvedValue({
      verified: true,
      decision: 'conditional',
      reasons: ['Fall protection cert expires in 5 days'],
      required_actions: ['Renew your fall protection certification'],
    });

    renderPage();
    await screen.findByText('Verify your identity');

    fireEvent.change(screen.getByLabelText('Full legal name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/Last 4 digits/), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Check in/i }));

    expect(await screen.findByText('Conditional access')).toBeInTheDocument();
    expect(screen.getByText('Fall protection cert expires in 5 days')).toBeInTheDocument();
    expect(screen.getByText('Renew your fall protection certification')).toBeInTheDocument();

    // verifyCheckin got the challenge inputs.
    expect(verifyCheckin).toHaveBeenCalledWith(
      'tok-abc',
      expect.objectContaining({ phone_last4: '1234', legal_name: 'Jane Doe' })
    );
  });

  it('shows the failure message on a failed identity check', async () => {
    vi.mocked(resolveCheckinToken).mockResolvedValue({ site_name: 'Site A', requires_identity: true });
    vi.mocked(verifyCheckin).mockResolvedValue({
      verified: false,
      message: 'We could not verify your identity',
    });

    renderPage();
    await screen.findByText('Verify your identity');
    fireEvent.change(screen.getByLabelText('Full legal name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/Last 4 digits/), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: /Check in/i }));

    expect(await screen.findByText('We could not verify your identity')).toBeInTheDocument();
    // Still on the challenge screen (not a decision).
    expect(screen.getByText('Verify your identity')).toBeInTheDocument();
  });
});

describe('PublicCheckinPage — SMS auto-verify flow', () => {
  it('auto-verifies without a challenge when identity is not required', async () => {
    vi.mocked(resolveCheckinToken).mockResolvedValue({ site_name: 'Site B', requires_identity: false });
    vi.mocked(verifyCheckin).mockResolvedValue({
      verified: true,
      decision: 'allowed',
      reasons: ['All good'],
      required_actions: [],
    });

    renderPage();

    expect(await screen.findByText('Access granted')).toBeInTheDocument();
    // No identity form was shown.
    expect(screen.queryByText('Verify your identity')).not.toBeInTheDocument();
    // Called with no identity fields.
    expect(verifyCheckin).toHaveBeenCalledWith(
      'tok-abc',
      expect.objectContaining({ phone_last4: undefined, legal_name: undefined })
    );
  });
});

describe('PublicCheckinPage — invalid token', () => {
  it('renders the uniform invalid state', async () => {
    vi.mocked(resolveCheckinToken).mockResolvedValue({
      valid: false,
      message: 'This check-in link is no longer valid',
    });

    renderPage();

    expect(await screen.findByText('Link no longer valid')).toBeInTheDocument();
    expect(screen.getByText('This check-in link is no longer valid')).toBeInTheDocument();
  });
});
