// @vitest-environment jsdom
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useUploadAndAnalyze } from '../useUploadAndAnalyze';
import { apiClient } from '@/services/api-client';

vi.mock('@/services/api-client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

const mockedPost = vi.mocked(apiClient.post);

/**
 * jsdom's HTMLImageElement doesn't decode real bytes, so we stub `src` to
 * synchronously fire onload with deterministic natural dimensions. This lets us
 * exercise the full orchestration without a real image.
 */
function stubImageDimensions(width: number, height: number) {
  Object.defineProperty(global.Image.prototype, 'src', {
    configurable: true,
    set() {
      Object.defineProperty(this, 'naturalWidth', { configurable: true, value: width });
      Object.defineProperty(this, 'naturalHeight', { configurable: true, value: height });
      // Fire asynchronously to mimic real image load ordering
      setTimeout(() => this.onload?.(), 0);
    },
  });
}

function makeFile(name = 'jobsite.jpg', type = 'image/jpeg', size = 1024): File {
  const file = new File(['x'.repeat(size)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = vi.fn();
  stubImageDimensions(1920, 1080);
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUploadAndAnalyze', () => {
  it('drives the three real pipeline endpoints in order and PUTs bytes to S3', async () => {
    mockedPost
      .mockResolvedValueOnce({ inspection: { inspection_id: 'insp-1', site_id: 'site-1', status: 'created' } })
      .mockResolvedValueOnce({
        asset_id: 'asset-1',
        upload_url: 'https://s3.example/upload',
        s3_key: 'inspections/t/insp-1/asset-1.jpg',
        expires_in: 900,
      })
      .mockResolvedValueOnce({
        message: 'AI analysis pipeline initiated',
        inspection_id: 'insp-1',
        event_id: 'evt-1',
        status: 'analyzing',
      });

    const { result } = renderHook(() => useUploadAndAnalyze());

    await act(async () => {
      await result.current.run({
        siteId: 'site-1',
        trade: 'Electrical',
        projectPhase: 'Framing',
        file: makeFile(),
      });
    });

    // Endpoint 1: create inspection with site context
    expect(mockedPost).toHaveBeenNthCalledWith(1, '/inspections', {
      site_id: 'site-1',
      trade: 'Electrical',
      project_phase: 'Framing',
    });

    // Endpoint 2: request signed URL with real image metadata (dimensions read client-side)
    expect(mockedPost).toHaveBeenNthCalledWith(2, '/inspections/insp-1/media', {
      file_name: 'jobsite.jpg',
      content_type: 'image/jpeg',
      file_size: 1024,
      width: 1920,
      height: 1080,
    });

    // S3 PUT of the raw bytes (not through apiClient)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://s3.example/upload',
      expect.objectContaining({ method: 'PUT' })
    );

    // Endpoint 3: trigger analysis
    expect(mockedPost).toHaveBeenNthCalledWith(3, '/inspections/insp-1/analyze', {});

    await waitFor(() => expect(result.current.stage).toBe('analyzing'));
    expect(result.current.result?.inspectionId).toBe('insp-1');
    expect(result.current.result?.eventId).toBe('evt-1');
    expect(result.current.error).toBeNull();
  });

  it('surfaces an error and stops if inspection creation fails', async () => {
    mockedPost.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useUploadAndAnalyze());

    await act(async () => {
      await result.current.run({
        siteId: 'site-1',
        trade: 'General',
        projectPhase: 'Construction',
        file: makeFile(),
      });
    });

    expect(result.current.stage).toBe('error');
    expect(result.current.error).toBe('boom');
    // No media/analyze calls after the failure
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports an error if the S3 upload fails', async () => {
    mockedPost
      .mockResolvedValueOnce({ inspection: { inspection_id: 'insp-2', site_id: 'site-1', status: 'created' } })
      .mockResolvedValueOnce({
        asset_id: 'asset-2',
        upload_url: 'https://s3.example/upload',
        s3_key: 'k',
        expires_in: 900,
      });
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response);

    const { result } = renderHook(() => useUploadAndAnalyze());

    await act(async () => {
      await result.current.run({
        siteId: 'site-1',
        trade: 'General',
        projectPhase: 'Construction',
        file: makeFile(),
      });
    });

    expect(result.current.stage).toBe('error');
    expect(result.current.error).toContain('storage');
    // analyze must NOT be called if the upload failed
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });
});
