// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileUpload } from '../hooks/useFileUpload';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock XMLHttpRequest
class MockXHR {
  upload = {
    addEventListener: vi.fn(),
  };
  addEventListener = vi.fn();
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  status = 200;
}

let mockXHRInstance: MockXHR;

beforeEach(() => {
  mockXHRInstance = new MockXHR();
  vi.stubGlobal('XMLHttpRequest', vi.fn(() => mockXHRInstance));
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

describe('useFileUpload', () => {
  it('starts with idle state', () => {
    const { result } = renderHook(() => useFileUpload('test-token'));

    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.progress).toBe(0);
    expect(result.current.state.file).toBeNull();
    expect(result.current.state.fileKey).toBeNull();
    expect(result.current.state.error).toBeNull();
  });

  it('rejects files with invalid MIME type', async () => {
    const { result } = renderHook(() => useFileUpload('test-token'));
    const invalidFile = createFile('test.txt', 1024, 'text/plain');

    let uploadResult: string | null = null;
    await act(async () => {
      uploadResult = await result.current.upload(invalidFile);
    });

    expect(uploadResult).toBeNull();
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('Solo se permiten archivos PDF, JPEG o PNG');
  });

  it('rejects files exceeding 10 MB', async () => {
    const { result } = renderHook(() => useFileUpload('test-token'));
    const largeFile = createFile('big.pdf', 11 * 1024 * 1024, 'application/pdf');

    let uploadResult: string | null = null;
    await act(async () => {
      uploadResult = await result.current.upload(largeFile);
    });

    expect(uploadResult).toBeNull();
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toContain('excede el tamaño máximo de 10 MB');
  });

  it('accepts valid PDF files', async () => {
    // Mock presigned URL response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          upload_url: 'https://s3.amazonaws.com/bucket',
          fields: { key: 'forms/tenant/form/file.pdf', 'Content-Type': 'application/pdf' },
          file_key: 'forms/tenant/form/file.pdf',
        }),
    });

    // Mock XHR upload success
    mockXHRInstance.addEventListener = vi.fn((event, handler) => {
      if (event === 'load') {
        // Simulate successful upload after send is called
        setTimeout(() => {
          mockXHRInstance.status = 204;
          (handler as () => void)();
        }, 0);
      }
    });

    const { result } = renderHook(() => useFileUpload('test-token'));
    const validFile = createFile('doc.pdf', 5 * 1024 * 1024, 'application/pdf');

    let uploadResult: string | null = null;
    await act(async () => {
      uploadResult = await result.current.upload(validFile);
    });

    expect(uploadResult).toBe('forms/tenant/form/file.pdf');
    expect(result.current.state.status).toBe('success');
    expect(result.current.state.fileKey).toBe('forms/tenant/form/file.pdf');
    expect(result.current.state.progress).toBe(100);
  });

  it('accepts valid JPEG files', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          upload_url: 'https://s3.amazonaws.com/bucket',
          fields: { key: 'forms/tenant/form/photo.jpg' },
          file_key: 'forms/tenant/form/photo.jpg',
        }),
    });

    mockXHRInstance.addEventListener = vi.fn((event, handler) => {
      if (event === 'load') {
        setTimeout(() => {
          mockXHRInstance.status = 200;
          (handler as () => void)();
        }, 0);
      }
    });

    const { result } = renderHook(() => useFileUpload('test-token'));
    const jpegFile = createFile('photo.jpg', 2 * 1024 * 1024, 'image/jpeg');

    let uploadResult: string | null = null;
    await act(async () => {
      uploadResult = await result.current.upload(jpegFile);
    });

    expect(uploadResult).toBe('forms/tenant/form/photo.jpg');
    expect(result.current.state.status).toBe('success');
  });

  it('accepts valid PNG files', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          upload_url: 'https://s3.amazonaws.com/bucket',
          fields: { key: 'forms/tenant/form/image.png' },
          file_key: 'forms/tenant/form/image.png',
        }),
    });

    mockXHRInstance.addEventListener = vi.fn((event, handler) => {
      if (event === 'load') {
        setTimeout(() => {
          mockXHRInstance.status = 200;
          (handler as () => void)();
        }, 0);
      }
    });

    const { result } = renderHook(() => useFileUpload('test-token'));
    const pngFile = createFile('image.png', 1024 * 1024, 'image/png');

    let uploadResult: string | null = null;
    await act(async () => {
      uploadResult = await result.current.upload(pngFile);
    });

    expect(uploadResult).toBe('forms/tenant/form/image.png');
    expect(result.current.state.status).toBe('success');
  });

  it('handles presigned URL request failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Internal server error' }),
    });

    const { result } = renderHook(() => useFileUpload('test-token'));
    const validFile = createFile('doc.pdf', 1024, 'application/pdf');

    let uploadResult: string | null = null;
    await act(async () => {
      uploadResult = await result.current.upload(validFile);
    });

    expect(uploadResult).toBeNull();
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('Internal server error');
  });

  it('handles S3 upload failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          upload_url: 'https://s3.amazonaws.com/bucket',
          fields: { key: 'forms/tenant/form/file.pdf' },
          file_key: 'forms/tenant/form/file.pdf',
        }),
    });

    // Mock XHR upload failure
    mockXHRInstance.addEventListener = vi.fn((event, handler) => {
      if (event === 'error') {
        setTimeout(() => {
          (handler as () => void)();
        }, 0);
      }
    });

    const { result } = renderHook(() => useFileUpload('test-token'));
    const validFile = createFile('doc.pdf', 1024, 'application/pdf');

    let uploadResult: string | null = null;
    await act(async () => {
      uploadResult = await result.current.upload(validFile);
    });

    expect(uploadResult).toBeNull();
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.error).toBe('Error de red al subir el archivo');
  });

  it('resets state correctly', async () => {
    const { result } = renderHook(() => useFileUpload('test-token'));
    const invalidFile = createFile('test.txt', 1024, 'text/plain');

    await act(async () => {
      await result.current.upload(invalidFile);
    });

    expect(result.current.state.status).toBe('error');

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.progress).toBe(0);
    expect(result.current.state.file).toBeNull();
    expect(result.current.state.fileKey).toBeNull();
    expect(result.current.state.error).toBeNull();
  });

  it('sends correct request to presigned URL endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          upload_url: 'https://s3.amazonaws.com/bucket',
          fields: {},
          file_key: 'forms/tenant/form/doc.pdf',
        }),
    });

    mockXHRInstance.addEventListener = vi.fn((event, handler) => {
      if (event === 'load') {
        setTimeout(() => {
          mockXHRInstance.status = 200;
          (handler as () => void)();
        }, 0);
      }
    });

    const { result } = renderHook(() => useFileUpload('my-token'));
    const file = createFile('doc.pdf', 2048, 'application/pdf');

    await act(async () => {
      await result.current.upload(file);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/public/forms/my-token/upload-url'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'doc.pdf',
          content_type: 'application/pdf',
          size: 2048,
        }),
      })
    );
  });
});
