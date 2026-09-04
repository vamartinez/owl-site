/**
 * Hook for handling file uploads via presigned URLs.
 *
 * Flow:
 * 1. User selects a file
 * 2. Client validates type (PDF, JPEG, PNG) and size (<10MB)
 * 3. Requests a presigned URL from POST /public/forms/{token}/upload-url
 * 4. Uploads the file directly to S3 using the presigned URL
 * 5. Stores the file_key for inclusion in form submission
 *
 * Requirements: 11.5
 */

import { useState, useCallback, useRef } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export type UploadStatus = 'idle' | 'validating' | 'requesting_url' | 'uploading' | 'success' | 'error';

export interface FileUploadState {
  status: UploadStatus;
  progress: number; // 0-100
  file: File | null;
  fileKey: string | null;
  error: string | null;
}

export interface UseFileUploadReturn {
  state: FileUploadState;
  upload: (file: File) => Promise<string | null>;
  reset: () => void;
}

interface PresignedUrlResponse {
  upload_url: string;
  fields: Record<string, string>;
  file_key: string;
}

function getMimeType(file: File): string {
  return file.type || 'application/octet-stream';
}

function validateFile(file: File): string | null {
  const mimeType = getMimeType(file);

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return 'Solo se permiten archivos PDF, JPEG o PNG';
  }

  if (file.size > MAX_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return `El archivo excede el tamaño máximo de 10 MB. Tamaño actual: ${sizeMb} MB`;
  }

  return null;
}

async function requestPresignedUrl(
  token: string,
  filename: string,
  contentType: string,
  size: number
): Promise<PresignedUrlResponse> {
  const response = await fetch(`${API_BASE_URL}/public/forms/${token}/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, content_type: contentType, size }),
  });

  if (!response.ok) {
    let errorMessage = 'No se pudo obtener la URL de carga';
    try {
      const body = await response.json();
      if (body.message) errorMessage = body.message;
    } catch {
      // Use default error message
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

function uploadToS3WithProgress(
  uploadUrl: string,
  fields: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Error al subir archivo: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Error de red al subir el archivo'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Carga cancelada'));
    });

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        xhr.abort();
      });
    }

    // Build multipart form data with presigned fields
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      formData.append(key, value);
    }
    formData.append('file', file);

    xhr.open('POST', uploadUrl);
    xhr.send(formData);
  });
}

export function useFileUpload(token: string): UseFileUploadReturn {
  const [state, setState] = useState<FileUploadState>({
    status: 'idle',
    progress: 0,
    file: null,
    fileKey: null,
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    // Abort any in-progress upload
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setState({
      status: 'idle',
      progress: 0,
      file: null,
      fileKey: null,
      error: null,
    });
  }, []);

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      // Abort any previous upload
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Step 1: Client-side validation
      setState({
        status: 'validating',
        progress: 0,
        file,
        fileKey: null,
        error: null,
      });

      const validationError = validateFile(file);
      if (validationError) {
        setState({
          status: 'error',
          progress: 0,
          file,
          fileKey: null,
          error: validationError,
        });
        return null;
      }

      // Step 2: Request presigned URL
      setState((prev) => ({ ...prev, status: 'requesting_url' }));

      let presignedData: PresignedUrlResponse;
      try {
        presignedData = await requestPresignedUrl(
          token,
          file.name,
          getMimeType(file),
          file.size
        );
      } catch (err) {
        if (abortController.signal.aborted) return null;
        setState({
          status: 'error',
          progress: 0,
          file,
          fileKey: null,
          error: err instanceof Error ? err.message : 'Error al solicitar URL de carga',
        });
        return null;
      }

      // Step 3: Upload directly to S3
      setState((prev) => ({ ...prev, status: 'uploading', progress: 0 }));

      try {
        await uploadToS3WithProgress(
          presignedData.upload_url,
          presignedData.fields,
          file,
          (percent) => {
            setState((prev) => ({ ...prev, progress: percent }));
          },
          abortController.signal
        );
      } catch (err) {
        if (abortController.signal.aborted) return null;
        setState({
          status: 'error',
          progress: 0,
          file,
          fileKey: null,
          error: err instanceof Error ? err.message : 'Error al subir el archivo',
        });
        return null;
      }

      // Step 4: Success — store file_key
      const fileKey = presignedData.file_key;
      setState({
        status: 'success',
        progress: 100,
        file,
        fileKey,
        error: null,
      });

      return fileKey;
    },
    [token]
  );

  return { state, upload, reset };
}
