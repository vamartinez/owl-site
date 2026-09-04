import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseUploadToS3Return {
  upload: (file: File, signedUrl: string) => Promise<void>;
  progress: number;
  isUploading: boolean;
  error: string | null;
  abort: () => void;
}

/**
 * Hook for uploading files directly to S3 via a pre-signed URL.
 * Uses XMLHttpRequest for native upload progress tracking.
 * Implements single retry on first failure and abort on unmount.
 */
export function useUploadToS3(): UseUploadToS3Return {
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const abortedRef = useRef(false);

  // Abort in-flight upload on unmount
  useEffect(() => {
    return () => {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
    };
  }, []);

  const performUpload = useCallback(
    (file: File, signedUrl: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setProgress(percent);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100);
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => {
          reject(new Error('Network error during upload'));
        };

        xhr.onabort = () => {
          reject(new Error('Upload aborted'));
        };

        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });
    },
    []
  );

  const upload = useCallback(
    async (file: File, signedUrl: string): Promise<void> => {
      setError(null);
      setProgress(0);
      setIsUploading(true);
      abortedRef.current = false;

      try {
        await performUpload(file, signedUrl);
      } catch (firstError) {
        // If aborted, do not retry
        if (abortedRef.current) {
          setIsUploading(false);
          throw firstError;
        }

        // Single retry on first failure
        try {
          setProgress(0);
          await performUpload(file, signedUrl);
        } catch (retryError) {
          // If aborted during retry, don't set error message
          if (abortedRef.current) {
            setIsUploading(false);
            throw retryError;
          }

          const errorMessage = 'Document upload failed. Please try again.';
          setError(errorMessage);
          setIsUploading(false);
          throw new Error(errorMessage);
        }
      }

      setIsUploading(false);
    },
    [performUpload]
  );

  const abort = useCallback(() => {
    abortedRef.current = true;
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
  }, []);

  return { upload, progress, isUploading, error, abort };
}
