// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useUploadToS3 } from '../hooks/useUploadToS3';

// Mock XMLHttpRequest
class MockXHR {
  static instances: MockXHR[] = [];

  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  setRequestHeader = vi.fn();
  status = 200;
  upload = {
    onprogress: null as ((event: Partial<ProgressEvent>) => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    MockXHR.instances.push(this);
  }

  // Helper to simulate progress event
  simulateProgress(loaded: number, total: number) {
    if (this.upload.onprogress) {
      this.upload.onprogress({ lengthComputable: true, loaded, total });
    }
  }

  // Helper to simulate successful load
  simulateSuccess(status = 200) {
    this.status = status;
    if (this.onload) this.onload();
  }

  // Helper to simulate error
  simulateError() {
    if (this.onerror) this.onerror();
  }

  // Helper to simulate abort
  simulateAbort() {
    if (this.onabort) this.onabort();
  }
}

function getLatestXhr(): MockXHR {
  return MockXHR.instances[MockXHR.instances.length - 1]!;
}

beforeEach(() => {
  MockXHR.instances = [];
  vi.stubGlobal('XMLHttpRequest', vi.fn(() => new MockXHR()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUploadToS3', () => {
  const testFile = new File(['test content'], 'test.pdf', { type: 'application/pdf' });
  const signedUrl = 'https://s3.amazonaws.com/bucket/key?signature=abc';

  describe('Progress updates (Requirement 5.1)', () => {
    it('updates progress as upload progresses', async () => {
      const { result } = renderHook(() => useUploadToS3());

      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.upload(testFile, signedUrl);
      });

      const xhr = MockXHR.instances[0]!;

      // Simulate progress events
      act(() => {
        xhr.simulateProgress(50, 100);
      });
      expect(result.current.progress).toBe(50);
      expect(result.current.isUploading).toBe(true);

      act(() => {
        xhr.simulateProgress(75, 100);
      });
      expect(result.current.progress).toBe(75);

      // Complete the upload
      act(() => {
        xhr.simulateSuccess();
      });

      await act(async () => {
        await uploadPromise!;
      });

      expect(result.current.progress).toBe(100);
      expect(result.current.isUploading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('starts with progress at 0 and isUploading false', () => {
      const { result } = renderHook(() => useUploadToS3());

      expect(result.current.progress).toBe(0);
      expect(result.current.isUploading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('sets correct Content-Type header on XHR', async () => {
      const { result } = renderHook(() => useUploadToS3());

      act(() => {
        result.current.upload(testFile, signedUrl);
      });

      const xhr = MockXHR.instances[0]!;
      expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(xhr.open).toHaveBeenCalledWith('PUT', signedUrl);

      // Cleanup
      act(() => {
        xhr.simulateSuccess();
      });
    });
  });

  describe('Retry on failure (Requirement 2.12)', () => {
    it('retries once on first failure and succeeds on retry', async () => {
      const { result } = renderHook(() => useUploadToS3());

      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.upload(testFile, signedUrl);
      });

      // First attempt fails
      const firstXhr = MockXHR.instances[0]!;

      await act(async () => {
        firstXhr.simulateError();
        // Allow microtask for retry to create new XHR
        await Promise.resolve();
      });

      // Retry attempt succeeds
      const retryXhr = getLatestXhr();
      await act(async () => {
        retryXhr.simulateSuccess();
        await uploadPromise!;
      });

      expect(result.current.isUploading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.progress).toBe(100);
    });

    it('sets error when both attempts fail', async () => {
      const { result } = renderHook(() => useUploadToS3());

      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.upload(testFile, signedUrl).catch(() => {});
      });

      // First attempt fails
      const firstXhr = MockXHR.instances[0]!;

      await act(async () => {
        firstXhr.simulateError();
        // Allow microtask for retry to create new XHR
        await Promise.resolve();
      });

      // Retry also fails
      const retryXhr = getLatestXhr();
      await act(async () => {
        retryXhr.simulateError();
        await uploadPromise;
      });

      expect(result.current.isUploading).toBe(false);
      expect(result.current.error).toBe('Document upload failed. Please try again.');
    });

    it('resets progress to 0 before retry', async () => {
      const { result } = renderHook(() => useUploadToS3());

      let uploadPromise: Promise<void>;
      act(() => {
        uploadPromise = result.current.upload(testFile, signedUrl);
      });

      // First attempt: progress to 50%, then fail
      const firstXhr = MockXHR.instances[0]!;
      act(() => {
        firstXhr.simulateProgress(50, 100);
      });
      expect(result.current.progress).toBe(50);

      await act(async () => {
        firstXhr.simulateError();
        // Allow microtask for retry to create new XHR
        await Promise.resolve();
      });

      // Progress should reset to 0 for retry
      expect(result.current.progress).toBe(0);

      // Retry succeeds
      const retryXhr = getLatestXhr();
      await act(async () => {
        retryXhr.simulateSuccess();
        await uploadPromise!;
      });
    });
  });

  describe('Abort on unmount (Requirement 5.4)', () => {
    it('aborts in-flight upload when hook unmounts', () => {
      const { result, unmount } = renderHook(() => useUploadToS3());

      act(() => {
        result.current.upload(testFile, signedUrl);
      });

      const xhr = MockXHR.instances[0]!;

      unmount();

      expect(xhr.abort).toHaveBeenCalled();
    });

    it('does not retry when upload is aborted', async () => {
      const { result } = renderHook(() => useUploadToS3());

      let uploadError: Error | null = null;
      act(() => {
        result.current.upload(testFile, signedUrl).catch((e) => {
          uploadError = e;
        });
      });

      const xhr = MockXHR.instances[0]!;

      // Manually abort
      act(() => {
        result.current.abort();
        xhr.simulateAbort();
      });

      // Wait for async operations
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Should not have created a second XHR (no retry)
      expect(MockXHR.instances.length).toBe(1);
      expect(result.current.isUploading).toBe(false);
    });

    it('abort() can be called safely when no upload is in progress', () => {
      const { result } = renderHook(() => useUploadToS3());

      // Should not throw
      expect(() => {
        act(() => {
          result.current.abort();
        });
      }).not.toThrow();
    });
  });
});
