// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useDocumentDownload } from '../hooks/useDocumentDownload';
import { useDocExplorerStore } from '../store';
import * as api from '../api';

// Mock the API module
vi.mock('../api', () => ({
  initiateDownload: vi.fn(),
  pollDownloadStatus: vi.fn(),
}));

// Mock window.open
const mockWindowOpen = vi.fn();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useDocumentDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.open = mockWindowOpen;
    useDocExplorerStore.setState({ activeDownload: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns expected interface', () => {
    const { result } = renderHook(() => useDocumentDownload(), {
      wrapper: createWrapper(),
    });

    expect(result.current.startDownload).toBeInstanceOf(Function);
    expect(result.current.reset).toBeInstanceOf(Function);
    expect(result.current.isInitiating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('rejects download when batch size exceeds 500MB', () => {
    const { result } = renderHook(() => useDocumentDownload(), {
      wrapper: createWrapper(),
    });

    const largeDocuments = [
      { id: 'doc-1', fileSize: 300 * 1024 * 1024 },
      { id: 'doc-2', fileSize: 250 * 1024 * 1024 },
    ];

    act(() => {
      result.current.startDownload(largeDocuments);
    });

    const state = useDocExplorerStore.getState();
    expect(state.activeDownload?.status).toBe('failed');
    expect(state.activeDownload?.errorMessage).toContain('500 MB');
    expect(api.initiateDownload).not.toHaveBeenCalled();
  });

  it('does nothing when documents array is empty', () => {
    const { result } = renderHook(() => useDocumentDownload(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.startDownload([]);
    });

    expect(api.initiateDownload).not.toHaveBeenCalled();
    expect(useDocExplorerStore.getState().activeDownload).toBeNull();
  });

  it('opens presigned URL directly for single document download', async () => {
    vi.mocked(api.initiateDownload).mockResolvedValue({
      downloadId: 'dl-123',
      downloadUrl: 'https://s3.example.com/doc.pdf',
      expiresAt: '2024-12-31T23:59:59Z',
      totalSize: 1024,
      fileCount: 1,
    });

    const { result } = renderHook(() => useDocumentDownload(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.startDownload([{ id: 'doc-1', fileSize: 1024 }]);
    });

    await waitFor(() => {
      const state = useDocExplorerStore.getState();
      expect(state.activeDownload?.status).toBe('complete');
    });

    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://s3.example.com/doc.pdf',
      '_blank',
    );
    expect(api.pollDownloadStatus).not.toHaveBeenCalled();
  });

  it('polls batch download status for multiple documents', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    vi.mocked(api.initiateDownload).mockResolvedValue({
      downloadId: 'dl-batch-1',
      downloadUrl: '',
      expiresAt: '2024-12-31T23:59:59Z',
      totalSize: 5000,
      fileCount: 3,
    });

    vi.mocked(api.pollDownloadStatus)
      .mockResolvedValueOnce({
        downloadId: 'dl-batch-1',
        status: 'preparing',
        progress: 50,
      })
      .mockResolvedValueOnce({
        downloadId: 'dl-batch-1',
        status: 'ready',
        progress: 100,
        downloadUrl: 'https://s3.example.com/batch.zip',
      });

    const { result } = renderHook(() => useDocumentDownload(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.startDownload([
        { id: 'doc-1', fileSize: 2000 },
        { id: 'doc-2', fileSize: 1500 },
        { id: 'doc-3', fileSize: 1500 },
      ]);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(useDocExplorerStore.getState().activeDownload?.status).toBe('packaging');
    });

    // First poll interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Second poll interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => {
      const state = useDocExplorerStore.getState();
      expect(state.activeDownload?.status).toBe('complete');
    });

    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://s3.example.com/batch.zip',
      '_blank',
    );
  });

  it('handles partial failures in batch download', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    vi.mocked(api.initiateDownload).mockResolvedValue({
      downloadId: 'dl-partial',
      downloadUrl: '',
      expiresAt: '2024-12-31T23:59:59Z',
      totalSize: 3000,
      fileCount: 3,
    });

    vi.mocked(api.pollDownloadStatus).mockResolvedValue({
      downloadId: 'dl-partial',
      status: 'ready',
      progress: 100,
      downloadUrl: 'https://s3.example.com/partial.zip',
      skippedDocuments: [
        { id: 'doc-3', name: 'missing.pdf', reason: 'File not found' },
      ],
    });

    const { result } = renderHook(() => useDocumentDownload(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.startDownload([
        { id: 'doc-1', fileSize: 1000 },
        { id: 'doc-2', fileSize: 1000 },
        { id: 'doc-3', fileSize: 1000 },
      ]);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(useDocExplorerStore.getState().activeDownload?.status).toBe('packaging');
    });

    // First poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => {
      const state = useDocExplorerStore.getState();
      expect(state.activeDownload?.status).toBe('complete');
      expect(state.activeDownload?.errorMessage).toContain('Skipped');
      expect(state.activeDownload?.errorMessage).toContain('missing.pdf');
    });
  });

  it('sets timeout status after 120 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    vi.mocked(api.initiateDownload).mockResolvedValue({
      downloadId: 'dl-timeout',
      downloadUrl: '',
      expiresAt: '2024-12-31T23:59:59Z',
      totalSize: 10000,
      fileCount: 5,
    });

    // Always return preparing
    vi.mocked(api.pollDownloadStatus).mockResolvedValue({
      downloadId: 'dl-timeout',
      status: 'preparing',
      progress: 10,
    });

    const { result } = renderHook(() => useDocumentDownload(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.startDownload([
        { id: 'doc-1', fileSize: 2000 },
        { id: 'doc-2', fileSize: 2000 },
        { id: 'doc-3', fileSize: 2000 },
        { id: 'doc-4', fileSize: 2000 },
        { id: 'doc-5', fileSize: 2000 },
      ]);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(useDocExplorerStore.getState().activeDownload?.status).toBe('packaging');
    });

    // Advance past 120 seconds
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    await waitFor(() => {
      const state = useDocExplorerStore.getState();
      expect(state.activeDownload?.status).toBe('timeout');
      expect(state.activeDownload?.errorMessage).toContain('120 seconds');
    });
  });

  it('handles server-side download failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    vi.mocked(api.initiateDownload).mockResolvedValue({
      downloadId: 'dl-fail',
      downloadUrl: '',
      expiresAt: '2024-12-31T23:59:59Z',
      totalSize: 3000,
      fileCount: 2,
    });

    vi.mocked(api.pollDownloadStatus).mockResolvedValue({
      downloadId: 'dl-fail',
      status: 'failed',
      progress: 0,
      errorMessage: 'Internal server error',
    });

    const { result } = renderHook(() => useDocumentDownload(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.startDownload([
        { id: 'doc-1', fileSize: 1500 },
        { id: 'doc-2', fileSize: 1500 },
      ]);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(useDocExplorerStore.getState().activeDownload?.status).toBe('packaging');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => {
      const state = useDocExplorerStore.getState();
      expect(state.activeDownload?.status).toBe('failed');
      expect(state.activeDownload?.errorMessage).toBe('Internal server error');
    });
  });

  it('reset clears download state', async () => {
    vi.mocked(api.initiateDownload).mockResolvedValue({
      downloadId: 'dl-reset',
      downloadUrl: 'https://s3.example.com/doc.pdf',
      expiresAt: '2024-12-31T23:59:59Z',
      totalSize: 1024,
      fileCount: 1,
    });

    const { result } = renderHook(() => useDocumentDownload(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.startDownload([{ id: 'doc-1', fileSize: 1024 }]);
    });

    await waitFor(() => {
      expect(useDocExplorerStore.getState().activeDownload).not.toBeNull();
    });

    act(() => {
      result.current.reset();
    });

    expect(useDocExplorerStore.getState().activeDownload).toBeNull();
  });
});
