// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommentsSection } from '../CommentsSection';
import type { IncidentComment } from '../types';

// Mock the hooks
vi.mock('../hooks/useIncidentComments', () => ({
  useIncidentComments: vi.fn(),
  useAddComment: vi.fn(),
}));

import { useIncidentComments, useAddComment } from '../hooks/useIncidentComments';

const mockedUseIncidentComments = vi.mocked(useIncidentComments);
const mockedUseAddComment = vi.mocked(useAddComment);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const mockComment1: IncidentComment = {
  comment_id: 'cmt-1',
  incident_id: 'inc-1',
  tenant_id: 'tenant-1',
  author_id: 'user-1',
  author_name: 'John Smith',
  content: 'Initial investigation started. Witnesses interviewed.',
  created_at: '2024-06-15T14:30:00.000Z',
};

const mockComment2: IncidentComment = {
  comment_id: 'cmt-2',
  incident_id: 'inc-1',
  tenant_id: 'tenant-1',
  author_id: 'user-2',
  author_name: 'Jane Doe',
  content: 'Safety equipment inspection completed. No defects found.',
  created_at: '2024-06-15T16:00:00.000Z',
};

function mockAddCommentHook(overrides: Partial<ReturnType<typeof useAddComment>> = {}) {
  const defaultMock = {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
  };
  mockedUseAddComment.mockReturnValue(defaultMock as any);
  return defaultMock;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CommentsSection', () => {
  it('displays loading skeleton while comments are loading', () => {
    mockedUseIncidentComments.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    mockAddCommentHook();

    render(
      createElement(CommentsSection, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Comments')).toBeInTheDocument();
    const pulseElements = document.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it('displays error state with retry button when fetch fails', () => {
    const mockRefetch = vi.fn();
    mockedUseIncidentComments.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Network error'),
      refetch: mockRefetch,
    } as any);
    mockAddCommentHook();

    render(
      createElement(CommentsSection, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Failed to load comments')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();

    const retryButton = screen.getByText('Reintentar');
    fireEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('displays empty state when no comments exist', () => {
    mockedUseIncidentComments.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    mockAddCommentHook();

    render(
      createElement(CommentsSection, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('No comments yet. Add the first comment below.')).toBeInTheDocument();
  });

  it('renders comments in chronological order with author and timestamp', () => {
    mockedUseIncidentComments.mockReturnValue({
      data: [mockComment1, mockComment2],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    mockAddCommentHook();

    render(
      createElement(CommentsSection, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Initial investigation started. Witnesses interviewed.')).toBeInTheDocument();
    expect(screen.getByText('Safety equipment inspection completed. No defects found.')).toBeInTheDocument();
    // Timestamps contain UTC
    const utcElements = screen.getAllByText(/UTC/);
    expect(utcElements.length).toBe(2);
  });

  it('shows inline validation error for empty comment submission', async () => {
    mockedUseIncidentComments.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    mockAddCommentHook();

    render(
      createElement(CommentsSection, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    const submitButton = screen.getByText('Add Comment');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Comment cannot be empty')).toBeInTheDocument();
    });
  });

  it('calls addComment.mutate with correct data on valid submission', async () => {
    mockedUseIncidentComments.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    const mockMutate = vi.fn();
    mockAddCommentHook({ mutate: mockMutate });

    render(
      createElement(CommentsSection, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.change(textarea, { target: { value: 'New investigation note' } });

    const submitButton = screen.getByText('Add Comment');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        { incidentId: 'inc-1', content: 'New investigation note' },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        })
      );
    });
  });

  it('shows character count indicator', () => {
    mockedUseIncidentComments.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    mockAddCommentHook();

    render(
      createElement(CommentsSection, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('0/5000')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText('Add a comment...');
    fireEvent.change(textarea, { target: { value: 'Hello' } });

    expect(screen.getByText('5/5000')).toBeInTheDocument();
  });

  it('disables submit button while mutation is pending', () => {
    mockedUseIncidentComments.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    mockAddCommentHook({ isPending: true });

    render(
      createElement(CommentsSection, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    const submitButton = screen.getByText('Sending...');
    expect(submitButton.closest('button')).toBeDisabled();
  });

  it('shows optimistic comment with "Sending..." indicator', () => {
    const optimisticComment: IncidentComment = {
      comment_id: 'temp-1718456789000',
      incident_id: 'inc-1',
      tenant_id: '',
      author_id: 'user-1',
      author_name: 'You',
      content: 'Optimistic comment text',
      created_at: new Date().toISOString(),
    };

    mockedUseIncidentComments.mockReturnValue({
      data: [optimisticComment],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as any);
    mockAddCommentHook();

    render(
      createElement(CommentsSection, { incidentId: 'inc-1' }),
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Optimistic comment text')).toBeInTheDocument();
    expect(screen.getByText('Sending...')).toBeInTheDocument();
  });
});
