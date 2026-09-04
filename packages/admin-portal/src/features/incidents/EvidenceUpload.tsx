import { useState, useCallback, useRef, type DragEvent, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { UploadProgressBar } from '@/features/certifications/UploadProgressBar';
import { useEvidenceUpload } from './hooks/useEvidenceUpload';
import {
  ALLOWED_EVIDENCE_TYPES,
  MAX_FILE_SIZE,
  MAX_VIDEO_DURATION_SECONDS,
  VIDEO_MIME_TYPES,
  FILE_TYPE_LABELS,
} from './constants';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EvidenceUploadProps {
  incidentId: string;
  disabled?: boolean;
}

interface ValidationError {
  fileName: string;
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACCEPT_STRING = ALLOWED_EVIDENCE_TYPES.join(',');

const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / (1024 * 1024);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isVideoType(mimeType: string): boolean {
  return (VIDEO_MIME_TYPES as readonly string[]).includes(mimeType);
}

function isAllowedType(mimeType: string): boolean {
  return (ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Reads video duration from a File using an HTMLVideoElement.
 * Returns duration in seconds, or undefined if not determinable.
 */
function getVideoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      resolve(undefined);
    };

    video.src = URL.createObjectURL(file);
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * EvidenceUpload — file upload with drag-and-drop, progress bar,
 * client-side validation (type, size, video duration), camera capture on mobile,
 * and single retry on failure.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 22.2
 */
export function EvidenceUpload({ incidentId, disabled = false }: EvidenceUploadProps) {
  const { uploadEvidence, isUploading, uploadProgress, error: uploadError, reset } =
    useEvidenceUpload({ incidentId });

  const [isDragOver, setIsDragOver] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const retryCountRef = useRef(0);
  const lastFileRef = useRef<{ file: File; durationSeconds?: number } | null>(null);

  // ─── Validation ──────────────────────────────────────────────────────────

  const validateFile = useCallback(
    async (file: File): Promise<ValidationError | null> => {
      // Check MIME type
      if (!isAllowedType(file.type)) {
        const allowedLabels = Object.values(FILE_TYPE_LABELS).join(', ');
        return {
          fileName: file.name,
          message: `File type "${file.type || 'unknown'}" is not allowed. Accepted types: ${allowedLabels}.`,
        };
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        return {
          fileName: file.name,
          message: `File size (${formatFileSize(file.size)}) exceeds the ${MAX_FILE_SIZE_MB} MB limit.`,
        };
      }

      // Check video duration
      if (isVideoType(file.type)) {
        const duration = await getVideoDuration(file);
        if (duration !== undefined && duration > MAX_VIDEO_DURATION_SECONDS) {
          return {
            fileName: file.name,
            message: `Video duration (${Math.round(duration)}s) exceeds the ${MAX_VIDEO_DURATION_SECONDS} second limit.`,
          };
        }
      }

      return null;
    },
    []
  );

  // ─── Upload with single retry ────────────────────────────────────────────

  const handleUpload = useCallback(
    async (file: File, durationSeconds?: number) => {
      setValidationErrors([]);
      setCurrentFileName(file.name);
      retryCountRef.current = 0;
      lastFileRef.current = { file, durationSeconds };

      try {
        await uploadEvidence({ file, durationSeconds });
        setCurrentFileName(null);
        lastFileRef.current = null;
      } catch {
        // Single retry on failure
        if (retryCountRef.current < 1) {
          retryCountRef.current += 1;
          try {
            reset();
            await uploadEvidence({ file, durationSeconds });
            setCurrentFileName(null);
            lastFileRef.current = null;
          } catch {
            // Retry failed — error is surfaced via uploadError from the hook
          }
        }
      }
    },
    [uploadEvidence, reset]
  );

  // ─── File Processing ─────────────────────────────────────────────────────

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const errors: ValidationError[] = [];

      for (const file of fileArray) {
        const validationError = await validateFile(file);
        if (validationError) {
          errors.push(validationError);
        } else {
          // Get video duration if applicable
          let durationSeconds: number | undefined;
          if (isVideoType(file.type)) {
            durationSeconds = await getVideoDuration(file);
          }
          // Upload valid file (one at a time)
          await handleUpload(file, durationSeconds);
        }
      }

      if (errors.length > 0) {
        setValidationErrors(errors);
      }
    },
    [validateFile, handleUpload]
  );

  // ─── Drag & Drop Handlers ────────────────────────────────────────────────

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !isUploading) {
        setIsDragOver(true);
      }
    },
    [disabled, isUploading]
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (disabled || isUploading) return;

      const { files } = e.dataTransfer;
      if (files.length > 0) {
        processFiles(files);
      }
    },
    [disabled, isUploading, processFiles]
  );

  // ─── File Input Handlers ─────────────────────────────────────────────────

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const { files } = e.target;
      if (files && files.length > 0) {
        processFiles(files);
      }
      // Reset input so the same file can be re-selected
      e.target.value = '';
    },
    [processFiles]
  );

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleCameraClick = useCallback(() => {
    cameraInputRef.current?.click();
  }, []);

  const handleDismissErrors = useCallback(() => {
    setValidationErrors([]);
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────

  const isDisabled = disabled || isUploading;

  return (
    <Card>
      <CardHeader
        title="Evidence"
        description="Attach photos, videos, or documents as evidence"
      />
      <CardContent>
        {/* Drag-and-drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative flex flex-col items-center justify-center gap-3 p-6
            border-2 border-dashed rounded-lg transition-colors
            ${isDragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-300 bg-gray-50'}
            ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-gray-400'}
          `}
          role="button"
          tabIndex={isDisabled ? -1 : 0}
          aria-label="Drop files here or click to browse"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleBrowseClick();
            }
          }}
        >
          {/* Upload icon */}
          <svg
            className="w-10 h-10 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>

          <div className="text-center">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-primary-600">Click to upload</span> or drag and
              drop
            </p>
            <p className="mt-1 text-xs text-gray-500">
              JPEG, PNG, HEIC, MP4, MOV, or PDF — max {MAX_FILE_SIZE_MB} MB
            </p>
            <p className="text-xs text-gray-500">
              Videos must be {MAX_VIDEO_DURATION_SECONDS} seconds or less
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBrowseClick}
            disabled={isDisabled}
            type="button"
          >
            Browse Files
          </Button>

          {/* Camera capture button — uses browser media capture API for mobile */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCameraClick}
            disabled={isDisabled}
            type="button"
          >
            📷 Take Photo
          </Button>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_STRING}
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Camera capture input — uses capture="environment" for mobile rear camera */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Upload progress */}
        {isUploading && currentFileName && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-gray-700">
              Uploading: <span className="font-medium">{currentFileName}</span>
            </p>
            <UploadProgressBar progress={uploadProgress} />
          </div>
        )}

        {/* Upload error */}
        {uploadError && !isUploading && (
          <div
            className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md"
            role="alert"
          >
            <p className="text-sm text-red-700">
              Upload failed: {uploadError}
            </p>
            <p className="mt-1 text-xs text-red-600">
              Please try again.
            </p>
          </div>
        )}

        {/* Validation errors (inline rejection messages) */}
        {validationErrors.length > 0 && (
          <div className="mt-3 space-y-2" role="alert" aria-live="polite">
            {validationErrors.map((err, idx) => (
              <div
                key={`${err.fileName}-${idx}`}
                className="p-3 bg-amber-50 border border-amber-200 rounded-md"
              >
                <p className="text-sm font-medium text-amber-800">{err.fileName}</p>
                <p className="text-sm text-amber-700">{err.message}</p>
              </div>
            ))}
            <button
              type="button"
              onClick={handleDismissErrors}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
