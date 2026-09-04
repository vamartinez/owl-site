// @vitest-environment jsdom
/**
 * Integration test: Attachment upload flow.
 * Tests: select file → POST metadata → PUT S3 → confirm.
 *
 * Requirements: 12.4
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEvidenceUpload } from '../../hooks/useEvidenceUpload';
import type { InitiateAttachmentResponse } from '../../types';

// ─── Mock apiClient ──────────────────────────────────────────────────────────

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('@/services/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: vi.fn(),
  },
  ApiClientError: class ApiClientError extends Error {
    status: number;
    code: string;
    details?: Record<string, unknown>;
    constructor(status: number, code: string, details?: Record<string, unknown>) {
      super(`API Error [${status}]: ${code}`);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        isAuthenticated: true,
        role: 'supervisor',
        tenantId: 'tenant-1',
        tokens: { idToken: 'mock-token' },
      }),
    {
      getState: () => ({
        isAuthenticated: true,
        role: 'supervisor',
        tenantId: 'tenant-1',
        tokens: { idToken: 'mock-token' },
      }),
    }
  ),
}));

// ─── Mock useUploadToS3 ──────────────────────────────────────────────────────

const mockUpload = vi.fn();

vi.mock('@/features/certifications/hooks/useUploadToS3', () => ({
  useUploadToS3: () => ({
    upload: mockUpload,
    progress: 100,
    isUploading: false,
    error: null,
    abort: vi.fn(),
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Attachment Upload Flow Integration', () => {
  const incidentId = 'inc-001';
  const testFile = new File(['test image content'], 'photo.jpg', { type: 'image/jpeg' });

  const mockAttachmentResponse: InitiateAttachmentResponse = {
    attachment_id: 'attach-001',
    upload_url: 'https://s3.amazonaws.com/incident-evidence/tenant-1/inc-001/attach-001?X-Amz-Signature=abc',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes full upload flow: POST metadata → PUT S3 → confirm', async () => {
    // Step 1: POST metadata returns presigned URL
    mockPost.mockResolvedValueOnce(mockAttachmentResponse);
    // Step 3: PATCH confirm succeeds
    mockPatch.mockResolvedValueOnce({ confirmed: true });

    const { result } = renderHook(
      () => useEvidenceUpload({ incidentId }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.uploadEvidence({ file: testFile });
    });

    // Verify Step 1: POST metadata to API
    expect(mockPost).toHaveBeenCalledWith(
      `/incidents/${incidentId}/attachments`,
      {
        file_name: 'photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: testFile.size,
        duration_seconds: undefined,
      }
    );

    // Verify Step 2: Upload to S3 with presigned URL
    expect(mockUpload).toHaveBeenCalledWith(testFile, mockAttachmentResponse.upload_url);

    // Verify Step 3: Confirm upload
    expect(mockPatch).toHaveBeenCalledWith(
      `/incidents/${incidentId}/attachments/attach-001/confirm`,
      {}
    );

    // No error
    expect(result.current.error).toBeNull();
  });

  it('includes duration_seconds for video files', async () => {
    const videoFile = new File(['video content'], 'clip.mp4', { type: 'video/mp4' });

    mockPost.mockResolvedValueOnce(mockAttachmentResponse);
    mockPatch.mockResolvedValueOnce({ confirmed: true });

    const { result } = renderHook(
      () => useEvidenceUpload({ incidentId }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.uploadEvidence({ file: videoFile, durationSeconds: 30 });
    });

    expect(mockPost).toHaveBeenCalledWith(
      `/incidents/${incidentId}/attachments`,
      expect.objectContaining({
        mime_type: 'video/mp4',
        duration_seconds: 30,
      })
    );
  });

  it('sets error when POST metadata fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('File must not exceed 50 MB'));

    const { result } = renderHook(
      () => useEvidenceUpload({ incidentId }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      try {
        await result.current.uploadEvidence({ file: testFile });
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe('File must not exceed 50 MB');
    // S3 upload should not have been attempted
    expect(mockUpload).not.toHaveBeenCalled();
    // Confirm should not have been called
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('sets error when S3 upload fails', async () => {
    mockPost.mockResolvedValueOnce(mockAttachmentResponse);
    mockUpload.mockRejectedValueOnce(new Error('Document upload failed. Please try again.'));

    const { result } = renderHook(
      () => useEvidenceUpload({ incidentId }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      try {
        await result.current.uploadEvidence({ file: testFile });
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe('Document upload failed. Please try again.');
    // Confirm should not have been called since S3 upload failed
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('sets error when confirm fails', async () => {
    mockPost.mockResolvedValueOnce(mockAttachmentResponse);
    mockPatch.mockRejectedValueOnce(new Error('Failed to confirm upload'));

    const { result } = renderHook(
      () => useEvidenceUpload({ incidentId }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      try {
        await result.current.uploadEvidence({ file: testFile });
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.error).toBe('Failed to confirm upload');
  });

  it('can confirm upload separately via confirmUpload', async () => {
    mockPatch.mockResolvedValueOnce({ confirmed: true });

    const { result } = renderHook(
      () => useEvidenceUpload({ incidentId }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      await result.current.confirmUpload('attach-002');
    });

    expect(mockPatch).toHaveBeenCalledWith(
      `/incidents/${incidentId}/attachments/attach-002/confirm`,
      {}
    );
  });

  it('resets error state via reset()', async () => {
    mockPost.mockRejectedValueOnce(new Error('Upload failed'));

    const { result } = renderHook(
      () => useEvidenceUpload({ incidentId }),
      { wrapper: createWrapper() }
    );

    await act(async () => {
      try {
        await result.current.uploadEvidence({ file: testFile });
      } catch {
        // Expected
      }
    });

    expect(result.current.error).toBe('Upload failed');

    act(() => {
      result.current.reset();
    });

    expect(result.current.error).toBeNull();
  });
});
