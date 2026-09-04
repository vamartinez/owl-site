import { useRef, useCallback } from 'react';
import { FieldWrapper } from './FieldWrapper';
import { usePublicFormContext } from '../PublicFormContext';
import { useFileUpload } from '../hooks/useFileUpload';
import type { PublicFieldProps } from './types';

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ALLOWED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png';
const MAX_SIZE_MB = 10;

export function CargaArchivoField({
  field,
  value,
  error,
  onChange,
  onBlur,
}: PublicFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { token, setFileKey } = usePublicFormContext();
  const { state: uploadState, upload, reset: resetUpload } = useFileUpload(token);

  // The value stored in form state is the file_key (string) after successful upload
  const fileKey = typeof value === 'string' ? value : null;
  const displayFile = uploadState.file;

  const describedBy = [
    error ? `${field.field_id}-error` : '',
    field.help_text ? `${field.field_id}-help` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0] || null;
      if (!selected) return;

      // Start upload process
      const resultKey = await upload(selected);

      if (resultKey) {
        // Upload succeeded — store file_key as the field value
        onChange(resultKey);
        setFileKey(field.field_id, resultKey);
      }
      // If upload failed, the error is shown via uploadState.error
    },
    [upload, onChange, setFileKey, field.field_id]
  );

  const handleRemove = useCallback(() => {
    onChange(null);
    setFileKey(field.field_id, null);
    resetUpload();
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, [onChange, setFileKey, field.field_id, resetUpload]);

  // Determine the error to display: validation error from form or upload error
  const displayError = error || uploadState.error || undefined;

  const isUploading =
    uploadState.status === 'uploading' ||
    uploadState.status === 'requesting_url' ||
    uploadState.status === 'validating';

  return (
    <FieldWrapper
      fieldId={field.field_id}
      label={field.label}
      required={field.required}
      helpText={
        field.help_text ||
        `Formatos: PDF, JPEG, PNG. Tamaño máximo: ${MAX_SIZE_MB} MB.`
      }
      error={displayError}
    >
      <div className="space-y-2">
        <input
          ref={inputRef}
          id={field.field_id}
          type="file"
          accept={ALLOWED_EXTENSIONS}
          onChange={handleChange}
          onBlur={onBlur}
          disabled={isUploading}
          aria-invalid={!!displayError}
          aria-describedby={describedBy || undefined}
          aria-required={field.required}
          className={`
            block w-full text-sm text-gray-500
            file:mr-3 file:py-2 file:px-4
            file:rounded-md file:border-0
            file:text-sm file:font-medium
            file:bg-primary-50 file:text-primary-700
            hover:file:bg-primary-100
            file:cursor-pointer cursor-pointer
            file:transition-colors
            ${isUploading ? 'opacity-50 pointer-events-none' : ''}
          `}
        />

        {/* Upload progress indicator */}
        {isUploading && (
          <div className="space-y-1" role="status" aria-live="polite">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>
                {uploadState.status === 'requesting_url'
                  ? 'Preparando carga...'
                  : uploadState.status === 'validating'
                    ? 'Validando archivo...'
                    : 'Subiendo archivo...'}
              </span>
              <span>{uploadState.progress}%</span>
            </div>
            <div
              className="w-full bg-gray-200 rounded-full h-2 overflow-hidden"
              role="progressbar"
              aria-valuenow={uploadState.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progreso de carga del archivo"
            >
              <div
                className="bg-primary-600 h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${uploadState.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Success state: show uploaded file info */}
        {uploadState.status === 'success' && displayFile && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
            <svg
              className="h-4 w-4 shrink-0 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="truncate flex-1">{displayFile.name}</span>
            <span className="text-xs text-green-500 whitespace-nowrap">
              {(displayFile.size / (1024 * 1024)).toFixed(2)} MB
            </span>
            <button
              type="button"
              onClick={handleRemove}
              className="text-red-500 hover:text-red-700 text-xs font-medium shrink-0"
              aria-label={`Eliminar archivo ${displayFile.name}`}
            >
              Eliminar
            </button>
          </div>
        )}

        {/* Error state with file info */}
        {uploadState.status === 'error' && displayFile && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
            <svg
              className="h-4 w-4 shrink-0 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span className="truncate flex-1">{displayFile.name}</span>
            <button
              type="button"
              onClick={handleRemove}
              className="text-red-500 hover:text-red-700 text-xs font-medium shrink-0"
              aria-label={`Eliminar archivo ${displayFile.name}`}
            >
              Reintentar
            </button>
          </div>
        )}
      </div>
    </FieldWrapper>
  );
}

export { ALLOWED_TYPES, MAX_SIZE_MB };
