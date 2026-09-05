// @vitest-environment jsdom
/**
 * Tests for SendCheckinLinkButton.
 *
 * With a siteId prop the picker is skipped, so we can test send + success
 * without also mocking the /sites query.
 *
 * Note: the shared Modal renders a <dialog> and relies on showModal() (stubbed
 * in jsdom). Without the `open` attribute jsdom hides dialog descendants from
 * the accessibility ROLE tree, so we query modal-inner controls by text.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the shared apiClient used by the mutation hook.
vi.mock('@/services/api-client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import { apiClient } from '@/services/api-client';
import { SendCheckinLinkButton } from '../SendCheckinLinkButton';

function renderButton(props: { workerId: string; siteId?: string; workerName?: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(SendCheckinLinkButton, props)
    )
  );
}

beforeEach(() => {
  // jsdom does not implement HTMLDialogElement methods — mock as the repo does.
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  vi.mocked(apiClient.post).mockReset();
});

afterEach(() => cleanup());

describe('SendCheckinLinkButton', () => {
  it('opens the modal on click', () => {
    renderButton({ workerId: 'w1', siteId: 's1', workerName: 'Jane' });

    expect(screen.queryByText('Send SMS check-in link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Send check-in link'));
    expect(screen.getByText('Send SMS check-in link')).toBeInTheDocument();
  });

  it('sends the SMS link with the preselected site and shows success', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      sent: true,
      expires_at: '2026-09-04T22:00:00Z',
    });

    renderButton({ workerId: 'w1', siteId: 's1', workerName: 'Jane' });
    fireEvent.click(screen.getByText('Send check-in link'));

    // No site picker when siteId is provided.
    expect(screen.queryByLabelText('Site')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Send link'));

    expect(await screen.findByText('Link sent')).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith('/checkin/sms-link', {
      worker_id: 'w1',
      site_id: 's1',
    });
  });

  it('surfaces the error when the send fails', async () => {
    const err = Object.assign(new Error('SMS delivery failed'), { status: 502 });
    vi.mocked(apiClient.post).mockRejectedValueOnce(err);

    renderButton({ workerId: 'w1', siteId: 's1', workerName: 'Jane' });
    fireEvent.click(screen.getByText('Send check-in link'));
    fireEvent.click(screen.getByText('Send link'));

    expect(await screen.findByText('SMS delivery failed')).toBeInTheDocument();
  });

  it('closes and resets on cancel', () => {
    renderButton({ workerId: 'w1', siteId: 's1' });
    fireEvent.click(screen.getByText('Send check-in link'));
    expect(screen.getByText('Send SMS check-in link')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Send SMS check-in link')).not.toBeInTheDocument();
  });
});
